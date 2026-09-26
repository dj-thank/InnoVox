import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { existsSync, readFileSync } from 'node:fs';
import { Store } from './store.js';
import { OpenAIProvider } from './provider.js';
import { buildServer } from './server.js';

const root = fileURLToPath(new URL('../../', import.meta.url));
const host = process.env.INNOVOX_HOST ?? '127.0.0.1';
const port = Number(process.env.INNOVOX_PORT ?? 4317);
const tokenPath = resolve('.innovox/access-token');
const token = process.env.INNOVOX_ACCESS_TOKEN || (existsSync(tokenPath) ? readFileSync(tokenPath, 'utf8').trim() : '');
if (token.length < 32) throw new Error('Run pnpm init-local or set INNOVOX_ACCESS_TOKEN to a random value of at least 32 characters.');
if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('Invalid INNOVOX_PORT.');
const origin = process.env.INNOVOX_ORIGIN ?? `http://${host}:${port}`;
if (!['127.0.0.1', 'localhost', '::1'].includes(host) && !origin.startsWith('https://')) {
  throw new Error('Non-loopback deployments require an explicit HTTPS INNOVOX_ORIGIN and a TLS reverse proxy.');
}
const maxAnalyses = Number(process.env.INNOVOX_MAX_ANALYSES_PER_HOUR ?? 30);
const maxLive = Number(process.env.INNOVOX_MAX_LIVE_SESSIONS_PER_HOUR ?? 6);
if (![maxAnalyses, maxLive].every(n => Number.isInteger(n) && n >= 0 && n <= 1000)) throw new Error('Invalid hourly limits.');
const store = new Store(resolve(process.env.INNOVOX_DATABASE ?? '.innovox/state.sqlite'));
const { server, analyzer } = buildServer({ store, token, origin, root,
  provider: new OpenAIProvider(process.env.OPENAI_API_KEY), maxAnalyses, maxLive });
server.listen(port, host, () => console.log(`InnoVox single-user preview: ${origin}`));
function shutdown() {
  analyzer.close();
  server.close(() => { store.close(); process.exitCode = 0; });
  server.closeIdleConnections();
}
process.once('SIGINT', shutdown); process.once('SIGTERM', shutdown);
