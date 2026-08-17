-- Resolve database migration snapshot
-- Generated from 01_schema.sql, 02_policies.sql, and 03_functions.sql.
-- Keep the numbered source files as the readable source of truth.

-- =====================================================================
--  RESOLVE — schema
--  Postgres 15 / Supabase
--
--  Run order: 01_schema.sql → 02_policies.sql → 03_functions.sql
--
--  One addition to the table list in the brief: diagnostic_trees.
--  Without it, an admin editing a live tree would change questions and
--  branches underneath sessions that are already underway. Trees are
--  versioned; a session pins the tree version it started with. Diagnosis
--  titles and troubleshooting-step wording are shared definitions in this
--  version and are deliberately not browser-editable.
-- =====================================================================

create extension if not exists pgcrypto;

-- ---------------------------------------------------------------- types

create type user_role       as enum ('end_user', 'technician', 'admin');
create type tree_status     as enum ('draft', 'published', 'archived');
create type session_status  as enum ('in_progress', 'resolved', 'escalated', 'abandoned');
create type ticket_status   as enum ('new', 'assigned', 'waiting', 'needs_review', 'resolved');
create type priority_level  as enum ('low', 'medium', 'high');
create type attempt_outcome as enum ('fixed', 'failed', 'skipped');

-- ---------------------------------------------------------------- people

create table organizations (
  id         uuid primary key default gen_random_uuid(),
  name       text not null,
  slug       text not null unique,
  created_at timestamptz not null default now()
);

-- Mirrors auth.users. The role lives HERE, in the database, and is the
-- only thing that grants technician or admin powers. Nothing a client
-- sends can change it.
create table users (
  id         uuid primary key references auth.users(id) on delete cascade,
  org_id     uuid not null references organizations(id) on delete cascade,
  full_name  text not null,
  email      text not null,
  role       user_role not null default 'end_user',
  created_at timestamptz not null default now(),
  unique (org_id, email)
);

create index users_org_role_idx on users (org_id, role);

-- New signups land as end users in the default org. Promotion to
-- technician or admin is a deliberate act by an existing admin.
create or replace function handle_new_auth_user() returns trigger
language plpgsql security definer set search_path = public as $$
declare default_org uuid;
begin
  select id into default_org from organizations order by created_at limit 1;
  if default_org is null then
    raise exception 'No Resolve organization exists yet. Run the seed before creating users.';
  end if;

  insert into public.users (id, org_id, full_name, email, role)
  values (new.id, default_org,
          coalesce(new.raw_user_meta_data->>'full_name', split_part(new.email, '@', 1)),
          new.email, 'end_user')
  on conflict (id) do nothing;
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function handle_new_auth_user();

-- ---------------------------------------------------------------- catalog

create table diagnostic_categories (
  id          uuid primary key default gen_random_uuid(),
  org_id      uuid not null references organizations(id) on delete cascade,
  slug        text not null,
  label       text not null,               -- "Wi-Fi & Network"
  short_label text not null,               -- "Wi-Fi" (queue column)
  hint        text,                        -- "No internet, drop-outs, slow speeds"
  icon        text not null default 'dots',
  position    int  not null default 0,
  is_active   boolean not null default true,
  unique (org_id, slug),
  constraint category_text_present check (
    btrim(slug) <> '' and btrim(label) <> '' and btrim(short_label) <> ''),
  constraint category_position_nonnegative check (position >= 0)
);

create table diagnoses (
  id               uuid primary key default gen_random_uuid(),
  org_id           uuid not null references organizations(id) on delete cascade,
  key              text not null,          -- 'dns'
  title            text not null,          -- full sentence shown to the user
  short_label      text not null,          -- "Likely DNS"
  node_label       text not null,          -- "DNS / local config" (trail terminal)
  default_priority priority_level not null default 'medium',
  is_active        boolean not null default true,
  unique (org_id, key),
  constraint diagnosis_text_present check (
    btrim(key) <> '' and btrim(title) <> '' and btrim(short_label) <> '' and btrim(node_label) <> '')
);

create table troubleshooting_steps (
  id           uuid primary key default gen_random_uuid(),
  diagnosis_id uuid not null references diagnoses(id) on delete cascade,
  position     int  not null,
  title        text not null,
  detail       text not null,
  unique (diagnosis_id, position) deferrable initially deferred,
  constraint troubleshooting_step_text_present check (btrim(title) <> '' and btrim(detail) <> ''),
  constraint troubleshooting_step_position_positive check (position > 0)
);

-- ---------------------------------------------------------------- trees

create table diagnostic_trees (
  id           uuid primary key default gen_random_uuid(),
  category_id  uuid not null references diagnostic_categories(id) on delete cascade,
  version      int  not null,
  status       tree_status not null default 'draft',
  root_label   text not null,              -- "Wi-Fi issue" (trail origin)
  root_node_id uuid,                       -- FK added after diagnostic_nodes
  created_by   uuid references users(id),
  created_at   timestamptz not null default now(),
  published_at timestamptz,
  unique (category_id, version)
);

-- At most one live tree per category.
create unique index one_published_tree_per_category
  on diagnostic_trees (category_id) where status = 'published';

-- At most one draft per category, so "edit" always means one thing.
create unique index one_draft_tree_per_category
  on diagnostic_trees (category_id) where status = 'draft';

create table diagnostic_nodes (
  id          uuid primary key default gen_random_uuid(),
  tree_id     uuid not null references diagnostic_trees(id) on delete cascade,
  key         text not null,               -- 'others' — stable across versions
  question    text not null,               -- shown to the user
  fact_label  text not null,               -- "Other devices"  → What we know
  short_label text not null,               -- "Other devices work?" → the trail
  position    int  not null default 0,
  unique (tree_id, key),
  constraint diagnostic_node_text_present check (
    btrim(key) <> '' and btrim(question) <> '' and btrim(fact_label) <> '' and btrim(short_label) <> ''),
  constraint diagnostic_node_position_nonnegative check (position >= 0)
);

create table diagnostic_options (
  id           uuid primary key default gen_random_uuid(),
  node_id      uuid not null references diagnostic_nodes(id) on delete cascade,
  label        text not null,              -- "Yes"
  fact_value   text not null,              -- "Working"
  position     int  not null default 0,
  next_node_id uuid references diagnostic_nodes(id) on delete restrict,
  diagnosis_id uuid references diagnoses(id) on delete restrict,

  -- An answer either continues the tree or ends it. Never both, never
  -- neither. This is what makes it impossible to author a dead end.
  constraint option_has_exactly_one_target check (
    (next_node_id is not null and diagnosis_id is null) or
    (next_node_id is null     and diagnosis_id is not null)
  ),
  constraint diagnostic_option_text_present check (btrim(label) <> '' and btrim(fact_value) <> ''),
  constraint diagnostic_option_position_nonnegative check (position >= 0)
);

-- Cross-row integrity that a plain foreign key cannot express. A branch may
-- only point inside its own tree, and a terminal diagnosis must belong to
-- the same organization as that tree. This keeps an admin typo (or a
-- forged write) from quietly joining two unrelated workflows.
create or replace function validate_diagnostic_option_target() returns trigger
language plpgsql set search_path = public as $$
declare
  v_tree_id uuid;
  v_org_id uuid;
  v_target_tree_id uuid;
  v_dx_org_id uuid;
begin
  select n.tree_id, c.org_id into v_tree_id, v_org_id
    from diagnostic_nodes n
    join diagnostic_trees t on t.id = n.tree_id
    join diagnostic_categories c on c.id = t.category_id
   where n.id = new.node_id;

  if v_tree_id is null then
    raise exception 'Option source question does not exist';
  end if;

  if new.next_node_id is not null then
    select tree_id into v_target_tree_id from diagnostic_nodes where id = new.next_node_id;
    if v_target_tree_id is distinct from v_tree_id then
      raise exception 'An answer can only lead to a question in the same tree'
        using errcode = '23514';
    end if;
  end if;

  if new.diagnosis_id is not null then
    select org_id into v_dx_org_id from diagnoses where id = new.diagnosis_id;
    if v_dx_org_id is distinct from v_org_id then
      raise exception 'An answer can only lead to a diagnosis in the same organization'
        using errcode = '23514';
    end if;
  end if;

  return new;
end;
$$;

create trigger diagnostic_options_target_scope
  before insert or update of node_id, next_node_id, diagnosis_id on diagnostic_options
  for each row execute function validate_diagnostic_option_target();

alter table diagnostic_trees
  add constraint diagnostic_trees_root_fk
  foreign key (root_node_id) references diagnostic_nodes(id) on delete restrict;

create or replace function validate_tree_root() returns trigger
language plpgsql set search_path = public as $$
declare v_root_tree uuid;
begin
  if new.root_node_id is null then return new; end if;
  select tree_id into v_root_tree from diagnostic_nodes where id = new.root_node_id;
  if v_root_tree is distinct from new.id then
    raise exception 'The first question must belong to this tree' using errcode = '23514';
  end if;
  return new;
end;
$$;

create trigger diagnostic_trees_root_scope
  before insert or update of root_node_id on diagnostic_trees
  for each row execute function validate_tree_root();

create index diagnostic_nodes_tree_idx     on diagnostic_nodes (tree_id, position);
create index diagnostic_options_node_idx   on diagnostic_options (node_id, position);

-- ---------------------------------------------------------------- sessions

create table diagnostic_sessions (
  id               uuid primary key default gen_random_uuid(),
  org_id           uuid not null references organizations(id) on delete cascade,
  user_id          uuid references users(id) on delete set null,
  category_id      uuid not null references diagnostic_categories(id) on delete restrict,
  tree_id          uuid not null references diagnostic_trees(id) on delete restrict,
  description      text not null default '',   -- what they typed, verbatim
  device           text,
  operating_system text,
  current_node_id  uuid references diagnostic_nodes(id) on delete set null,
  diagnosis_id     uuid references diagnoses(id) on delete set null,
  status           session_status not null default 'in_progress',
  created_at       timestamptz not null default now(),
  ended_at         timestamptz
);

create index diagnostic_sessions_user_idx on diagnostic_sessions (user_id, created_at desc);

-- Keep every reference on a session inside the organization and tree it
-- started with. The workflow functions already do this; the trigger makes
-- the invariant survive future code changes and privileged maintenance.
create or replace function validate_session_scope() returns trigger
language plpgsql set search_path = public as $$
declare
  v_category_org uuid;
  v_tree_category uuid;
  v_node_tree uuid;
  v_dx_org uuid;
begin
  select org_id into v_category_org from diagnostic_categories where id = new.category_id;
  if v_category_org is distinct from new.org_id then
    raise exception 'Session category must belong to the session organization' using errcode = '23514';
  end if;

  select category_id into v_tree_category from diagnostic_trees where id = new.tree_id;
  if v_tree_category is distinct from new.category_id then
    raise exception 'Session tree must belong to the selected category' using errcode = '23514';
  end if;

  if new.current_node_id is not null then
    select tree_id into v_node_tree from diagnostic_nodes where id = new.current_node_id;
    if v_node_tree is distinct from new.tree_id then
      raise exception 'Current question must belong to the session tree' using errcode = '23514';
    end if;
  end if;

  if new.diagnosis_id is not null then
    select org_id into v_dx_org from diagnoses where id = new.diagnosis_id;
    if v_dx_org is distinct from new.org_id then
      raise exception 'Session diagnosis must belong to the session organization' using errcode = '23514';
    end if;
  end if;

  return new;
end;
$$;

create trigger diagnostic_sessions_scope
  before insert or update of org_id, category_id, tree_id, current_node_id, diagnosis_id
  on diagnostic_sessions
  for each row execute function validate_session_scope();

create table session_answers (
  id          uuid primary key default gen_random_uuid(),
  session_id  uuid not null references diagnostic_sessions(id) on delete cascade,
  node_id     uuid not null references diagnostic_nodes(id) on delete restrict,
  option_id   uuid not null references diagnostic_options(id) on delete restrict,
  position    int  not null,
  answered_at timestamptz not null default now(),
  unique (session_id, position),
  constraint session_answer_position_positive check (position > 0)
);

create table step_attempts (
  id           uuid primary key default gen_random_uuid(),
  session_id   uuid not null references diagnostic_sessions(id) on delete cascade,
  step_id      uuid not null references troubleshooting_steps(id) on delete restrict,
  outcome      attempt_outcome not null,
  attempted_at timestamptz not null default now(),
  unique (session_id, step_id)
);

-- Answer/attempt rows carry historical evidence, so keep their references
-- consistent even if a privileged maintenance script writes them directly.
create or replace function validate_session_answer_scope() returns trigger
language plpgsql set search_path = public as $$
declare
  v_session_tree uuid;
  v_node_tree uuid;
  v_option_node uuid;
begin
  select tree_id into v_session_tree from diagnostic_sessions where id = new.session_id;
  select tree_id into v_node_tree from diagnostic_nodes where id = new.node_id;
  select node_id into v_option_node from diagnostic_options where id = new.option_id;

  if v_node_tree is distinct from v_session_tree then
    raise exception 'Answer question must belong to the session tree' using errcode = '23514';
  end if;
  if v_option_node is distinct from new.node_id then
    raise exception 'Answer option must belong to the recorded question' using errcode = '23514';
  end if;
  return new;
end;
$$;

create trigger session_answers_scope
  before insert or update of session_id, node_id, option_id on session_answers
  for each row execute function validate_session_answer_scope();

create or replace function validate_step_attempt_scope() returns trigger
language plpgsql set search_path = public as $$
declare
  v_session_diagnosis uuid;
  v_step_diagnosis uuid;
begin
  select diagnosis_id into v_session_diagnosis from diagnostic_sessions where id = new.session_id;
  select diagnosis_id into v_step_diagnosis from troubleshooting_steps where id = new.step_id;
  if v_session_diagnosis is null or v_step_diagnosis is distinct from v_session_diagnosis then
    raise exception 'Troubleshooting step must belong to the session diagnosis' using errcode = '23514';
  end if;
  return new;
end;
$$;

create trigger step_attempts_scope
  before insert or update of session_id, step_id on step_attempts
  for each row execute function validate_step_attempt_scope();

-- ---------------------------------------------------------------- tickets

create table tickets (
  id                uuid primary key default gen_random_uuid(),
  org_id            uuid not null references organizations(id) on delete cascade,
  session_id        uuid unique references diagnostic_sessions(id) on delete set null,
  reference         text not null,                -- RSV-2481
  requester_id      uuid references users(id) on delete set null,
  assignee_id       uuid references users(id) on delete set null,
  category_id       uuid references diagnostic_categories(id) on delete set null,
  diagnosis_id      uuid references diagnoses(id) on delete set null,
  subject           text not null,
  user_note         text,
  priority          priority_level not null default 'medium',
  status            ticket_status  not null default 'new',
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  first_response_at timestamptz,
  resolved_at       timestamptz,
  unique (org_id, reference)
);

create index tickets_queue_idx     on tickets (org_id, status, priority, created_at desc);
create index tickets_requester_idx on tickets (requester_id, created_at desc);

create or replace function validate_ticket_scope() returns trigger
language plpgsql set search_path = public as $$
declare v_org uuid;
begin
  if new.session_id is not null then
    select org_id into v_org from diagnostic_sessions where id = new.session_id;
    if v_org is distinct from new.org_id then
      raise exception 'Ticket session must belong to the ticket organization' using errcode = '23514';
    end if;
  end if;

  if new.requester_id is not null then
    select org_id into v_org from users where id = new.requester_id;
    if v_org is distinct from new.org_id then
      raise exception 'Ticket requester must belong to the ticket organization' using errcode = '23514';
    end if;
  end if;

  if new.assignee_id is not null then
    select org_id into v_org from users where id = new.assignee_id;
    if v_org is distinct from new.org_id then
      raise exception 'Ticket assignee must belong to the ticket organization' using errcode = '23514';
    end if;
  end if;

  if new.category_id is not null then
    select org_id into v_org from diagnostic_categories where id = new.category_id;
    if v_org is distinct from new.org_id then
      raise exception 'Ticket category must belong to the ticket organization' using errcode = '23514';
    end if;
  end if;

  if new.diagnosis_id is not null then
    select org_id into v_org from diagnoses where id = new.diagnosis_id;
    if v_org is distinct from new.org_id then
      raise exception 'Ticket diagnosis must belong to the ticket organization' using errcode = '23514';
    end if;
  end if;

  return new;
end;
$$;

create trigger tickets_scope
  before insert or update of org_id, session_id, requester_id, assignee_id, category_id, diagnosis_id
  on tickets
  for each row execute function validate_ticket_scope();

create table ticket_notes (
  id          uuid primary key default gen_random_uuid(),
  ticket_id   uuid not null references tickets(id) on delete cascade,
  author_id   uuid references users(id) on delete set null,
  body        text not null,
  is_internal boolean not null default true,      -- internal notes never reach the requester
  created_at  timestamptz not null default now(),
  constraint ticket_note_body_present check (btrim(body) <> '' and char_length(body) <= 2000)
);

create index ticket_notes_ticket_idx on ticket_notes (ticket_id, created_at);

create table saved_routes (
  id               uuid primary key default gen_random_uuid(),
  org_id           uuid not null references organizations(id) on delete cascade,
  name             text not null,
  category_id      uuid references diagnostic_categories(id) on delete set null,
  diagnosis_id     uuid references diagnoses(id) on delete set null,
  source_ticket_id uuid references tickets(id) on delete set null,
  step_titles      text[] not null default '{}',
  use_count        int  not null default 1,
  created_by       uuid references users(id) on delete set null,
  created_at       timestamptz not null default now(),
  unique (org_id, name)
);

-- ---------------------------------------------------------------- views

-- The ordered facts of a session: what "What we know" renders, what the
-- handoff summary prints, and what the technician reads. One source.
create view session_facts with (security_invoker = true) as
  select a.session_id,
         a.position,
         n.fact_label  as label,
         o.fact_value  as value,
         n.short_label as trail_label,
         o.label       as answer_label
    from session_answers a
    join diagnostic_nodes   n on n.id = a.node_id
    join diagnostic_options o on o.id = a.option_id;

create view ticket_queue with (security_invoker = true) as
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
    left join diagnostic_sessions   s   on s.id   = t.session_id;

-- ---------------------------------------------------------------- triggers

create or replace function touch_updated_at() returns trigger
language plpgsql as $$
begin new.updated_at = now(); return new; end;
$$;

create trigger tickets_touch before update on tickets
  for each row execute function touch_updated_at();

create or replace function stamp_resolved_at() returns trigger
language plpgsql as $$
begin
  if new.status = 'resolved' and old.status <> 'resolved' then
    new.resolved_at = now();
  elsif new.status <> 'resolved' then
    new.resolved_at = null;
  end if;
  return new;
end;
$$;

create trigger tickets_stamp_resolved before update on tickets
  for each row execute function stamp_resolved_at();


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
