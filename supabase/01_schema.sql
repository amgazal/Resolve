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
