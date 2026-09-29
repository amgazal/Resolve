-- Workflow completion: public-message ownership, staff assignment, activity, and
-- persistent route-library truth. All writes remain RPC-owned and org-scoped.

create or replace function private.send_public_message(p_ticket_id uuid, p_body text, p_wait_for_reply boolean default false)
returns uuid language plpgsql security definer set search_path = public, pg_temp as $$
declare
  t tickets;
  actor users;
  body text := btrim(replace(p_body, E'\r\n', E'\n'), E' \t\r\n');
  owner_reply boolean;
  message_id uuid;
begin
  select * into actor from users where id = auth.uid();
  select * into t from tickets where id = p_ticket_id and org_id = private.auth_org() for update;
  if not found or actor.id is null or (t.requester_id is distinct from auth.uid() and not private.is_staff()) then
    raise exception 'Request not found' using errcode = '42501';
  end if;
  owner_reply := t.requester_id is not distinct from auth.uid();
  if t.status = 'resolved' then raise exception 'Resolved requests cannot receive replies' using errcode = '22023'; end if;
  if body is null or length(body) not between 1 and 4000 then
    raise exception 'Write a message of 1 to 4000 characters' using errcode = '22023';
  end if;
  if p_wait_for_reply and owner_reply then raise exception 'Only IT can request a reply' using errcode = '42501'; end if;

  insert into ticket_messages(ticket_id, sender_id, sender_name, sender_kind, body)
    values(t.id, actor.id, actor.full_name, case when owner_reply then 'requester' else 'staff' end, body)
    returning id into message_id;

  if owner_reply then
    update tickets set status = 'needs_review' where id = t.id;
  elsif p_wait_for_reply then
    update tickets
       set status = 'waiting', assignee_id = coalesce(assignee_id, actor.id),
           first_response_at = coalesce(first_response_at, now())
     where id = t.id;
  else
    update tickets
       set status = 'assigned', assignee_id = coalesce(assignee_id, actor.id),
           first_response_at = coalesce(first_response_at, now())
     where id = t.id;
  end if;
  return message_id;
end $$;

create or replace function public.send_ticket_message(p_ticket_id uuid, p_body text, p_wait_for_reply boolean default false)
returns void language plpgsql security definer set search_path = public, pg_temp as $$
begin perform private.send_public_message(p_ticket_id, p_body, p_wait_for_reply); end $$;

create or replace function private.ticket_transition() returns trigger
language plpgsql set search_path = public as $$
begin
  if new.status <> old.status and (old.status = 'resolved' or
    (new.status not in ('assigned','waiting','needs_review','resolved'))) then
    raise exception 'That status change is not available' using errcode = '22023';
  end if;
  return new;
end $$;

create or replace function public.get_assignable_staff() returns jsonb
language sql stable security definer set search_path = public, pg_temp as $$
  select coalesce(jsonb_agg(jsonb_build_object('id', id, 'fullName', full_name) order by full_name), '[]'::jsonb)
    from users
   where org_id = private.auth_org() and role in ('technician', 'admin') and private.is_staff();
$$;

create or replace function public.assign_ticket(p_ticket_id uuid, p_assignee_id uuid)
returns void language plpgsql security definer set search_path = public, pg_temp as $$
declare t tickets;
begin
  if not private.is_staff() then raise exception 'Only the IT desk can assign tickets' using errcode = '42501'; end if;
  select * into t from tickets where id = p_ticket_id and org_id = private.auth_org() for update;
  if not found then raise exception 'Ticket not found' using errcode = '42501'; end if;
  if t.status = 'resolved' then raise exception 'Resolved tickets cannot be reassigned' using errcode = '22023'; end if;
  if p_assignee_id is not null then
    if not exists (select 1 from users where id = p_assignee_id and org_id = private.auth_org()
      and role in ('technician', 'admin')) then
      raise exception 'That staff member is not available' using errcode = '42501';
    end if;
  end if;
  update tickets set assignee_id = p_assignee_id where id = t.id;
end $$;

create or replace view ticket_queue with (security_invoker = true) as
  select t.id, t.org_id, t.reference, t.subject, t.priority, t.status,
         t.created_at, t.resolved_at, t.session_id, t.user_note,
         t.requester_id, t.assignee_id,
         coalesce(req.full_name, 'Unknown') as requester_name,
         asg.full_name as assignee_name,
         c.label as category_label, c.short_label as category_short,
         d.short_label as diagnosis_label,
         s.device, s.operating_system, s.description,
         greatest(t.created_at, t.resolved_at,
           (select max(m.created_at) from ticket_messages m where m.ticket_id = t.id)) as activity_at
    from tickets t
    left join users req on req.id = t.requester_id
    left join users asg on asg.id = t.assignee_id
    left join diagnostic_categories c on c.id = t.category_id
    left join diagnoses d on d.id = t.diagnosis_id
    left join diagnostic_sessions s on s.id = t.session_id;

create or replace function public.ticket_path_saved(p_ticket_id uuid) returns boolean
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare t tickets; snapshot jsonb; digest text;
begin
  if not private.is_staff() then raise exception 'Staff only' using errcode = '42501'; end if;
  select * into t from tickets where id = p_ticket_id and org_id = private.auth_org();
  if not found then raise exception 'Ticket not found' using errcode = '42501'; end if;
  snapshot := jsonb_build_object(
    'category', coalesce((select label from diagnostic_categories where id = t.category_id), 'General'),
    'diagnosis', coalesce((select title from diagnoses where id = t.diagnosis_id), 'Needs triage'),
    'path', coalesce((select jsonb_agg(jsonb_build_object('question', n.question, 'answer', o.label) order by a.position)
      from session_answers a join diagnostic_nodes n on n.id = a.node_id join diagnostic_options o on o.id = a.option_id
      where a.session_id = t.session_id), '[]'::jsonb),
    'attempts', coalesce((select jsonb_agg(jsonb_build_object('stepId', st.id, 'title', st.title, 'outcome', a.outcome) order by st.position)
      from step_attempts a join troubleshooting_steps st on st.id = a.step_id
      where a.session_id = t.session_id), '[]'::jsonb));
  digest := md5(snapshot::text);
  return exists(select 1 from saved_routes where org_id = t.org_id and fingerprint = digest);
end $$;

revoke all on function public.get_assignable_staff(), public.assign_ticket(uuid,uuid), public.ticket_path_saved(uuid) from public, anon;
grant execute on function public.get_assignable_staff(), public.assign_ticket(uuid,uuid), public.ticket_path_saved(uuid) to authenticated;

create or replace function public.validate_tree(p_tree_id uuid) returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare t diagnostic_trees; issues jsonb := '[]'::jsonb; n record; o record; labels text[];
begin
  select dt.* into t from diagnostic_trees dt join diagnostic_categories c on c.id = dt.category_id
   where dt.id = p_tree_id and c.org_id = private.auth_org() and private.is_admin();
  if not found then raise exception 'Tree not found' using errcode = '42501'; end if;
  if t.root_node_id is null or not exists(select 1 from diagnostic_nodes where id = t.root_node_id and tree_id = t.id) then
    issues := issues || jsonb_build_array(jsonb_build_object('code','root','message','Set a first question in this tree.'));
  end if;
  for n in select dn.id, dn.question, dn.fact_label, dn.short_label from diagnostic_nodes dn where dn.tree_id = t.id loop
    if btrim(n.question) = '' or lower(btrim(n.question)) = 'new question' or btrim(n.fact_label) = '' or btrim(n.short_label) = '' then
      issues := issues || jsonb_build_array(jsonb_build_object('code','placeholder','nodeId',n.id,'message','Replace blank or placeholder question content: ' || coalesce(n.short_label, 'unnamed question')));
    end if;
    if not exists(select 1 from diagnostic_options where node_id = n.id) then
      issues := issues || jsonb_build_array(jsonb_build_object('code','unanswered','nodeId',n.id,'message','No answers: ' || n.short_label));
    end if;
    labels := '{}';
    for o in select id, label, fact_value, next_node_id, diagnosis_id from diagnostic_options where node_id = n.id loop
      if btrim(o.label) = '' or lower(btrim(o.label)) = 'new answer' or btrim(o.fact_value) = '' or lower(btrim(o.fact_value)) = 'recorded' then
        issues := issues || jsonb_build_array(jsonb_build_object('code','placeholder','nodeId',n.id,'message','Replace blank or placeholder answer content: ' || n.short_label));
      end if;
      if lower(btrim(o.label)) = any(labels) then
        issues := issues || jsonb_build_array(jsonb_build_object('code','duplicate_answer','nodeId',n.id,'message','Duplicate answer label: ' || n.short_label));
      end if;
      labels := array_append(labels, lower(btrim(o.label)));
      if (o.next_node_id is null) = (o.diagnosis_id is null)
         or (o.next_node_id is not null and not exists(select 1 from diagnostic_nodes target where target.id = o.next_node_id and target.tree_id = t.id))
         or (o.diagnosis_id is not null and not exists(select 1 from diagnoses d where d.id = o.diagnosis_id and d.org_id = private.auth_org())) then
        issues := issues || jsonb_build_array(jsonb_build_object('code','target','nodeId',n.id,'message','Invalid answer destination: ' || n.short_label));
      end if;
    end loop;
  end loop;
  for n in with recursive reachable(id) as (
    select t.root_node_id where t.root_node_id is not null
    union select opt.next_node_id from diagnostic_options opt join reachable r on r.id = opt.node_id where opt.next_node_id is not null)
    select dn.id, dn.short_label from diagnostic_nodes dn where dn.tree_id = t.id and dn.id not in(select id from reachable) loop
    issues := issues || jsonb_build_array(jsonb_build_object('code','unreachable','nodeId',n.id,'message','Unreachable: ' || n.short_label));
  end loop;
  for n in with recursive walk(id,path,cycle) as (
    select t.root_node_id, array[t.root_node_id], false where t.root_node_id is not null
    union all select opt.next_node_id, w.path || opt.next_node_id, opt.next_node_id = any(w.path)
      from walk w join diagnostic_options opt on opt.node_id = w.id where opt.next_node_id is not null and not w.cycle)
    select distinct dn.id, dn.short_label from walk w join diagnostic_nodes dn on dn.id = w.id where w.cycle loop
    issues := issues || jsonb_build_array(jsonb_build_object('code','cycle','nodeId',n.id,'message','Loop: ' || n.short_label));
  end loop;
  return jsonb_build_object('valid', jsonb_array_length(issues) = 0, 'issues', issues);
end $$;
