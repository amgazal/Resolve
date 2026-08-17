begin;

create extension if not exists pgtap with schema extensions;
select plan(22);

select ok(
  (select 'security_invoker=on' = any(coalesce(reloptions, '{}'::text[]))
     from pg_class where oid = 'public.session_facts'::regclass),
  'session_facts is a security-invoker view'
);

select ok(
  (select 'security_invoker=on' = any(coalesce(reloptions, '{}'::text[]))
     from pg_class where oid = 'public.ticket_queue'::regclass),
  'ticket_queue is a security-invoker view'
);

select ok(
  (select relrowsecurity from pg_class where oid = 'public.diagnostic_sessions'::regclass),
  'diagnostic_sessions has RLS enabled'
);

select ok(
  (select relrowsecurity from pg_class where oid = 'public.tickets'::regclass),
  'tickets has RLS enabled'
);

select ok(
  (select relrowsecurity from pg_class where oid = 'public.ticket_notes'::regclass),
  'ticket_notes has RLS enabled'
);

select ok(
  exists (
    select 1 from pg_policies
     where schemaname = 'public'
       and tablename = 'diagnostic_sessions'
       and policyname = 'staff_reads_escalated_sessions'
       and position('escalated' in coalesce(qual, '')) > 0
  ),
  'staff session reads are limited to escalated sessions'
);

select ok(
  exists (
    select 1 from pg_constraint
     where conrelid = 'public.diagnostic_options'::regclass
       and conname = 'option_has_exactly_one_target'
  ),
  'diagnostic options require exactly one target'
);

select ok(
  not exists (
    select 1 from pg_policies
     where schemaname = 'public'
       and tablename = 'diagnostic_sessions'
       and cmd in ('INSERT', 'ALL')
  ),
  'diagnostic sessions cannot be inserted directly by clients'
);

select ok(
  exists (
    select 1 from pg_policies
     where schemaname = 'public'
       and tablename = 'session_answers'
       and policyname = 'own_answers'
       and position('escalated' in coalesce(qual, '')) > 0
  ),
  'staff can read answers only after a session is escalated'
);

select ok(
  exists (
    select 1 from pg_policies
     where schemaname = 'public'
       and tablename = 'step_attempts'
       and policyname = 'own_attempts'
       and position('escalated' in coalesce(qual, '')) > 0
  ),
  'staff can read attempts only after a session is escalated'
);

select ok(
  exists (
    select 1 from pg_policies
     where schemaname = 'public'
       and tablename = 'diagnostic_trees'
       and policyname = 'admin_writes_trees'
       and position('draft' in coalesce(qual, '')) > 0
       and position('draft' in coalesce(with_check, '')) > 0
  ),
  'direct admin tree edits are limited to drafts'
);

select ok(
  not exists (
    select 1 from pg_policies
     where schemaname = 'public'
       and tablename in ('diagnoses', 'troubleshooting_steps')
       and cmd in ('INSERT', 'UPDATE', 'DELETE', 'ALL')
  ),
  'diagnosis and troubleshooting wording is not browser-editable'
);

select ok(
  not exists (
    select 1 from pg_policies
     where schemaname = 'public'
       and tablename = 'tickets'
       and cmd in ('UPDATE', 'ALL')
  ),
  'ticket mutation is RPC-only'
);

select ok(
  not exists (
    select 1 from pg_policies
     where schemaname = 'public'
       and tablename = 'ticket_notes'
       and cmd in ('INSERT', 'ALL')
  ),
  'internal note creation is RPC-only'
);

select ok(
  not exists (
    select 1 from pg_policies
     where schemaname = 'public'
       and tablename = 'saved_routes'
       and cmd in ('INSERT', 'UPDATE', 'DELETE', 'ALL')
  ),
  'saved diagnostic path mutation is RPC-only'
);

-- Minimal fixture for cross-tree / cross-org integrity tests.
insert into organizations (id, name, slug) values
  ('00000000-0000-0000-0000-000000000001', 'Test One', 'test-one'),
  ('00000000-0000-0000-0000-000000000002', 'Test Two', 'test-two');

insert into tickets (id, org_id, reference, subject, priority, status)
values (
  '00000000-0000-0000-0000-000000000051',
  '00000000-0000-0000-0000-000000000001',
  'RSV-TEST',
  'Trigger test',
  'low',
  'new'
);

update tickets set status = 'resolved'
 where id = '00000000-0000-0000-0000-000000000051';
select ok(
  (select resolved_at is not null from tickets
    where id = '00000000-0000-0000-0000-000000000051'),
  'resolving a ticket stamps resolved_at'
);

update tickets set status = 'waiting'
 where id = '00000000-0000-0000-0000-000000000051';
select ok(
  (select resolved_at is null from tickets
    where id = '00000000-0000-0000-0000-000000000051'),
  'reopening a ticket clears resolved_at'
);

insert into diagnostic_categories
  (id, org_id, slug, label, short_label, icon, position)
values
  ('00000000-0000-0000-0000-000000000011', '00000000-0000-0000-0000-000000000001', 'a', 'A', 'A', 'dots', 0),
  ('00000000-0000-0000-0000-000000000012', '00000000-0000-0000-0000-000000000001', 'b', 'B', 'B', 'dots', 1);

insert into diagnoses
  (id, org_id, key, title, short_label, node_label, default_priority)
values
  ('00000000-0000-0000-0000-000000000021', '00000000-0000-0000-0000-000000000002', 'other-org', 'Other org.', 'Other', 'Other', 'low');

select throws_ok(
  $$
    insert into tickets
      (org_id, reference, subject, diagnosis_id, priority, status)
    values
      ('00000000-0000-0000-0000-000000000001', 'RSV-CROSS-ORG', 'Bad diagnosis',
       '00000000-0000-0000-0000-000000000021', 'low', 'new')
  $$,
  '23514',
  'Ticket diagnosis must belong to the ticket organization',
  'a ticket cannot reference another organization''s diagnosis'
);

insert into diagnostic_trees (id, category_id, version, status, root_label) values
  ('00000000-0000-0000-0000-000000000031', '00000000-0000-0000-0000-000000000011', 1, 'draft', 'A'),
  ('00000000-0000-0000-0000-000000000032', '00000000-0000-0000-0000-000000000012', 1, 'draft', 'B');

insert into diagnostic_nodes (id, tree_id, key, question, fact_label, short_label, position) values
  ('00000000-0000-0000-0000-000000000041', '00000000-0000-0000-0000-000000000031', 'a1', 'Question A?', 'A', 'A?', 0),
  ('00000000-0000-0000-0000-000000000042', '00000000-0000-0000-0000-000000000032', 'b1', 'Question B?', 'B', 'B?', 0);

select throws_ok(
  $$
    insert into diagnostic_options
      (node_id, label, fact_value, position, next_node_id)
    values
      ('00000000-0000-0000-0000-000000000041', 'Yes', 'Yes', 0,
       '00000000-0000-0000-0000-000000000042')
  $$,
  '23514',
  'An answer can only lead to a question in the same tree',
  'an option cannot branch into another tree'
);

select throws_ok(
  $$
    insert into diagnostic_options
      (node_id, label, fact_value, position, diagnosis_id)
    values
      ('00000000-0000-0000-0000-000000000041', 'Done', 'Done', 0,
       '00000000-0000-0000-0000-000000000021')
  $$,
  '23514',
  'An answer can only lead to a diagnosis in the same organization',
  'an option cannot terminate in another organization''s diagnosis'
);

insert into diagnoses
  (id, org_id, key, title, short_label, node_label, default_priority)
values
  ('00000000-0000-0000-0000-000000000022', '00000000-0000-0000-0000-000000000001', 'dx-a', 'Diagnosis A.', 'A', 'A', 'low'),
  ('00000000-0000-0000-0000-000000000023', '00000000-0000-0000-0000-000000000001', 'dx-b', 'Diagnosis B.', 'B', 'B', 'low');

insert into diagnostic_options
  (id, node_id, label, fact_value, position, diagnosis_id)
values
  ('00000000-0000-0000-0000-000000000043', '00000000-0000-0000-0000-000000000042',
   'Finish', 'Finish', 0, '00000000-0000-0000-0000-000000000022');

insert into troubleshooting_steps
  (id, diagnosis_id, position, title, detail)
values
  ('00000000-0000-0000-0000-000000000061', '00000000-0000-0000-0000-000000000023',
   1, 'Wrong diagnosis step', 'Used only to test the history guard.');

insert into diagnostic_sessions
  (id, org_id, category_id, tree_id, diagnosis_id, status)
values
  ('00000000-0000-0000-0000-000000000071', '00000000-0000-0000-0000-000000000001',
   '00000000-0000-0000-0000-000000000011', '00000000-0000-0000-0000-000000000031',
   '00000000-0000-0000-0000-000000000022', 'in_progress');

select throws_ok(
  $$
    insert into session_answers
      (session_id, node_id, option_id, position)
    values
      ('00000000-0000-0000-0000-000000000071',
       '00000000-0000-0000-0000-000000000042',
       '00000000-0000-0000-0000-000000000043', 1)
  $$,
  '23514',
  'Answer question must belong to the session tree',
  'session answer history cannot jump into another tree'
);

select throws_ok(
  $$
    insert into step_attempts (session_id, step_id, outcome)
    values
      ('00000000-0000-0000-0000-000000000071',
       '00000000-0000-0000-0000-000000000061', 'failed')
  $$,
  '23514',
  'Troubleshooting step must belong to the session diagnosis',
  'step attempt history cannot use another diagnosis''s step'
);

select * from finish();
rollback;
