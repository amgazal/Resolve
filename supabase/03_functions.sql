-- =====================================================================
--  RESOLVE — traversal and workflow functions
--
--  The database owns the walk through the tree. The browser never
--  receives the tree; it asks for the next question and posts an answer.
--  Two consequences worth the trouble:
--    1. A client cannot claim a diagnostic path it did not walk, so the
--       history attached to a ticket is evidence rather than assertion.
--    2. Admins can rewrite trees without shipping a new frontend.
--
--  These are security definer so they can write the rows that RLS keeps
--  closed to direct UPDATE — but each one re-checks ownership itself.
-- =====================================================================

-- ------------------------------------------------------- session state

-- One read that returns everything the UI needs after any mutation, so
-- the client re-renders from a single source instead of patching state.
create or replace function get_session_state(p_session_id uuid)
returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  s        diagnostic_sessions;
  tree     diagnostic_trees;
  trail    jsonb := '[]'::jsonb;
  facts    jsonb := '[]'::jsonb;
  node     jsonb := null;
  dx       jsonb := null;
  attempts jsonb := '[]'::jsonb;
  r        record;
begin
  select * into s from diagnostic_sessions where id = p_session_id;
  if not found then raise exception 'Session not found' using errcode = 'no_data_found'; end if;

  if s.user_id is distinct from auth.uid() and not (
    s.org_id = auth_org()
    and is_staff()
    and s.status = 'escalated'
  ) then
    raise exception 'Not your session' using errcode = 'insufficient_privilege';
  end if;

  select * into tree from diagnostic_trees where id = s.tree_id;

  trail := jsonb_build_array(
    jsonb_build_object('label', tree.root_label, 'answer', null, 'state', 'known'));

  for r in select * from session_facts where session_id = s.id order by position loop
    facts := facts || jsonb_build_object('label', r.label, 'value', r.value);
    trail := trail || jsonb_build_object(
      'label', r.trail_label, 'answer', r.answer_label, 'state', 'known');
  end loop;

  if s.current_node_id is not null then
    select jsonb_build_object(
             'id', n.id, 'key', n.key, 'question', n.question,
             'factLabel', n.fact_label, 'shortLabel', n.short_label,
             'options', coalesce((
               select jsonb_agg(jsonb_build_object('id', o.id, 'label', o.label) order by o.position)
                 from diagnostic_options o where o.node_id = n.id), '[]'::jsonb))
      into node
      from diagnostic_nodes n where n.id = s.current_node_id;

    trail := trail || jsonb_build_object(
      'label', node->>'shortLabel', 'answer', null, 'state', 'current');
  end if;

  if s.diagnosis_id is not null then
    select jsonb_build_object(
             'id', d.id, 'key', d.key, 'title', d.title,
             'shortLabel', d.short_label, 'nodeLabel', d.node_label,
             'priority', d.default_priority,
             'steps', coalesce((
               select jsonb_agg(jsonb_build_object(
                        'id', st.id, 'position', st.position,
                        'title', st.title, 'detail', st.detail) order by st.position)
                 from troubleshooting_steps st where st.diagnosis_id = d.id), '[]'::jsonb))
      into dx
      from diagnoses d where d.id = s.diagnosis_id;

    trail := trail || jsonb_build_object(
      'label', dx->>'nodeLabel', 'answer', null, 'state', 'known', 'terminal', true);
  else
    trail := trail || jsonb_build_object(
      'label', 'Diagnosis', 'answer', null, 'state', 'unknown', 'terminal', true);
  end if;

  select coalesce(jsonb_agg(jsonb_build_object(
           'stepId', a.step_id, 'title', st.title, 'outcome', a.outcome) order by st.position), '[]'::jsonb)
    into attempts
    from step_attempts a join troubleshooting_steps st on st.id = a.step_id
   where a.session_id = s.id;

  return jsonb_build_object(
    'id', s.id,
    'description', s.description,
    'device', s.device,
    'operatingSystem', s.operating_system,
    'status', s.status,
    'categoryLabel', (select label from diagnostic_categories where id = s.category_id),
    'facts', facts,
    'path', trail,
    'attempts', attempts,
    'node', node,
    'diagnosis', dx);
end;
$$;

-- ------------------------------------------------------- start / answer

create or replace function abandon_session(p_session_id uuid)
returns void
language plpgsql security definer set search_path = public as $$
declare s diagnostic_sessions;
begin
  select * into s from diagnostic_sessions where id = p_session_id for update;
  if not found or s.user_id is distinct from auth.uid() then
    raise exception 'Not your session' using errcode = 'insufficient_privilege';
  end if;

  if s.status = 'in_progress' then
    update diagnostic_sessions
       set status = 'abandoned', ended_at = now(), current_node_id = null
     where id = s.id;
  end if;
end;
$$;

create or replace function start_session(
  p_category_id uuid, p_description text, p_device text, p_operating_system text)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_tree diagnostic_trees; v_id uuid;
begin
  if auth.uid() is null then
    raise exception 'Sign in to start a diagnosis' using errcode = 'insufficient_privilege';
  end if;

  select t.* into v_tree
    from diagnostic_trees t
    join diagnostic_categories c on c.id = t.category_id
   where t.category_id = p_category_id and t.status = 'published' and c.org_id = auth_org();

  if not found then
    raise exception 'That category has no published questions yet' using errcode = 'no_data_found';
  end if;

  insert into diagnostic_sessions
    (org_id, user_id, category_id, tree_id, description, device, operating_system, current_node_id)
  values
    (auth_org(), auth.uid(), p_category_id, v_tree.id,
     left(coalesce(p_description, ''), 4000), p_device, p_operating_system, v_tree.root_node_id)
  returning id into v_id;

  return get_session_state(v_id);
end;
$$;

create or replace function answer_question(p_session_id uuid, p_option_id uuid)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare s diagnostic_sessions; o diagnostic_options; v_pos int;
begin
  select * into s from diagnostic_sessions where id = p_session_id for update;
  if not found or s.user_id is distinct from auth.uid() then
    raise exception 'Not your session' using errcode = 'insufficient_privilege';
  end if;
  if s.status <> 'in_progress' then
    raise exception 'This session is no longer active' using errcode = 'invalid_parameter_value';
  end if;
  if s.current_node_id is null then
    raise exception 'This diagnosis has already concluded' using errcode = 'invalid_parameter_value';
  end if;

  -- The answer must belong to the question actually being asked. This is
  -- the check that makes a forged option id useless.
  select * into o from diagnostic_options
   where id = p_option_id and node_id = s.current_node_id;
  if not found then
    raise exception 'That answer does not belong to the current question'
      using errcode = 'invalid_parameter_value';
  end if;

  select coalesce(max(position), 0) + 1 into v_pos
    from session_answers where session_id = s.id;

  insert into session_answers (session_id, node_id, option_id, position)
  values (s.id, s.current_node_id, o.id, v_pos);

  update diagnostic_sessions
     set current_node_id = o.next_node_id, diagnosis_id = o.diagnosis_id
   where id = s.id;

  return get_session_state(s.id);
end;
$$;

create or replace function undo_last_answer(p_session_id uuid)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare s diagnostic_sessions; v_node uuid;
begin
  select * into s from diagnostic_sessions where id = p_session_id for update;
  if not found or s.user_id is distinct from auth.uid() then
    raise exception 'Not your session' using errcode = 'insufficient_privilege';
  end if;
  if s.status <> 'in_progress' then
    raise exception 'This session is no longer active' using errcode = 'invalid_parameter_value';
  end if;
  if exists (select 1 from step_attempts where session_id = s.id) then
    raise exception 'Answers cannot be changed after troubleshooting has started'
      using errcode = 'invalid_parameter_value';
  end if;

  delete from session_answers
   where id = (select id from session_answers where session_id = s.id
               order by position desc limit 1)
  returning node_id into v_node;

  if v_node is null then
    raise exception 'There is nothing to undo' using errcode = 'invalid_parameter_value';
  end if;

  update diagnostic_sessions
     set current_node_id = v_node, diagnosis_id = null
   where id = s.id;

  return get_session_state(s.id);
end;
$$;

create or replace function record_attempt(
  p_session_id uuid, p_step_id uuid, p_outcome attempt_outcome)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  s diagnostic_sessions;
  v_expected_step uuid;
  v_existing_outcome attempt_outcome;
begin
  select * into s from diagnostic_sessions where id = p_session_id for update;
  if not found or s.user_id is distinct from auth.uid() then
    raise exception 'Not your session' using errcode = 'insufficient_privilege';
  end if;
  if s.status <> 'in_progress' then
    raise exception 'This session is no longer active' using errcode = 'invalid_parameter_value';
  end if;
  if s.diagnosis_id is null then
    raise exception 'Reach a diagnosis before recording troubleshooting steps'
      using errcode = 'invalid_parameter_value';
  end if;

  -- A retry of the same mutation is harmless, but history is immutable once
  -- a step has an outcome. The browser cannot rewrite "failed" into "fixed".
  select outcome into v_existing_outcome
    from step_attempts
   where session_id = s.id and step_id = p_step_id;
  if found then
    if v_existing_outcome = p_outcome then return get_session_state(s.id); end if;
    raise exception 'That troubleshooting result is already recorded'
      using errcode = 'invalid_parameter_value';
  end if;

  -- The browser may only record the next unattempted step. This keeps the
  -- diagnostic history authoritative even if somebody forges a step id.
  select st.id into v_expected_step
    from troubleshooting_steps st
   where st.diagnosis_id = s.diagnosis_id
     and not exists (
       select 1 from step_attempts a
        where a.session_id = s.id and a.step_id = st.id)
   order by st.position
   limit 1;

  if v_expected_step is null then
    raise exception 'All troubleshooting steps have already been recorded'
      using errcode = 'invalid_parameter_value';
  end if;
  if v_expected_step <> p_step_id then
    raise exception 'Troubleshooting steps must be recorded in order'
      using errcode = 'invalid_parameter_value';
  end if;

  insert into step_attempts (session_id, step_id, outcome)
  values (s.id, p_step_id, p_outcome);

  if p_outcome = 'fixed' then
    update diagnostic_sessions set status = 'resolved', ended_at = now() where id = s.id;
  end if;

  return get_session_state(s.id);
end;
$$;

-- ------------------------------------------------------- escalation

create or replace function escalate_session(p_session_id uuid, p_note text)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare s diagnostic_sessions; d diagnoses; v_ref text; v_id uuid; v_n int;
begin
  select * into s from diagnostic_sessions where id = p_session_id for update;
  if not found or s.user_id is distinct from auth.uid() then
    raise exception 'Not your session' using errcode = 'insufficient_privilege';
  end if;
  if s.status <> 'in_progress' then
    raise exception 'This session is no longer active' using errcode = 'invalid_parameter_value';
  end if;
  if s.diagnosis_id is null then
    raise exception 'Complete the diagnostic questions before escalating'
      using errcode = 'invalid_parameter_value';
  end if;
  if exists (select 1 from tickets where session_id = s.id) then
    raise exception 'This has already been sent to IT' using errcode = 'unique_violation';
  end if;

  select * into d from diagnoses where id = s.diagnosis_id;

  -- Serialise reference allocation so two people escalating at the same
  -- moment cannot be handed the same number.
  perform pg_advisory_xact_lock(hashtext('ticket-ref:' || s.org_id::text));
  select coalesce(max(substring(reference from '[0-9]+$')::int), 2480) + 1
    into v_n
    from tickets
   where org_id = s.org_id
     and reference ~ '^RSV-[0-9]+$';
  v_ref := 'RSV-' || v_n;

  insert into tickets
    (org_id, session_id, reference, requester_id, category_id, diagnosis_id,
     subject, user_note, priority, status)
  values
    (s.org_id, s.id, v_ref, s.user_id, s.category_id, s.diagnosis_id,
     coalesce(rtrim(d.title, '.'), 'Needs triage'), left(coalesce(p_note, ''), 2000),
     coalesce(d.default_priority, 'medium'), 'new')
  returning id into v_id;

  update diagnostic_sessions set status = 'escalated', ended_at = now() where id = s.id;

  return jsonb_build_object('id', v_id, 'reference', v_ref);
end;
$$;

create or replace function queue_stats()
returns jsonb
language sql stable security definer set search_path = public as $$
  select case when not is_staff() then '{}'::jsonb else jsonb_build_object(
    'open',           count(*) filter (where status <> 'resolved'),
    'needsReview',    count(*) filter (where status = 'needs_review'),
    'resolvedToday',  count(*) filter (where resolved_at >= date_trunc('day', now())),
    'avgResolutionMinutes',
      coalesce(round(avg(extract(epoch from (resolved_at - created_at)) / 60)
               filter (where resolved_at >= now() - interval '7 days')), 0)
  ) end
  from tickets where org_id = auth_org();
$$;

-- Staff mutations are also server-owned. RLS has no direct UPDATE policy on
-- tickets, so the browser can change only the fields this function exposes.
create or replace function update_ticket(
  p_ticket_id uuid,
  p_status ticket_status default null,
  p_priority priority_level default null,
  p_assign_to_me boolean default false)
returns void
language plpgsql security definer set search_path = public as $$
declare t tickets;
begin
  if not is_staff() then
    raise exception 'Only the IT desk can update tickets' using errcode = 'insufficient_privilege';
  end if;

  select * into t from tickets
   where id = p_ticket_id and org_id = auth_org()
   for update;
  if not found then raise exception 'Ticket not found' using errcode = 'no_data_found'; end if;

  update tickets
     set status = coalesce(p_status, status),
         priority = coalesce(p_priority, priority),
         assignee_id = case when p_assign_to_me then auth.uid() else assignee_id end,
         first_response_at = case
           when p_assign_to_me and first_response_at is null then now()
           else first_response_at
         end
   where id = t.id;
end;
$$;

create or replace function add_ticket_note(p_ticket_id uuid, p_body text)
returns void
language plpgsql security definer set search_path = public as $$
declare v_body text;
begin
  if not is_staff() then
    raise exception 'Only the IT desk can add internal notes' using errcode = 'insufficient_privilege';
  end if;
  if not exists (select 1 from tickets where id = p_ticket_id and org_id = auth_org()) then
    raise exception 'Ticket not found' using errcode = 'no_data_found';
  end if;

  v_body := btrim(coalesce(p_body, ''));
  if v_body = '' then
    raise exception 'Write a note before adding it' using errcode = 'invalid_parameter_value';
  end if;
  if char_length(v_body) > 2000 then
    raise exception 'Internal notes are limited to 2,000 characters' using errcode = 'invalid_parameter_value';
  end if;

  insert into ticket_notes (ticket_id, author_id, body, is_internal)
  values (p_ticket_id, auth.uid(), v_body, true);
end;
$$;

create or replace function save_route(p_ticket_id uuid)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare t record; v_name text; v_steps text[]; v_row saved_routes;
begin
  if not is_staff() then
    raise exception 'Only the IT desk can save routes' using errcode = 'insufficient_privilege';
  end if;

  select tk.*, c.short_label as cat, d.short_label as dx into t
    from tickets tk
    left join diagnostic_categories c on c.id = tk.category_id
    left join diagnoses d on d.id = tk.diagnosis_id
   where tk.id = p_ticket_id and tk.org_id = auth_org();
  if not found then raise exception 'Ticket not found' using errcode = 'no_data_found'; end if;

  select coalesce(array_agg(st.title order by st.position), '{}')
    into v_steps
    from step_attempts a join troubleshooting_steps st on st.id = a.step_id
   where a.session_id = t.session_id;

  v_name := coalesce(t.cat, 'General') || ' → ' || coalesce(t.dx, t.subject);

  insert into saved_routes (org_id, name, category_id, diagnosis_id, source_ticket_id, step_titles, created_by)
  values (auth_org(), v_name, t.category_id, t.diagnosis_id, p_ticket_id, v_steps, auth.uid())
  on conflict (org_id, name) do update set use_count = saved_routes.use_count + 1
  returning * into v_row;

  return jsonb_build_object('id', v_row.id, 'name', v_row.name,
                            'steps', coalesce(array_length(v_row.step_titles, 1), 0),
                            'uses', v_row.use_count);
end;
$$;

-- ------------------------------------------------------- tree authoring

-- Editing never touches a live tree. This clones the published version
-- into a draft the admin can break freely.
create or replace function open_tree_draft(p_category_id uuid)
returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_src diagnostic_trees;
  v_draft uuid;
begin
  if not is_admin() then
    raise exception 'Only admins edit trees' using errcode = 'insufficient_privilege';
  end if;

  -- Security-definer functions do not inherit the caller's RLS context.
  -- Lock the category while opening a draft so two admins cannot race each
  -- other into creating two copies of the same version.
  perform 1 from diagnostic_categories
   where id = p_category_id and org_id = auth_org()
   for update;
  if not found then
    raise exception 'Category not found' using errcode = 'no_data_found';
  end if;

  select id into v_draft from diagnostic_trees
   where category_id = p_category_id and status = 'draft';
  if found then return v_draft; end if;

  select * into v_src from diagnostic_trees
   where category_id = p_category_id and status = 'published';
  if not found then raise exception 'Nothing to clone' using errcode = 'no_data_found'; end if;

  insert into diagnostic_trees (category_id, version, status, root_label, created_by)
  select p_category_id, coalesce(max(version), 0) + 1, 'draft', v_src.root_label, auth.uid()
    from diagnostic_trees where category_id = p_category_id
  returning id into v_draft;

  -- Stable node keys are the mapping between versions. Copy all questions
  -- first, then copy answers and translate their next-node targets by key.
  insert into diagnostic_nodes (tree_id, key, question, fact_label, short_label, position)
  select v_draft, key, question, fact_label, short_label, position
    from diagnostic_nodes
   where tree_id = v_src.id
   order by position;

  insert into diagnostic_options (node_id, label, fact_value, position, next_node_id, diagnosis_id)
  select dn.id, o.label, o.fact_value, o.position,
         case when o.next_node_id is null then null else (
           select dn_next.id
             from diagnostic_nodes sn_next
             join diagnostic_nodes dn_next
               on dn_next.tree_id = v_draft and dn_next.key = sn_next.key
            where sn_next.id = o.next_node_id
         ) end,
         o.diagnosis_id
    from diagnostic_options o
    join diagnostic_nodes sn on sn.id = o.node_id and sn.tree_id = v_src.id
    join diagnostic_nodes dn on dn.tree_id = v_draft and dn.key = sn.key
   order by dn.position, o.position;

  update diagnostic_trees
     set root_node_id = (
       select dn.id
         from diagnostic_nodes sn
         join diagnostic_nodes dn on dn.tree_id = v_draft and dn.key = sn.key
        where sn.id = v_src.root_node_id
     )
   where id = v_draft;

  return v_draft;
end;
$$;

-- Publishing validates the whole tree first. A draft with an unreachable
-- node or an unanswered question never becomes the thing a stuck person
-- has to walk through.
create or replace function publish_tree(p_tree_id uuid)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_tree diagnostic_trees; v_orphans text[]; v_dead text[]; v_cycles text[];
begin
  if not is_admin() then
    raise exception 'Only admins publish trees' using errcode = 'insufficient_privilege';
  end if;

  select t.* into v_tree
    from diagnostic_trees t
    join diagnostic_categories c on c.id = t.category_id
   where t.id = p_tree_id and c.org_id = auth_org();
  if not found then raise exception 'Tree not found' using errcode = 'no_data_found'; end if;
  if v_tree.status <> 'draft' then
    raise exception 'Only a draft can be published' using errcode = 'invalid_parameter_value';
  end if;
  if v_tree.root_node_id is null then
    raise exception 'Set a first question before publishing' using errcode = 'invalid_parameter_value';
  end if;

  -- Every question needs at least one answer.
  select coalesce(array_agg(n.short_label), '{}') into v_dead
    from diagnostic_nodes n
   where n.tree_id = p_tree_id
     and not exists (select 1 from diagnostic_options o where o.node_id = n.id);
  if array_length(v_dead, 1) > 0 then
    raise exception 'These questions have no answers yet: %', array_to_string(v_dead, ', ')
      using errcode = 'invalid_parameter_value';
  end if;

  -- Every question must be reachable from the first one.
  with recursive reachable as (
    select v_tree.root_node_id as id
    union
    select o.next_node_id from diagnostic_options o
      join reachable r on r.id = o.node_id
     where o.next_node_id is not null)
  select coalesce(array_agg(n.short_label), '{}') into v_orphans
    from diagnostic_nodes n
   where n.tree_id = p_tree_id and n.id not in (select id from reachable);
  if array_length(v_orphans, 1) > 0 then
    raise exception 'These questions can never be reached: %', array_to_string(v_orphans, ', ')
      using errcode = 'invalid_parameter_value';
  end if;

  -- A diagnostic workflow is a directed acyclic graph. Without this check,
  -- two otherwise reachable questions could point back to each other and
  -- trap a user forever.
  with recursive walk(current_id, path, cycle) as (
    select v_tree.root_node_id, array[v_tree.root_node_id], false
    union all
    select o.next_node_id,
           w.path || o.next_node_id,
           o.next_node_id = any(w.path)
      from walk w
      join diagnostic_options o on o.node_id = w.current_id
     where o.next_node_id is not null and not w.cycle
  )
  select coalesce(array_agg(distinct n.short_label), '{}') into v_cycles
    from walk w
    join diagnostic_nodes n on n.id = w.current_id
   where w.cycle;
  if array_length(v_cycles, 1) > 0 then
    raise exception 'These branches contain a loop: %', array_to_string(v_cycles, ', ')
      using errcode = 'invalid_parameter_value';
  end if;

  update diagnostic_trees set status = 'archived'
   where category_id = v_tree.category_id and status = 'published';
  update diagnostic_trees set status = 'published', published_at = now()
   where id = p_tree_id;

  return jsonb_build_object('id', p_tree_id, 'version', v_tree.version, 'status', 'published');
end;
$$;

-- The whole draft in one payload, for the editor.
create or replace function get_tree(p_tree_id uuid)
returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'id', t.id, 'version', t.version, 'status', t.status,
    'rootLabel', t.root_label, 'rootNodeId', t.root_node_id,
    'categoryId', t.category_id,
    'nodes', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', n.id, 'key', n.key, 'question', n.question,
        'factLabel', n.fact_label, 'shortLabel', n.short_label, 'position', n.position,
        'options', coalesce((
          select jsonb_agg(jsonb_build_object(
            'id', o.id, 'label', o.label, 'factValue', o.fact_value,
            'position', o.position, 'nextNodeId', o.next_node_id,
            'diagnosisId', o.diagnosis_id) order by o.position)
          from diagnostic_options o where o.node_id = n.id), '[]'::jsonb))
        order by n.position)
      from diagnostic_nodes n where n.tree_id = t.id), '[]'::jsonb))
  from diagnostic_trees t
  join diagnostic_categories c on c.id = t.category_id
 where t.id = p_tree_id
   and c.org_id = auth_org()
   and is_admin();
$$;

-- ------------------------------------------------------- grants

revoke all on function start_session, abandon_session, answer_question, undo_last_answer,
  record_attempt, escalate_session, get_session_state, queue_stats,
  update_ticket, add_ticket_note, save_route, open_tree_draft, publish_tree, get_tree from public;

grant execute on function start_session, abandon_session, answer_question, undo_last_answer,
  record_attempt, escalate_session, get_session_state, queue_stats,
  update_ticket, add_ticket_note, save_route, open_tree_draft, publish_tree, get_tree to authenticated;
