-- Private public-conversation images; no internal-note relationship or direct writes.
create table public.ticket_attachments (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id),
  ticket_id uuid not null references public.tickets(id) on delete cascade,
  message_id uuid references public.ticket_messages(id) on delete cascade,
  uploader_id uuid not null references public.users(id),
  object_path text not null unique,
  filename text not null check (length(filename) between 1 and 160 and filename ~* '\.png$'),
  media_type text not null default 'image/png' check (media_type = 'image/png'),
  size_bytes integer not null check (size_bytes between 1 and 5242880),
  width integer not null check (width between 1 and 4096),
  height integer not null check (height between 1 and 4096),
  created_at timestamptz not null default now()
);
create index ticket_attachments_message on public.ticket_attachments(message_id);
create index ticket_attachments_pending on public.ticket_attachments(uploader_id, created_at) where message_id is null;
alter table public.ticket_attachments enable row level security;
revoke all on public.ticket_attachments from public, anon, authenticated;
grant select on public.ticket_attachments to authenticated;
grant all on public.ticket_attachments to service_role;
create policy read_ticket_images on public.ticket_attachments for select to authenticated using (
  message_id is not null and org_id = private.auth_org() and exists (
    select 1 from public.tickets t where t.id = ticket_id and t.org_id = private.auth_org()
      and (t.requester_id = auth.uid() or private.is_staff())
  )
);
insert into storage.buckets(id, name, public, file_size_limit, allowed_mime_types)
values ('ticket-attachments', 'ticket-attachments', false, 5242880, array['image/png']);
-- No client INSERT/UPDATE/DELETE: MIME/byte checks cannot be bypassed via Storage.
create policy read_published_ticket_images on storage.objects for select to authenticated using (
  bucket_id = 'ticket-attachments' and exists (
    select 1 from public.ticket_attachments a where a.object_path = name and a.message_id is not null
  )
);
create function public.reserve_ticket_image(p_ticket_id uuid, p_filename text, p_size integer, p_width integer, p_height integer)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare t tickets; a ticket_attachments; image_id uuid := gen_random_uuid();
begin
  select * into t from tickets where id = p_ticket_id and org_id = private.auth_org() for update;
  if not found or (t.requester_id is distinct from auth.uid() and not private.is_staff()) then
    raise exception 'Request not found' using errcode = '42501';
  end if;
  if t.status = 'resolved' then raise exception 'Resolved request' using errcode = '22023'; end if;
  if (select count(*) from ticket_attachments where uploader_id = auth.uid() and message_id is null) >= 12 then
    raise exception 'Pending upload limit reached' using errcode = '22023';
  end if;
  insert into ticket_attachments(id, org_id, ticket_id, uploader_id, object_path, filename, size_bytes, width, height)
  values (image_id, t.org_id, t.id, auth.uid(), t.org_id || '/' || t.id || '/' || image_id || '.png',
    left(regexp_replace(p_filename, '[[:cntrl:]/\\]', '', 'g'), 156) || case when length(p_filename) > 156 then '.png' else '' end,
    p_size, p_width, p_height) returning * into a;
  return jsonb_build_object('id', a.id, 'path', a.object_path);
end $$;
revoke all on function public.reserve_ticket_image(uuid,text,integer,integer,integer) from public, anon;
grant execute on function public.reserve_ticket_image(uuid,text,integer,integer,integer) to authenticated;

-- Keep the original text-only RPC compatible with older deployed clients.
create function public.send_ticket_message_with_images(p_ticket_id uuid, p_body text, p_wait_for_reply boolean default false, p_attachment_ids uuid[] default '{}')
returns void language plpgsql security definer set search_path = public, pg_temp as $$
declare t tickets; new_message_id uuid; attachment_id uuid; a ticket_attachments;
begin
  select * into t from tickets where id = p_ticket_id and org_id = private.auth_org() for update;
  if not found or (t.requester_id is distinct from auth.uid() and not private.is_staff()) then
    raise exception 'Request not found' using errcode = '42501';
  end if;
  if p_attachment_ids is null or cardinality(p_attachment_ids) > 3 or
    cardinality(p_attachment_ids) <> (select count(distinct x) from unnest(p_attachment_ids) x) then
    raise exception 'At most three unique images' using errcode = '22023';
  end if;
  foreach attachment_id in array p_attachment_ids loop
    select * into a from ticket_attachments where id = attachment_id and ticket_id = t.id
      and org_id = t.org_id and uploader_id = auth.uid() and ticket_attachments.message_id is null for update;
    if not found or not exists (select 1 from storage.objects o where o.bucket_id = 'ticket-attachments'
      and o.name = a.object_path and o.metadata->>'mimetype' = 'image/png'
      and (o.metadata->>'size')::bigint = a.size_bytes) then
      raise exception 'Image not available' using errcode = '42501';
    end if;
  end loop;
  -- Required text provides accessible context. Original RPC owns identity and workflow.
  new_message_id := private.send_public_message(p_ticket_id, p_body, p_wait_for_reply);
  update ticket_attachments set message_id = new_message_id where id = any(p_attachment_ids);
end $$;
revoke all on function public.send_ticket_message_with_images(uuid,text,boolean,uuid[]) from public, anon;
grant execute on function public.send_ticket_message_with_images(uuid,text,boolean,uuid[]) to authenticated;
