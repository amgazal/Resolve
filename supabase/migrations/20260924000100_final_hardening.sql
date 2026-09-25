-- Explicit application surface. Policies still enforce role and organization scope.
revoke create on schema public from public, anon, authenticated;
revoke all on all tables in schema public from anon, authenticated;
revoke all on all sequences in schema public from anon, authenticated;
grant select on organizations, users, diagnostic_categories, diagnoses, troubleshooting_steps,
  diagnostic_trees, diagnostic_nodes, diagnostic_options, diagnostic_sessions,
  session_answers, step_attempts, tickets, ticket_notes, saved_routes,
  session_facts, ticket_queue to authenticated;
grant insert (tree_id, key, question, fact_label, short_label, position),
  update (question, fact_label, short_label), delete on diagnostic_nodes to authenticated;
grant insert (node_id, label, fact_value, position, next_node_id, diagnosis_id),
  update (label, fact_value, next_node_id, diagnosis_id), delete on diagnostic_options to authenticated;
grant update (root_node_id) on diagnostic_trees to authenticated;

-- Policy helpers must be executable by the policy caller, but need not be RPCs.
create schema if not exists private;
revoke all on schema private from public, anon;
grant usage on schema private to authenticated;
alter function public.auth_org() set schema private;
alter function public.auth_role() set schema private;
alter function public.is_staff() set schema private;
alter function public.is_admin() set schema private;

-- Replace textual helper references in function bodies. Policy dependencies follow
-- the moved function OIDs automatically. pg_temp is explicitly last, never implicit.
do $$
declare f record; definition text;
begin
  for f in select p.oid from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname in ('public', 'private') and p.prokind = 'f'
      and (p.prosecdef or p.proname in ('is_staff', 'is_admin'))
  loop
    definition := pg_get_functiondef(f.oid);
    definition := regexp_replace(definition, '\m(auth_org|auth_role|is_staff|is_admin)\(', 'private.\1(', 'g');
    -- Do not rewrite a function's qualified declaration a second time.
    definition := replace(definition, 'private.private.', 'private.');
    definition := replace(definition, 'SET search_path TO ''public''', 'SET search_path TO ''public'', ''pg_temp''');
    execute definition;
  end loop;
end $$;

-- Reject oversized input rather than silently truncating it. Applied to every
-- text column supplied by users or catalog authors, including privileged seeds.
create function private.normalize_text() returns trigger
language plpgsql set search_path = public, pg_temp as $$
declare data jsonb := to_jsonb(new); field text; limit_size int; value text; i int;
begin
  for i in 0..(tg_nargs / 2 - 1) loop
    field := tg_argv[i * 2]; limit_size := tg_argv[i * 2 + 1]::int;
    value := btrim(replace(data->>field, E'\r\n', E'\n'));
    if length(value) > limit_size then
      raise exception 'Text exceeds the allowed length' using errcode = '23514';
    end if;
    data := jsonb_set(data, array[field], coalesce(to_jsonb(value), 'null'::jsonb));
  end loop;
  new := jsonb_populate_record(new, data);
  return new;
end $$;
create trigger normalize_text before insert or update on organizations
  for each row execute function private.normalize_text('name', '200', 'slug', '200');
create trigger normalize_text before insert or update on users
  for each row execute function private.normalize_text('full_name', '200', 'email', '320');
create trigger normalize_text before insert or update on diagnostic_categories
  for each row execute function private.normalize_text('slug', '200', 'label', '200', 'short_label', '200', 'hint', '1000', 'icon', '100');
create trigger normalize_text before insert or update on diagnoses
  for each row execute function private.normalize_text('key', '200', 'title', '2000', 'short_label', '200', 'node_label', '200');
create trigger normalize_text before insert or update on troubleshooting_steps
  for each row execute function private.normalize_text('title', '500', 'detail', '10000');
create trigger normalize_text before insert or update on diagnostic_trees
  for each row execute function private.normalize_text('root_label', '200');
create trigger normalize_text before insert or update on diagnostic_nodes
  for each row execute function private.normalize_text('key', '200', 'question', '2000', 'fact_label', '200', 'short_label', '200');
create trigger normalize_text before insert or update on diagnostic_options
  for each row execute function private.normalize_text('label', '500', 'fact_value', '1000');
create trigger normalize_text before insert or update on diagnostic_sessions
  for each row execute function private.normalize_text('description', '4000', 'device', '200', 'operating_system', '200');
create trigger normalize_text before insert or update on tickets
  for each row execute function private.normalize_text('subject', '2000', 'user_note', '2000', 'reference', '200');
create trigger normalize_text before insert or update on ticket_notes
  for each row execute function private.normalize_text('body', '2000');
create trigger normalize_text before insert or update on saved_routes
  for each row execute function private.normalize_text('name', '500');

create or replace function start_session(
  p_category_id uuid, p_description text, p_device text, p_operating_system text)
returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_tree diagnostic_trees; v_id uuid;
begin
  if auth.uid() is null then
    raise exception 'Sign in to start a diagnosis' using errcode = 'insufficient_privilege';
  end if;

  select t.* into v_tree
    from diagnostic_trees t
    join diagnostic_categories c on c.id = t.category_id
   where t.category_id = p_category_id and t.status = 'published' and c.org_id = private.auth_org();

  if not found then
    raise exception 'That category has no published questions yet' using errcode = 'no_data_found';
  end if;

  insert into diagnostic_sessions
    (org_id, user_id, category_id, tree_id, description, device, operating_system, current_node_id)
  values
    (private.auth_org(), auth.uid(), p_category_id, v_tree.id,
     coalesce(p_description, ''), p_device, p_operating_system, v_tree.root_node_id)
  returning id into v_id;

  return get_session_state(v_id);
end;
$$;

create or replace function escalate_session(p_session_id uuid, p_note text)
returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare s diagnostic_sessions; d diagnoses; v_ref text; v_id uuid; v_n int;
begin
  select * into s from diagnostic_sessions where id = p_session_id for update;
  if not found or s.user_id is distinct from auth.uid() then
    raise exception 'Not your session' using errcode = 'insufficient_privilege';
  end if;
  -- A retry after a lost response returns the existing handoff.
  if s.status = 'escalated' then
    select id, reference into v_id, v_ref from tickets where session_id = s.id;
    return jsonb_build_object('id', v_id, 'reference', v_ref);
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
     coalesce(rtrim(d.title, '.'), 'Needs triage'), coalesce(p_note, ''),
     coalesce(d.default_priority, 'medium'), 'new')
  returning id into v_id;

  update diagnostic_sessions set status = 'escalated', ended_at = now() where id = s.id;

  return jsonb_build_object('id', v_id, 'reference', v_ref);
end;
$$;

create or replace function update_ticket(
  p_ticket_id uuid,
  p_status ticket_status default null,
  p_priority priority_level default null,
  p_assign_to_me boolean default false)
returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare t tickets;
begin
  if not private.is_staff() then
    raise exception 'Only the IT desk can update tickets' using errcode = 'insufficient_privilege';
  end if;

  select * into t from tickets
   where id = p_ticket_id and org_id = private.auth_org()
   for update;
  if not found then raise exception 'Ticket not found' using errcode = 'no_data_found'; end if;

  if p_assign_to_me and (t.status = 'resolved' or (t.assignee_id is not null and t.assignee_id <> auth.uid())) then
    raise exception 'Ticket cannot be assigned' using errcode = '22023';
  end if;
  if p_status = 'assigned' and not coalesce(p_assign_to_me, false) and t.assignee_id is null then
    raise exception 'Assign the ticket first' using errcode = '22023';
  end if;
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

create or replace function publish_tree(p_tree_id uuid)
returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_tree diagnostic_trees; v_orphans text[]; v_dead text[]; v_cycles text[];
begin
  if not private.is_admin() then
    raise exception 'Only admins publish trees' using errcode = 'insufficient_privilege';
  end if;

  select t.* into v_tree
    from diagnostic_trees t
    join diagnostic_categories c on c.id = t.category_id
   where t.id = p_tree_id and c.org_id = private.auth_org() for update of t;
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

create or replace view ticket_queue with (security_invoker = true) as
  select t.id, t.org_id, t.reference, t.subject, t.priority, t.status,
         t.created_at, t.resolved_at, t.session_id, t.user_note,
         t.requester_id, t.assignee_id,
         coalesce(req.full_name, 'Unknown') as requester_name,
         asg.full_name                      as assignee_name,
         c.label                            as category_label,
         c.short_label                      as category_short,
         d.short_label                      as diagnosis_label,
         s.device, s.operating_system, s.description
    from tickets t
    left join users                 req on req.id = t.requester_id
    left join users                 asg on asg.id = t.assignee_id
    left join diagnostic_categories c   on c.id   = t.category_id
    left join diagnoses             d   on d.id   = t.diagnosis_id
    left join diagnostic_sessions   s   on s.id   = t.session_id where private.is_staff();


create function private.ticket_transition() returns trigger
language plpgsql set search_path = public, pg_temp as $$
begin
  if new.status <> old.status and
    (old.status = 'resolved' or new.status not in ('assigned', 'waiting', 'resolved')) then
    raise exception 'That status change is not available' using errcode = '22023';
  end if;
  return new;
end $$;
create trigger ticket_transition before update of status on tickets
  for each row execute function private.ticket_transition();

-- Serialize authoring against publication. Column grants prevent moving a node
-- into a different tree; this lock prevents a write racing the publish validation.
create function private.lock_draft() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
declare tree_id uuid; t diagnostic_trees; source jsonb;
begin
  if auth.role() is distinct from 'authenticated' then
    if tg_op = 'DELETE' then return old; else return new; end if;
  end if;
  if tg_op = 'DELETE' then source := to_jsonb(old); else source := to_jsonb(new); end if;
  if tg_table_name = 'diagnostic_nodes' then tree_id := (source->>'tree_id')::uuid;
  else select n.tree_id into tree_id from diagnostic_nodes n where n.id = (source->>'node_id')::uuid;
  end if;
  select * into t from diagnostic_trees where id = tree_id for update;
  if not private.is_admin() or t.status is distinct from 'draft' or not exists (
    select 1 from diagnostic_categories where id = t.category_id and org_id = private.auth_org()) then
    raise exception 'Only organization drafts can be edited' using errcode = '42501';
  end if;
  if tg_op = 'DELETE' then return old; else return new; end if;
end $$;
create trigger lock_draft before insert or update or delete on diagnostic_nodes
  for each row execute function private.lock_draft();
create trigger lock_draft before insert or update or delete on diagnostic_options
  for each row execute function private.lock_draft();

-- These wrappers do not bypass RLS themselves; only identity lookups need definer rights.
alter function private.is_staff() security invoker;
alter function private.is_admin() security invoker;

-- Reset defaults explicitly, including privileges installed by Supabase defaults.
revoke execute on all functions in schema public from public, anon, authenticated;
revoke execute on all functions in schema private from public, anon, authenticated;
grant execute on function private.auth_org, private.auth_role, private.is_staff, private.is_admin to authenticated;
grant execute on function start_session, abandon_session, answer_question, undo_last_answer,
  record_attempt, escalate_session, get_session_state, queue_stats,
  update_ticket, add_ticket_note, save_route, open_tree_draft, publish_tree, get_tree to authenticated;
alter default privileges in schema public revoke execute on functions from public, anon, authenticated;
alter default privileges in schema private revoke execute on functions from public, anon, authenticated;
