import { createClient } from 'npm:@supabase/supabase-js@2.104.0';
import { validatePng } from './png.ts';
const cors = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type', 'Access-Control-Allow-Methods': 'POST, OPTIONS' };
const respond = (body: object, status = 200) => new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } });
Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: cors });
  if (req.method !== 'POST') return respond({ error: 'Method not allowed' }, 405);
  const authorization = req.headers.get('Authorization');
  if (!authorization) return respond({ error: 'Sign in again.' }, 401);
  const url = Deno.env.get('SUPABASE_URL')!;
  const user = createClient(url, Deno.env.get('SUPABASE_ANON_KEY')!, { global: { headers: { Authorization: authorization } }, auth: { persistSession: false } });
  const { data: auth, error: authError } = await user.auth.getUser();
  if (authError || !auth.user) return respond({ error: 'Sign in again.' }, 401);
  try {
    // Read with a hard bound even if a caller omits/forges Content-Length.
    const reader = req.body?.getReader();
    if (!reader) throw new Error('Missing image');
    const chunks: Uint8Array[] = []; let length = 0;
    while (true) {
      const { done, value } = await reader.read(); if (done) break;
      length += value.length;
      if (length > 5 * 1024 * 1024) { await reader.cancel(); throw new Error('Image exceeds 5 MB'); }
      chunks.push(value);
    }
    const bytes = new Uint8Array(length); let offset = 0;
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
    if (req.headers.get('Content-Type') !== 'image/png') throw new Error('Only normalized PNG uploads are accepted');
    const { width, height } = validatePng(bytes);
    const params = new URL(req.url).searchParams;
    const filename = params.get('filename') ?? 'support.png';
    if (!/\.png$/i.test(filename)) throw new Error('PNG filename required');
    const { data: reservation, error } = await user.rpc('reserve_ticket_image', {
      p_ticket_id: params.get('ticket'), p_filename: filename, p_size: length, p_width: width, p_height: height,
    });
    if (error) return respond({ error: 'This request cannot receive an image. Refresh and try again.' }, 403);
    // Only this authenticated, byte-validating function can write to the bucket.
    const service = createClient(url, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, { auth: { persistSession: false } });
    const upload = await service.storage.from('ticket-attachments').upload(reservation.path, bytes, { contentType: 'image/png', upsert: false, cacheControl: '0' });
    if (upload.error) return respond({ error: 'Image upload failed. Please try again.' }, 502);
    return respond({ id: reservation.id });
  } catch (error) {
    return respond({ error: error instanceof Error ? error.message : 'Invalid image' }, 400);
  }
});
