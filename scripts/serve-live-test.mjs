import { execFileSync, spawn } from 'node:child_process';
const local = JSON.parse(execFileSync('npx', ['supabase', 'status', '-o', 'json'], { encoding: 'utf8' }));
if (!['localhost', '127.0.0.1'].includes(new URL(local.API_URL).hostname)) throw new Error('Local stack required');
const env = { ...process.env, VITE_SUPABASE_URL: local.API_URL, VITE_SUPABASE_PUBLISHABLE_KEY: local.ANON_KEY, VITE_BASE_PATH: '/Resolve/', VITE_TICKET_IMAGES_ENABLED: 'true' };
execFileSync('npm', ['run', 'build'], { env, stdio: 'inherit' });
const server = spawn('npm', ['run', 'preview', '--', '--host', '127.0.0.1', '--port', '4174'], { env, stdio: 'inherit' });
process.on('SIGTERM', () => server.kill());
process.on('SIGINT', () => server.kill());
server.on('exit', code => process.exit(code ?? 0));
