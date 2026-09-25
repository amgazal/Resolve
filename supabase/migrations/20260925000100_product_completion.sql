-- Auth identities are not organization memberships. Provision users deliberately
-- through a trusted server/SQL process; signup metadata grants no access.
create or replace function public.handle_new_auth_user() returns trigger
language plpgsql set search_path = public, pg_temp as $$
begin return new; end;
$$;
revoke all on function public.handle_new_auth_user() from public, anon, authenticated;

-- Ownership never bypasses the current organization membership.
alter policy own_sessions on diagnostic_sessions using (user_id = auth.uid() and org_id = private.auth_org());
alter policy read_own_tickets on tickets using (requester_id = auth.uid() and org_id = private.auth_org());
do $$
declare f record; definition text;
begin
  for f in select oid from pg_proc where pronamespace = 'public'::regnamespace
    and proname in ('get_session_state','abandon_session','answer_question','undo_last_answer','record_attempt','escalate_session')
  loop
    definition := pg_get_functiondef(f.oid);
    definition := replace(definition,
      'if not found or s.user_id is distinct from auth.uid() then',
      'if not found or s.user_id is distinct from auth.uid() or s.org_id is distinct from private.auth_org() then');
    definition := replace(definition,
      'if s.user_id is distinct from auth.uid() and not (',
      'if s.org_id is distinct from private.auth_org() or s.user_id is distinct from auth.uid() and not (');
    execute definition;
  end loop;
end $$;

-- Internal notes have no requester-visible path, including legacy non-internal flags.
alter policy read_notes on ticket_notes using (exists (
  select 1 from tickets t where t.id = ticket_id and t.org_id = private.auth_org() and private.is_staff()
));

create table ticket_messages (
  id uuid primary key default gen_random_uuid(),
  ticket_id uuid not null references tickets(id) on delete cascade,
  sender_id uuid references users(id) on delete set null,
  sender_name text not null,
  sender_kind text not null check (sender_kind in ('requester','staff')),
  body text not null check (length(btrim(body, E' \t\r\n')) between 1 and 4000),
  created_at timestamptz not null default now()
);
create index ticket_messages_thread on ticket_messages(ticket_id, created_at, id);
alter table ticket_messages enable row level security;
create policy read_ticket_messages on ticket_messages for select to authenticated using (exists (
  select 1 from tickets t where t.id = ticket_id and t.org_id = private.auth_org()
    and (t.requester_id = auth.uid() or private.is_staff())
));
revoke all on ticket_messages from public, anon, authenticated;
grant select on ticket_messages to authenticated;

create function private.public_thread(p_ticket_id uuid) returns jsonb
language sql stable set search_path = public, pg_temp as $$
  select coalesce(jsonb_agg(jsonb_build_object('id', id, 'author', sender_name,
    'senderKind', sender_kind, 'body', body, 'createdAt', created_at) order by created_at, id), '[]'::jsonb)
  from ticket_messages where ticket_id = p_ticket_id;
$$;

create function get_my_tickets() returns jsonb
language sql stable set search_path = public, pg_temp as $$
  select coalesce(jsonb_agg(jsonb_build_object('id', t.id, 'reference', t.reference,
    'subject', t.subject, 'status', t.status, 'categoryLabel', coalesce(c.label, 'General'),
    'createdAt', t.created_at) order by t.created_at desc), '[]'::jsonb)
  from tickets t left join diagnostic_categories c on c.id = t.category_id
  where t.requester_id = auth.uid() and t.org_id = private.auth_org();
$$;

create function get_my_ticket(p_ticket_id uuid) returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare t tickets; result jsonb;
begin
  select * into t from tickets where id = p_ticket_id and requester_id = auth.uid() and org_id = private.auth_org();
  if not found then raise exception 'Request not found' using errcode = '42501'; end if;
  -- Explicit projection: never serialize tickets/notes wholesale.
  result := jsonb_build_object('id', t.id, 'reference', t.reference, 'subject', t.subject,
    'status', t.status, 'createdAt', t.created_at,
    'categoryLabel', coalesce((select label from diagnostic_categories where id = t.category_id), 'General'),
    'description', coalesce((select description from diagnostic_sessions where id = t.session_id), ''),
    'messages', private.public_thread(t.id));
  return result;
end $$;

create function send_ticket_message(p_ticket_id uuid, p_body text, p_wait_for_reply boolean default false)
returns void language plpgsql security definer set search_path = public, pg_temp as $$
declare t tickets; actor users; body text := btrim(replace(p_body, E'\r\n', E'\n'), E' \t\r\n'); owner_reply boolean;
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
    values(t.id, actor.id, actor.full_name, case when owner_reply then 'requester' else 'staff' end, body);
  if owner_reply and t.status = 'waiting' then
    update tickets set status = 'needs_review' where id = t.id;
  elsif not owner_reply and p_wait_for_reply then
    update tickets set status = 'waiting', first_response_at = coalesce(first_response_at, now()) where id = t.id;
  end if;
end $$;

create or replace function private.ticket_transition() returns trigger
language plpgsql set search_path = public, pg_temp as $$
begin
  if new.status <> old.status and (old.status = 'resolved' or
    (new.status not in ('assigned','waiting','resolved') and not (old.status = 'waiting' and new.status = 'needs_review'))) then
    raise exception 'That status change is not available' using errcode = '22023';
  end if;
  return new;
end $$;

-- Waiting and needs-review are conversation transitions, not arbitrary desk edits.
do $$
declare definition text;
begin
  definition := pg_get_functiondef('public.update_ticket(uuid,ticket_status,priority_level,boolean)'::regprocedure);
  definition := replace(definition, '  update tickets', $guard$
  if p_status is distinct from t.status and p_status in ('waiting','needs_review') then
    raise exception 'Use the conversation to request a reply' using errcode = '22023';
  end if;
  update tickets$guard$);
  execute definition;
end $$;

-- Reusable knowledge snapshots contain authored questions/answers and attempted
-- step titles/outcomes only. No requester identity, description, or private notes.
alter table saved_routes add column knowledge jsonb;
alter table saved_routes add column fingerprint text;
alter table saved_routes drop constraint saved_routes_org_id_name_key;
create unique index saved_routes_fingerprint on saved_routes(org_id, fingerprint) where fingerprint is not null;

create function private.route_projection(r saved_routes) returns jsonb
language sql stable set search_path = public, pg_temp as $$
  select jsonb_build_object('id', r.id, 'name', r.name,
    'category', coalesce(r.knowledge->>'category', 'Legacy reference'),
    'diagnosis', coalesce(r.knowledge->>'diagnosis', r.name),
    'path', coalesce(r.knowledge->'path', '[]'::jsonb),
    'attempts', coalesce(r.knowledge->'attempts', '[]'::jsonb),
    'savedBy', coalesce((select full_name from users where id = r.created_by), 'Former staff member'),
    'savedAt', r.created_at);
$$;
create function get_path_library() returns jsonb
language sql stable set search_path = public, pg_temp as $$
  select coalesce(jsonb_agg(private.route_projection(r) order by r.created_at desc), '[]'::jsonb)
  from saved_routes r where r.org_id = private.auth_org() and private.is_staff();
$$;
create or replace function save_route(p_ticket_id uuid) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare t tickets; snapshot jsonb; digest text; saved saved_routes;
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
  -- Content, not ticket identity, defines a duplicate within an organization.
  digest := md5(snapshot::text);
  insert into saved_routes(org_id,name,category_id,diagnosis_id,step_titles,created_by,knowledge,fingerprint)
    values(t.org_id, (snapshot->>'category') || ' → ' || coalesce((select short_label from diagnoses where id = t.diagnosis_id),'Needs triage'),
      t.category_id,t.diagnosis_id,'{}',auth.uid(),snapshot,digest)
    on conflict (org_id,fingerprint) where fingerprint is not null do nothing returning * into saved;
  if saved.id is null then select * into saved from saved_routes where org_id = t.org_id and fingerprint = digest; end if;
  return private.route_projection(saved);
end $$;

-- A single validation result powers the admin view and publication.
create function validate_tree(p_tree_id uuid) returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare t diagnostic_trees; issues jsonb := '[]'::jsonb; n record;
begin
  select dt.* into t from diagnostic_trees dt join diagnostic_categories c on c.id = dt.category_id
    where dt.id = p_tree_id and c.org_id = private.auth_org() and private.is_admin();
  if not found then raise exception 'Tree not found' using errcode = '42501'; end if;
  if t.root_node_id is null or not exists(select 1 from diagnostic_nodes where id = t.root_node_id and tree_id = t.id) then
    issues := issues || jsonb_build_array(jsonb_build_object('code','root','message','Set a first question in this tree.'));
  end if;
  for n in select dn.id, dn.short_label from diagnostic_nodes dn where tree_id = t.id
    and not exists(select 1 from diagnostic_options where node_id = dn.id)
  loop issues := issues || jsonb_build_array(jsonb_build_object('code','unanswered','nodeId',n.id,'message','No answers: ' || n.short_label)); end loop;
  for n in select dn.id, dn.short_label from diagnostic_nodes dn join diagnostic_options o on o.node_id = dn.id where dn.tree_id = t.id and (
    (o.next_node_id is null) = (o.diagnosis_id is null)
    or (o.next_node_id is not null and not exists(select 1 from diagnostic_nodes target where target.id = o.next_node_id and target.tree_id = t.id))
    or (o.diagnosis_id is not null and not exists(select 1 from diagnoses d where d.id = o.diagnosis_id and d.org_id = private.auth_org())))
  loop issues := issues || jsonb_build_array(jsonb_build_object('code','target','nodeId',n.id,'message','Invalid answer destination: ' || n.short_label)); end loop;
  for n in
    with recursive reachable(id) as (
      select t.root_node_id where t.root_node_id is not null
      union select o.next_node_id from diagnostic_options o join reachable r on r.id = o.node_id where o.next_node_id is not null)
    select dn.id, dn.short_label from diagnostic_nodes dn where tree_id = t.id and id not in(select id from reachable)
  loop issues := issues || jsonb_build_array(jsonb_build_object('code','unreachable','nodeId',n.id,'message','Unreachable: ' || n.short_label)); end loop;
  for n in
    with recursive walk(id,path,cycle) as (
      select id, array[id], false from diagnostic_nodes where tree_id = t.id
      union all select o.next_node_id, w.path || o.next_node_id, o.next_node_id = any(w.path)
      from walk w join diagnostic_options o on o.node_id = w.id
      join diagnostic_nodes target on target.id = o.next_node_id and target.tree_id = t.id
      where not w.cycle)
    select distinct dn.id,dn.short_label from walk w join diagnostic_nodes dn on dn.id = w.id where w.cycle
  loop issues := issues || jsonb_build_array(jsonb_build_object('code','cycle','nodeId',n.id,'message','Loop: ' || n.short_label)); end loop;
  return jsonb_build_object('valid', jsonb_array_length(issues) = 0, 'issues', issues);
end $$;

create or replace function publish_tree(p_tree_id uuid) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare t diagnostic_trees; validation jsonb;
begin
  select dt.* into t from diagnostic_trees dt join diagnostic_categories c on c.id = dt.category_id
    where dt.id = p_tree_id and c.org_id = private.auth_org() and private.is_admin() for update of dt;
  if not found then raise exception 'Tree not found' using errcode = '42501'; end if;
  if t.status <> 'draft' then raise exception 'Only drafts can be published' using errcode = '22023'; end if;
  validation := validate_tree(t.id);
  if not (validation->>'valid')::boolean then raise exception 'Fix the draft validation issues before publishing' using errcode = '22023'; end if;
  update diagnostic_trees set status = 'archived' where category_id = t.category_id and status = 'published';
  update diagnostic_trees set status = 'published', published_at = now() where id = t.id;
  return jsonb_build_object('id',t.id,'version',t.version,'status','published');
end $$;

create table admin_audit_events (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organizations(id) on delete cascade,
  category_id uuid references diagnostic_categories(id) on delete cascade,
  tree_id uuid references diagnostic_trees(id) on delete set null,
  actor_id uuid references users(id) on delete set null,
  actor_name text not null,
  action text not null,
  target text not null,
  created_at timestamptz not null default now()
);
create index admin_audit_by_category on admin_audit_events(category_id, created_at desc);
alter table admin_audit_events enable row level security;
create policy admin_reads_audit on admin_audit_events for select to authenticated
  using(org_id = private.auth_org() and private.is_admin());
revoke all on admin_audit_events from public, anon, authenticated;
grant select on admin_audit_events to authenticated;

create function private.audit_tree_change() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
declare source jsonb; tree uuid; category uuid; org uuid; action text; actor text;
begin
  -- Maintenance/fixture writes have no authenticated actor and are not UI events.
  if auth.uid() is null then
    if tg_op = 'DELETE' then return old; else return new; end if;
  end if;
  if tg_op = 'DELETE' then source := to_jsonb(old); else source := to_jsonb(new); end if;
  if tg_op = 'UPDATE' and to_jsonb(old) = to_jsonb(new) then return new; end if;
  if tg_table_name = 'diagnostic_trees' then
    tree := (source->>'id')::uuid; category := (source->>'category_id')::uuid;
    if tg_op = 'INSERT' then action := 'draft_created';
    elsif new.status = 'published' and old.status <> new.status then action := 'tree_published';
    elsif new.root_node_id is distinct from old.root_node_id then action := 'root_changed';
    else return new; end if;
  elsif tg_table_name = 'diagnostic_nodes' then
    tree := (source->>'tree_id')::uuid;
    action := case tg_op when 'INSERT' then 'question_added' when 'UPDATE' then 'question_edited' else 'question_deleted' end;
  else
    select tree_id into tree from diagnostic_nodes where id = (source->>'node_id')::uuid;
    action := case tg_op when 'INSERT' then 'answer_added' when 'UPDATE' then 'answer_changed' else 'answer_deleted' end;
  end if;
  if category is null then select category_id into category from diagnostic_trees where id = tree; end if;
  select org_id into org from diagnostic_categories where id = category;
  select full_name into actor from users where id = auth.uid();
  if org is not null and actor is not null then
    insert into admin_audit_events(org_id,category_id,tree_id,actor_id,actor_name,action,target)
      values(org,category,tree,auth.uid(),actor,action,coalesce(source->>'short_label',source->>'label','Version ' || (source->>'version')));
  end if;
  if tg_op = 'DELETE' then return old; else return new; end if;
end $$;
create trigger audit_tree_change after insert or update on diagnostic_trees for each row execute function private.audit_tree_change();
create trigger audit_tree_change after insert or update or delete on diagnostic_nodes for each row execute function private.audit_tree_change();
create trigger audit_tree_change after insert or update or delete on diagnostic_options for each row execute function private.audit_tree_change();

-- Read-only functions can rely on RLS rather than owner privileges.
alter function get_tree(uuid) security invoker;
alter function queue_stats() security invoker;
revoke all on function private.public_thread(uuid), private.route_projection(saved_routes), private.audit_tree_change() from public, anon, authenticated;
-- Required by the RLS-respecting library projection, outside the exposed schema.
grant execute on function private.route_projection(saved_routes) to authenticated;
revoke all on function get_my_tickets(), get_my_ticket(uuid), send_ticket_message(uuid,text,boolean), get_path_library(), validate_tree(uuid) from public, anon;
grant execute on function get_my_tickets(), get_my_ticket(uuid), send_ticket_message(uuid,text,boolean), get_path_library(), validate_tree(uuid) to authenticated;
