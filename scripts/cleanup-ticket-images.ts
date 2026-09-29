/** Run daily with trusted server credentials, never in Vite/browser code.
 * Deletes only abandoned (>24h), unpublished reservations. DELETE locks each row
 * against message finalization before removing its Storage object.
 * On Storage failure, retain the printed path for a trusted operator retry.
 */
import { createClient } from '@supabase/supabase-js';
const url = process.env.SUPABASE_URL;
const key = process.env.SUPABASE_SECRET_KEY ?? process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) throw new Error('Trusted SUPABASE_URL and server key required');
const db = createClient(url, key, { auth: { persistSession: false } });
const { data, error } = await db.from('ticket_attachments').delete().is('message_id', null)
  .lt('created_at', new Date(Date.now() - 86400000).toISOString()).select('object_path');
if (error) throw error;
for (const row of data) {
  const result = await db.storage.from('ticket-attachments').remove([row.object_path]);
  if (result.error) { console.error('Cleanup retry required:', row.object_path); process.exitCode = 1; }
}
console.log(`Processed ${data.length} abandoned image reservations.`);
