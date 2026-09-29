-- Owner-only metadata corrections; traversal and category remain server-owned.
create function public.update_session_details(p_session_id uuid, p_description text, p_device text, p_operating_system text)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare s diagnostic_sessions;
begin
  select * into s from diagnostic_sessions where id = p_session_id for update;
  if not found or s.user_id is distinct from auth.uid() or s.org_id is distinct from private.auth_org() then
    raise exception 'Not your session' using errcode = '42501';
  end if;
  if s.status <> 'in_progress' then raise exception 'This session is no longer active' using errcode = '22023'; end if;
  if length(coalesce(p_description,'')) > 4000 or length(coalesce(p_device,'')) > 200 or length(coalesce(p_operating_system,'')) > 200 then
    raise exception 'Text exceeds the allowed length' using errcode = '23514';
  end if;
  update diagnostic_sessions set description = btrim(coalesce(p_description,'')),
    device = btrim(coalesce(p_device,'')), operating_system = btrim(coalesce(p_operating_system,'')) where id = s.id;
  return public.get_session_state(s.id);
end $$;
revoke all on function public.update_session_details(uuid,text,text,text) from public, anon;
grant execute on function public.update_session_details(uuid,text,text,text) to authenticated;

-- A confirmed rewind removes obsolete troubleshooting results atomically.
create or replace function public.undo_last_answer(p_session_id uuid)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare s diagnostic_sessions; v_node uuid;
begin
  select * into s from diagnostic_sessions where id = p_session_id for update;
  if not found or s.user_id is distinct from auth.uid() or s.org_id is distinct from private.auth_org() then
    raise exception 'Not your session' using errcode = '42501';
  end if;
  if s.status <> 'in_progress' then raise exception 'This session is no longer active' using errcode = '22023'; end if;
  delete from session_answers where id = (select id from session_answers where session_id = s.id order by position desc limit 1)
    returning node_id into v_node;
  if v_node is null then raise exception 'There is nothing to undo' using errcode = '22023'; end if;
  delete from step_attempts where session_id = s.id;
  update diagnostic_sessions set current_node_id = v_node, diagnosis_id = null where id = s.id;
  return public.get_session_state(s.id);
end $$;

-- Public activity only: internal notes and generic ticket updated_at are excluded.
create or replace function public.get_my_tickets() returns jsonb
language sql stable set search_path = public, pg_temp as $$
  select coalesce(jsonb_agg(jsonb_build_object('id', t.id, 'reference', t.reference,
    'subject', t.subject, 'status', t.status, 'categoryLabel', coalesce(c.label, 'General'),
    'createdAt', t.created_at, 'lastActivityAt', greatest(t.created_at, t.resolved_at,
      (select max(m.created_at) from ticket_messages m where m.ticket_id = t.id)))
    order by greatest(t.created_at, t.resolved_at, (select max(m.created_at) from ticket_messages m where m.ticket_id = t.id)) desc, t.id), '[]'::jsonb)
  from tickets t left join diagnostic_categories c on c.id = t.category_id
  where t.requester_id = auth.uid() and t.org_id = private.auth_org();
$$;
