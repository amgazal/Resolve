-- Preserve status on ordinary send; claim unowned tickets atomically when waiting.
create function private.send_public_message(p_ticket_id uuid, p_body text, p_wait_for_reply boolean default false)
returns uuid language plpgsql security definer set search_path = public, pg_temp as $$
declare t tickets; actor users; body text := btrim(replace(p_body, E'\r\n', E'\n'), E' \t\r\n'); owner_reply boolean; message_id uuid;
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
    values(t.id, actor.id, actor.full_name, case when owner_reply then 'requester' else 'staff' end, body) returning id into message_id;
  if owner_reply and t.status = 'waiting' then
    update tickets set status = 'needs_review' where id = t.id;
  elsif not owner_reply and p_wait_for_reply then
    update tickets set status = 'waiting', assignee_id = coalesce(assignee_id, actor.id), first_response_at = coalesce(first_response_at, now()) where id = t.id;
  end if;
  return message_id;
end $$;

revoke all on function private.send_public_message(uuid,text,boolean) from public, anon, authenticated;
create or replace function public.send_ticket_message(p_ticket_id uuid, p_body text, p_wait_for_reply boolean default false)
returns void language plpgsql security definer set search_path = public, pg_temp as $$
begin perform private.send_public_message(p_ticket_id, p_body, p_wait_for_reply); end $$;
