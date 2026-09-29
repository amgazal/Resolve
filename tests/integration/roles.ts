/** Real password-authenticated requests. Service access is fixture setup/cleanup only. */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';

const local = JSON.parse(execFileSync('npx', ['supabase', 'status', '-o', 'json'], { encoding: 'utf8' }));
const url = local.API_URL;
assert(['localhost', '127.0.0.1'].includes(new URL(url).hostname), 'Tests only run against local Supabase');
const options = { auth: { persistSession: false, autoRefreshToken: false } };
const service = createClient(url, local.SERVICE_ROLE_KEY, options);
const anonymous = createClient(url, local.ANON_KEY, options);
const orgs = [randomUUID(), randomUUID()];
const userIds: string[] = [];
const trees: string[] = [];
const categories: string[] = [];
const clients: SupabaseClient[] = [];
const tag = randomUUID().slice(0, 8);
let checks = 0;
function ok(result: any) { assert.equal(result.error, null, JSON.stringify(result.error)); return result.data; }
function denied(result: any) { assert.ok(result.error || (Array.isArray(result.data) && result.data.length === 0) || result.data === null, 'Expected denial or no visible rows'); checks++; }
async function rpc(client: SupabaseClient, name: string, args: object = {}) { return ok(await client.rpc(name, args)); }
async function identity(org: string, role: string, name: string) {
  const email = `${tag}-${name}@resolve.test`, password = `Resolve-${randomUUID()}!`;
  const data = ok(await service.auth.admin.createUser({ email, password, email_confirm: true, user_metadata: { full_name: name, role: "admin", org_id: org } }));
  userIds.push(data.user.id);
  assert.equal(ok(await service.from('users').select('id').eq('id', data.user.id)).length, 0); checks++;
  const client = createClient(url, local.ANON_KEY, options);
  ok(await client.auth.signInWithPassword({ email, password })); clients.push(client);
  assert.equal(ok(await client.from('users').select('id')).length, 0); checks++;
  assert.equal(ok(await client.from('diagnostic_categories').select('id')).length, 0); checks++;
  denied(await client.from('users').insert({ id: data.user.id, org_id: org, role: 'admin', email, full_name: name }));
  ok(await service.from('users').insert({ id: data.user.id, org_id: org, role, email, full_name: name }));
  return client;
}
async function fixture(org: string) {
  const category = randomUUID(), tree = randomUUID(), node = randomUUID(), diagnosis = randomUUID(), option = randomUUID(), step = randomUUID();
  categories.push(category); trees.push(tree);
  ok(await service.from('diagnostic_categories').insert({ id: category, org_id: org, slug: tag, label: 'Test support', short_label: 'Test' }));
  ok(await service.from('diagnoses').insert({ id: diagnosis, org_id: org, key: tag, title: 'Test diagnosis', short_label: 'Test', node_label: 'Test' }));
  ok(await service.from('troubleshooting_steps').insert({ id: step, diagnosis_id: diagnosis, position: 1, title: 'Try this', detail: 'Check the connection.' }));
  ok(await service.from('diagnostic_trees').insert({ id: tree, category_id: category, version: 1, root_label: 'Test' }));
  ok(await service.from('diagnostic_nodes').insert({ id: node, tree_id: tree, key: 'root', question: 'Does it work?', fact_label: 'Connection', short_label: 'Works?' }));
  ok(await service.from('diagnostic_options').insert({ id: option, node_id: node, label: 'No', fact_value: 'Not working', diagnosis_id: diagnosis }));
  ok(await service.from('diagnostic_trees').update({ root_node_id: node, status: 'published' }).eq('id', tree));
  return { category, tree, node, option, step };
}
try {
  ok(await service.from('organizations').insert(orgs.map((id, i) => ({ id, name: `Test ${i}`, slug: `${tag}-${i}` }))));
  const a = await identity(orgs[0]!, 'end_user', 'requester-a');
  const b = await identity(orgs[0]!, 'end_user', 'requester-b');
  const tech = await identity(orgs[0]!, 'technician', 'technician');
  const admin = await identity(orgs[0]!, 'admin', 'admin');
  const other = await identity(orgs[1]!, 'admin', 'other-org');
  const one = await fixture(orgs[0]!); const two = await fixture(orgs[1]!);
  const input = (category = one.category) => ({ p_category_id: category, p_description: '  Connection failed  ', p_device: ' Laptop ', p_operating_system: ' macOS ' });
  let session = await rpc(a, 'start_session', input());
  assert.equal(session.description, 'Connection failed'); assert.equal(session.device, 'Laptop'); checks++;
  const theirs = await rpc(b, 'start_session', input());
  denied(await a.rpc('get_session_state', { p_session_id: theirs.id }));
  denied(await a.rpc('answer_question', { p_session_id: theirs.id, p_option_id: one.option }));
  denied(await tech.rpc('answer_question', { p_session_id: session.id, p_option_id: one.option }));
  denied(await a.from('diagnostic_sessions').update({ status: 'resolved' }).eq('id', session.id));
  denied(await a.from('diagnostic_nodes').select('*'));
  denied(await a.rpc('open_tree_draft', { p_category_id: one.category }));
  denied(await a.rpc('start_session', { ...input(), p_description: 'x'.repeat(4001) }));
  denied(await a.rpc('start_session', { ...input(), p_device: 'x'.repeat(201) }));
  denied(await a.rpc('start_session', input(two.category)));
  denied(await a.rpc('answer_question', { p_session_id: session.id, p_option_id: two.option }));
  session = await rpc(a, 'answer_question', { p_session_id: session.id, p_option_id: one.option });
  assert.equal(session.facts[0].value, 'Not working'); checks++;
  session = await rpc(a, 'record_attempt', { p_session_id: session.id, p_step_id: one.step, p_outcome: 'failed' });
  assert.equal(session.attempts.length, 1); checks++;
  denied(await a.rpc('escalate_session', { p_session_id: session.id, p_note: 'x'.repeat(2001) }));
  const ticket = await rpc(a, 'escalate_session', { p_session_id: session.id, p_note: ' Please help ' });
  assert.deepEqual(await rpc(a, 'escalate_session', { p_session_id: session.id, p_note: 'retry' }), ticket); checks++;
  assert.equal(ok(await a.from('tickets').select('*').eq('id', ticket.id)).length, 1); checks++;
  denied(await b.from('tickets').select('*').eq('id', ticket.id));
  denied(await a.from('ticket_queue').select('*'));
  denied(await a.from('tickets').update({ status: 'resolved' }).eq('id', ticket.id));
  const queue = ok(await tech.from('ticket_queue').select('*').eq('id', ticket.id)); assert.equal(queue.length, 1); checks++;
  const context = await rpc(tech, 'get_session_state', { p_session_id: session.id }); assert.equal(context.facts.length, 1); checks++;
  // Unassigned Send & wait claims ownership; ordinary Send preserves it.
  await rpc(tech, 'send_ticket_message', { p_ticket_id: ticket.id, p_body: 'Waiting on confirmation', p_wait_for_reply: true });
  const claimed = ok(await tech.from('tickets').select('status,assignee_id').eq('id', ticket.id))[0];
  assert.equal(claimed.status, 'waiting'); assert.equal(claimed.assignee_id, userIds[2]); checks++;
  ok(await service.from('ticket_messages').delete().eq('ticket_id', ticket.id));
  await rpc(tech, 'update_ticket', { p_ticket_id: ticket.id, p_status: 'assigned', p_assign_to_me: true });
  await rpc(tech, 'add_ticket_note', { p_ticket_id: ticket.id, p_body: ' Internal only ' });
  assert.equal(ok(await tech.from('ticket_notes').select('*').eq('ticket_id', ticket.id))[0].body, 'Internal only'); checks++;
  denied(await a.from('ticket_notes').select('*').eq('ticket_id', ticket.id));
  denied(await other.from('ticket_queue').select('*').eq('id', ticket.id));
  denied(await other.rpc('update_ticket', { p_ticket_id: ticket.id, p_status: 'resolved' }));
  denied(await tech.rpc('open_tree_draft', { p_category_id: one.category }));
  denied(await tech.from('diagnostic_nodes').update({ question: 'Attack' }).eq('id', one.node).select());
  denied(await tech.rpc('add_ticket_note', { p_ticket_id: ticket.id, p_body: 'x'.repeat(2001) }));
  denied(await tech.rpc('update_ticket', { p_ticket_id: ticket.id, p_status: 'waiting' }));
  const message = (body: string, wait = false) => ({ p_ticket_id: ticket.id, p_body: body, p_wait_for_reply: wait });
  for (const body of ['', ' \t\n ', 'x'.repeat(4001)]) denied(await tech.rpc('send_ticket_message', message(body)));
  denied(await b.rpc('get_my_ticket', { p_ticket_id: ticket.id }));
  denied(await b.rpc('send_ticket_message', message('Not mine')));
  denied(await other.rpc('send_ticket_message', message('Wrong organization')));
  denied(await other.from('ticket_messages').select('*').eq('ticket_id', ticket.id));
  denied(await a.rpc('send_ticket_message', message('Wait', true)));
  denied(await a.from('ticket_messages').insert({ ticket_id: ticket.id, sender_id: userIds[2], sender_name: 'Forged staff', sender_kind: 'staff', body: 'Forged' }));
  await rpc(tech, 'send_ticket_message', message('  Can you check the cable?  ', true));
  const waiting = ok(await tech.from('tickets').select('status,assignee_id').eq('id', ticket.id))[0];
  assert.equal(waiting.status, 'waiting'); assert.equal(waiting.assignee_id, userIds[2]); checks++;
  await rpc(a, 'send_ticket_message', message('It is connected.'));
  const review = ok(await tech.from('tickets').select('status,assignee_id').eq('id', ticket.id))[0];
  assert.equal(review.status, 'needs_review'); assert.equal(review.assignee_id, waiting.assignee_id); checks++;
  await rpc(tech, 'send_ticket_message', message('Thanks, checking now.'));
  assert.equal(ok(await tech.from('tickets').select('status').eq('id', ticket.id))[0].status, 'needs_review'); checks++;
  const own = await rpc(a, 'get_my_ticket', { p_ticket_id: ticket.id });
  assert.equal(own.messages.length, 3); assert.equal(own.messages[0].senderKind, 'staff');
  assert.equal(own.messages[0].body, 'Can you check the cable?');
  assert.equal(own.messages[1].author, 'requester-a');
  assert.ok(!JSON.stringify(own).includes('Internal only')); assert.ok(!('notes' in own)); checks++;
  assert.equal((await rpc(a, 'get_my_tickets')).length, 1); checks++;
  denied(await b.from('ticket_messages').select('*').eq('ticket_id', ticket.id));
  denied(await other.from('ticket_messages').select('*').eq('ticket_id', ticket.id));
  denied(await other.rpc('get_my_ticket', { p_ticket_id: ticket.id }));
  denied(await a.rpc('send_ticket_message', { ...message('Forged sender'), p_sender_id: userIds[2] }));
  const messageId = own.messages[0].id;
  denied(await tech.from('ticket_messages').update({ body: 'Edited' }).eq('id', messageId).select());
  denied(await tech.from('ticket_messages').delete().eq('id', messageId).select());
  const route = await rpc(tech, 'save_route', { p_ticket_id: ticket.id });
  assert.equal((await rpc(tech, 'save_route', { p_ticket_id: ticket.id })).id, route.id); checks++;
  assert.equal((await rpc(tech, 'get_path_library'))[0].id, route.id); checks++;
  assert.equal(route.path[0].question, 'Does it work?'); assert.equal(route.attempts[0].outcome, 'failed');
  assert.ok(!JSON.stringify(route).match(/Connection failed|Internal only|Please help|requester-a/)); checks++;
  denied(await a.rpc('save_route', { p_ticket_id: ticket.id }));
  assert.equal((await rpc(a, 'get_path_library')).length, 0); checks++;
  assert.equal((await rpc(other, 'get_path_library')).length, 0); checks++;

  // Image ingestion checks actual bytes at the Edge boundary. Storage writes cannot bypass it.
  const png = readFileSync('tests/fixtures/support.png');
  async function upload(client: SupabaseClient, bytes = png, type = 'image/png', filename = 'support.png') {
    return client.functions.invoke(`ticket-image?ticket=${ticket.id}&filename=${encodeURIComponent(filename)}`, { body: new Blob([new Uint8Array(bytes)], { type }), headers: { 'Content-Type': type } });
  }
  const image = ok(await upload(a)); assert.ok(image.id); checks++;
  const pending = ok(await service.from('ticket_attachments').select('*').eq('id', image.id))[0];
  for (const client of [a, b, tech, other, anonymous]) denied(await client.storage.from('ticket-attachments').download(pending.object_path));
  denied(await a.storage.from('ticket-attachments').upload(`${orgs[0]}/${ticket.id}/${randomUUID()}.png`, png, { contentType: 'image/png' }));
  const withImages = (body: string, ids = [image.id]) => ({ p_ticket_id: ticket.id, p_body: body, p_attachment_ids: ids, p_wait_for_reply: false });
  denied(await a.rpc('send_ticket_message_with_images', withImages('')));
  assert.equal(ok(await a.from('ticket_attachments').select('*').eq('id', image.id)).length, 0); checks++;
  denied(await b.rpc('send_ticket_message_with_images', withImages('Not mine')));
  denied(await other.rpc('send_ticket_message_with_images', withImages('Other org')));
  denied(await a.rpc('send_ticket_message_with_images', withImages('Too many', [image.id,image.id,image.id,image.id])));
  denied(await a.rpc('send_ticket_message_with_images', withImages('Forged', [randomUUID()])));
  await rpc(a, 'send_ticket_message_with_images', withImages('See the screenshot'));
  for (const client of [a,tech,admin]) { const blob = ok(await client.storage.from('ticket-attachments').download(pending.object_path)); assert.equal(blob.size, png.length); checks++; }
  for (const client of [b,other,anonymous]) {
    denied(await client.storage.from('ticket-attachments').download(pending.object_path));
    denied(await client.from('ticket_attachments').select('*').eq('id', image.id));
  }
  denied(await a.rpc('send_ticket_message_with_images', withImages('Cannot reuse')));
  for (const client of [b,other,anonymous]) { assert.ok((await upload(client)).error); checks++; }
  assert.ok((await upload(a, Buffer.from('<svg onload="alert(1)"/>'), 'image/svg+xml', 'bad.svg')).error); checks++;
  assert.ok((await upload(a, png, 'text/html')).error); checks++;
  assert.ok((await upload(a, Buffer.from('<html>not PNG</html>'))).error); checks++;
  assert.ok((await upload(a, Buffer.alloc(5242881))).error); checks++;
  const staffImage = ok(await upload(tech, png, 'image/png', '<script>alert(1)</script>.png'));
  await rpc(tech, 'send_ticket_message_with_images', withImages('Staff image', [staffImage.id]));
  const visible = ok(await a.from('ticket_attachments').select('*').eq('ticket_id', ticket.id));
  assert.equal(visible.length, 2); checks++;
  assert.ok(visible.some((v: any) => v.filename.includes('<script>'))); checks++;
  ok(await service.storage.from('ticket-attachments').remove(visible.map((v: any) => v.object_path)));
  await rpc(tech, 'update_ticket', { p_ticket_id: ticket.id, p_status: 'resolved' });
  denied(await a.rpc('reserve_ticket_image', { p_ticket_id: ticket.id, p_filename: 'late.png', p_size: 90, p_width: 20, p_height: 20 }));
  denied(await a.rpc('send_ticket_message', { p_ticket_id: ticket.id, p_body: 'Reopen' }));
  for (const status of ['waiting', 'new', 'assigned', 'needs_review']) denied(await tech.rpc('update_ticket', { p_ticket_id: ticket.id, p_status: status }));
  const draftId = await rpc(admin, 'open_tree_draft', { p_category_id: one.category }); trees.push(draftId);
  const draft = await rpc(admin, 'get_tree', { p_tree_id: draftId });
  const nodeId = draft.nodes[0].id;
  ok(await admin.from('diagnostic_nodes').update({ question: ' Updated question? ' }).eq('id', nodeId));
  assert.equal((await rpc(admin, 'get_tree', { p_tree_id: draftId })).nodes[0].question, 'Updated question?'); checks++;
  denied(await admin.from('diagnostic_nodes').update({ question: 'x'.repeat(2001) }).eq('id', nodeId));
  denied(await admin.from('diagnostic_nodes').update({ tree_id: two.tree }).eq('id', nodeId));
  denied(await admin.rpc('open_tree_draft', { p_category_id: two.category }));
  denied(await admin.from('diagnostic_nodes').update({ question: 'Attack' }).eq('id', two.node).select());
  assert.equal((await rpc(admin, 'validate_tree', { p_tree_id: draftId })).valid, true); checks++;
  const invalidNode = ok(await admin.from('diagnostic_nodes').insert({ tree_id: draftId, key: 'invalid', question: 'Unreachable?', fact_label: 'Detail', short_label: 'Dead end' }).select('id').single()).id;
  const invalid = await rpc(admin, 'validate_tree', { p_tree_id: draftId });
  assert.equal(invalid.valid, false); assert.ok(invalid.issues.some((i: any) => i.code === 'unreachable')); checks++;
  denied(await admin.rpc('publish_tree', { p_tree_id: draftId }));
  ok(await admin.from('diagnostic_nodes').delete().eq('id', invalidNode));
  assert.equal((await rpc(admin, 'validate_tree', { p_tree_id: draftId })).valid, true); checks++;
  denied(await tech.rpc('validate_tree', { p_tree_id: draftId }));
  denied(await other.rpc('validate_tree', { p_tree_id: draftId }));
  await rpc(admin, 'publish_tree', { p_tree_id: draftId });
  const events = ok(await admin.from('admin_audit_events').select('*').eq('category_id', one.category));
  for (const action of ['draft_created', 'question_edited', 'question_deleted', 'tree_published']) assert.ok(events.some((e: any) => e.action === action), action);
  assert.ok(events.every((e: any) => e.actor_id === userIds[3] && e.org_id === orgs[0])); checks++;
  denied(await tech.from('admin_audit_events').select('*').eq('category_id', one.category));
  denied(await other.from('admin_audit_events').select('*').eq('category_id', one.category));
  denied(await admin.from('admin_audit_events').insert({ org_id: orgs[0], actor_name: 'Forged', action: 'tree_published', target: 'Forged' }));
  denied(await admin.from('admin_audit_events').update({ actor_name: 'Forged' }).eq('id', events[0].id).select());
  denied(await admin.from('admin_audit_events').delete().eq('id', events[0].id).select());
  denied(await admin.from('diagnostic_nodes').update({ question: 'Attack live' }).eq('id', nodeId).select());
  const pinned = await rpc(b, 'answer_question', { p_session_id: theirs.id, p_option_id: one.option });
  assert.equal(pinned.diagnosis.id, session.diagnosis.id); checks++;
  for (const table of ['users', 'tickets', 'ticket_notes', 'diagnostic_sessions', 'diagnostic_nodes']) denied(await anonymous.from(table).select('*'));
  denied(await anonymous.rpc('start_session', input()));
  denied(await anonymous.rpc('get_session_state', { p_session_id: session.id }));
  for (const fn of ['auth_org', 'auth_role', 'is_admin', 'handle_new_auth_user']) denied(await a.rpc(fn));
  console.log(`Authenticated role-boundary checks passed (${checks} assertions).`);
} finally {
  // Remove only this run's UUID-scoped fixtures; never reset a user's database.
  for (const client of clients) await client.auth.signOut();
  ok(await service.from('tickets').delete().in('org_id', orgs));
  ok(await service.from('diagnostic_sessions').delete().in('org_id', orgs));
  if (categories.length) {
    ok(await service.from('diagnostic_trees').update({ root_node_id: null }).in('category_id', categories));
    ok(await service.from('diagnostic_trees').delete().in('category_id', categories));
  }
  for (const id of userIds) ok(await service.auth.admin.deleteUser(id));
  ok(await service.from('organizations').delete().in('id', orgs));
}
