-- =====================================================================
--  RESOLVE — row-level security
--
--  This file replaces the x-user-role header from the prototype.
--
--  The old approach asked the client what it was allowed to do. This one
--  never asks. Every policy resolves the caller's role by looking up
--  auth.uid() in public.users — a value the client cannot forge, because
--  it comes from the verified JWT, not the request body. A user who edits
--  their browser storage, replays someone else's request, or calls the
--  REST API directly still gets exactly their own rows back.
--
--  Roles, as specified:
--    end_user    create and view their own sessions and tickets
--    technician  view the queue, assign, note, resolve
--    admin       everything above, plus edit diagnostic trees
-- =====================================================================

-- ---------------------------------------------------------------- helpers

-- stable = evaluated once per statement, not once per row.
create or replace function auth_org() returns uuid
language sql stable security definer set search_path = public as $$
  select org_id from users where id = auth.uid();
$$;

create or replace function auth_role() returns user_role
language sql stable security definer set search_path = public as $$
  select role from users where id = auth.uid();
$$;

create or replace function is_staff() returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce(auth_role() in ('technician', 'admin'), false);
$$;

create or replace function is_admin() returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce(auth_role() = 'admin', false);
$$;

-- ---------------------------------------------------------------- enable

alter table organizations         enable row level security;
alter table users                 enable row level security;
alter table diagnostic_categories enable row level security;
alter table diagnoses             enable row level security;
alter table troubleshooting_steps enable row level security;
alter table diagnostic_trees      enable row level security;
alter table diagnostic_nodes      enable row level security;
alter table diagnostic_options    enable row level security;
alter table diagnostic_sessions   enable row level security;
alter table session_answers       enable row level security;
alter table step_attempts         enable row level security;
alter table tickets               enable row level security;
alter table ticket_notes          enable row level security;
alter table saved_routes          enable row level security;

-- ---------------------------------------------------------------- people

create policy org_readable on organizations
  for select using (id = auth_org());

create policy read_own_profile on users
  for select using (id = auth.uid());

create policy staff_read_colleagues on users
  for select using (org_id = auth_org() and is_staff());

-- Only admins change roles, and never their own — no self-promotion.
create policy admin_manages_users on users
  for update using (org_id = auth_org() and is_admin() and id <> auth.uid())
  with check (org_id = auth_org() and is_admin() and id <> auth.uid());

-- ---------------------------------------------------------------- catalog

-- Everyone in the org reads the catalog; only admins write it.
create policy read_categories on diagnostic_categories
  for select using (org_id = auth_org());
create policy admin_writes_categories on diagnostic_categories
  for all using (org_id = auth_org() and is_admin())
  with check (org_id = auth_org() and is_admin());

create policy read_diagnoses on diagnoses
  for select using (org_id = auth_org());

create policy read_steps on troubleshooting_steps
  for select using (exists (
    select 1 from diagnoses d where d.id = diagnosis_id and d.org_id = auth_org()));

-- Diagnosis wording and troubleshooting steps are seed-managed in this
-- version. The admin UI edits only versioned trees. Keeping direct browser
-- writes closed prevents an admin session from accidentally rewriting the
-- wording underneath historical sessions. If diagnosis editing is added,
-- version or snapshot that content first.

-- ---------------------------------------------------------------- trees

-- End users may read only what is live. Drafts are an admin's workspace,
-- and a half-finished question should never reach somebody who is stuck.
create policy read_published_trees on diagnostic_trees
  for select using (
    exists (select 1 from diagnostic_categories c
             where c.id = category_id and c.org_id = auth_org())
    and (status = 'published' or is_admin()));

-- Direct admin writes are restricted to drafts. Publishing/archiving goes
-- through publish_tree(), so a browser cannot mutate the live version in place.
create policy admin_writes_trees on diagnostic_trees
  for all using (
    status = 'draft' and is_admin() and exists (
      select 1 from diagnostic_categories c where c.id = category_id and c.org_id = auth_org()))
  with check (
    status = 'draft' and is_admin() and exists (
      select 1 from diagnostic_categories c where c.id = category_id and c.org_id = auth_org()));

-- Question and answer content is not exposed directly to end users. The
-- traversal RPCs return only the current question. Admins need the full
-- draft/published content for the authoring surface.
create policy read_nodes on diagnostic_nodes
  for select using (is_admin() and exists (
    select 1 from diagnostic_trees t
      join diagnostic_categories c on c.id = t.category_id
     where t.id = tree_id and c.org_id = auth_org()));

create policy admin_writes_nodes on diagnostic_nodes
  for all using (is_admin() and exists (
    select 1 from diagnostic_trees t
      join diagnostic_categories c on c.id = t.category_id
     where t.id = tree_id and c.org_id = auth_org() and t.status = 'draft'))
  with check (is_admin() and exists (
    select 1 from diagnostic_trees t
      join diagnostic_categories c on c.id = t.category_id
     where t.id = tree_id and c.org_id = auth_org() and t.status = 'draft'));

create policy read_options on diagnostic_options
  for select using (is_admin() and exists (
    select 1 from diagnostic_nodes n
      join diagnostic_trees t on t.id = n.tree_id
      join diagnostic_categories c on c.id = t.category_id
     where n.id = node_id and c.org_id = auth_org()));

create policy admin_writes_options on diagnostic_options
  for all using (is_admin() and exists (
    select 1 from diagnostic_nodes n
      join diagnostic_trees t on t.id = n.tree_id
      join diagnostic_categories c on c.id = t.category_id
     where n.id = node_id and c.org_id = auth_org() and t.status = 'draft'))
  with check (is_admin() and exists (
    select 1 from diagnostic_nodes n
      join diagnostic_trees t on t.id = n.tree_id
      join diagnostic_categories c on c.id = t.category_id
     where n.id = node_id and c.org_id = auth_org() and t.status = 'draft'));

-- ---------------------------------------------------------------- sessions

create policy own_sessions on diagnostic_sessions
  for select using (user_id = auth.uid());

create policy staff_reads_escalated_sessions on diagnostic_sessions
  for select using (org_id = auth_org() and is_staff() and status = 'escalated');

-- Session creation and traversal happen only through the functions in
-- 03_functions.sql. There is deliberately no direct INSERT or UPDATE policy:
-- otherwise a caller could forge category/tree/diagnosis foreign keys and
-- create a history the database never actually observed.

create policy own_answers on session_answers
  for select using (exists (
    select 1 from diagnostic_sessions s
     where s.id = session_id
       and (s.user_id = auth.uid()
            or (s.org_id = auth_org() and is_staff() and s.status = 'escalated'))));

create policy own_attempts on step_attempts
  for select using (exists (
    select 1 from diagnostic_sessions s
     where s.id = session_id
       and (s.user_id = auth.uid()
            or (s.org_id = auth_org() and is_staff() and s.status = 'escalated'))));

-- ---------------------------------------------------------------- tickets

-- A requester sees their own tickets. Staff see the whole org queue.
create policy read_own_tickets on tickets
  for select using (requester_id = auth.uid());

create policy staff_reads_queue on tickets
  for select using (org_id = auth_org() and is_staff());

-- Ticket mutation is RPC-only (`update_ticket`). There is deliberately no
-- direct UPDATE policy, so a technician cannot rewrite requester/session/
-- diagnosis evidence by bypassing the UI.

-- Internal notes are invisible to the person who raised the ticket.
create policy read_notes on ticket_notes
  for select using (exists (
    select 1 from tickets t
     where t.id = ticket_id
       and ((t.org_id = auth_org() and is_staff())
            or (t.requester_id = auth.uid() and is_internal = false))));

-- Notes are written only through `add_ticket_note`, which always stamps the
-- signed-in technician as author and always creates an internal note in this
-- version. Public requester replies can get their own explicit RPC later.

create policy read_routes on saved_routes
  for select using (org_id = auth_org() and is_staff());

-- Saved diagnostic paths are created only through `save_route`.
