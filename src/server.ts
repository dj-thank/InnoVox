import { createServer } from 'node:http';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { createHash, timingSafeEqual } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { z } from 'zod';
import { Analyzer } from './analysis.js';
import { DomainError, deliveryReceiptSchema, id } from './contracts.js';
import type { Store } from './store.js';
import { OpenAIProvider } from './provider.js';
import { seedDemo } from './demo.js';
import { VoiceConversations } from './voice-conversations.js';

export type ServerOptions = {
  store: Store; token: string; origin: string; root: string; provider: OpenAIProvider;
  maxAnalyses?: number; maxLive?: number;
};
function equal(a: string, b: string) {
  return timingSafeEqual(createHash('sha256').update(a).digest(), createHash('sha256').update(b).digest());
}
async function body(req: IncomingMessage): Promise<unknown> {
  if (!req.headers['content-type']?.startsWith('application/json')) throw new DomainError('content_type', 'JSON required.', 415);
  const chunks: Buffer[] = []; let length = 0;
  for await (const chunk of req) {
    length += Buffer.byteLength(chunk);
    if (length > 300_000) throw new DomainError('body_too_large', 'Request exceeds 300 KB.', 413);
    chunks.push(Buffer.from(chunk));
  }
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown; }
  catch { throw new DomainError('invalid_json', 'Invalid JSON.', 400); }
}
function send(res: ServerResponse, status: number, data: unknown) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' }); res.end(JSON.stringify(data));
}
const sessionInput = z.object({ projectId: id, adapter: id, sessionId: id }).strict();

export function buildServer(options: ServerOptions) {
  if (options.token.length < 32) throw new Error('INNOVOX_ACCESS_TOKEN must contain at least 32 characters.');
  const origin = new URL(options.origin).origin;
  const { store, provider } = options;
  const analyzer = new Analyzer(store, provider, options.maxAnalyses ?? 30);
  const voice = new VoiceConversations(store, provider, options.maxAnalyses ?? 30);
  const deliveryView = (projectId?: string) => store.deliveries(projectId).map(d => ({ ...d,
    contextCurrent: d.status === 'queued' ? store.contextCurrent(store.consultation(d.consultationId)) : undefined }));
  const files: Record<string, [string, string]> = {
    '/': ['web/index.html', 'text/html'], '/app.js': ['dist/web/app.js', 'text/javascript'],
    '/voice.js': ['dist/web/voice.js', 'text/javascript'], '/style.css': ['web/style.css', 'text/css'],
  };
  const server = createServer(async (req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self'; connect-src 'self'; media-src 'self' blob:; frame-ancestors 'none'; base-uri 'none'; form-action 'self'");
    res.setHeader('Permissions-Policy', 'camera=(), microphone=(self), display-capture=(self)');
    try {
      const url = new URL(req.url ?? '/', origin);
      if (req.method === 'GET' && url.pathname === '/healthz') { send(res, 200, { status: 'ok' }); return; }
      if (req.headers.origin && req.headers.origin !== origin) throw new DomainError('origin', 'Origin is not allowed.', 403);
      if (req.headers['sec-fetch-site'] === 'cross-site') throw new DomainError('origin', 'Cross-site access is not allowed.', 403);
      if (req.method === 'GET' && files[url.pathname]) {
        const [file, type] = files[url.pathname]!;
        res.writeHead(200, { 'Content-Type': type + '; charset=utf-8' });
        res.end(await readFile(join(options.root, file))); return;
      }
      const bearer = req.headers.authorization?.startsWith('Bearer ') ? req.headers.authorization.slice(7) : '';
      if (!bearer || !equal(bearer, options.token)) throw new DomainError('unauthorized', 'A valid access token is required.', 401);
      if (req.method === 'GET' && url.pathname === '/api/state') {
        const projectId = url.searchParams.get('projectId') || undefined;
        if (projectId) store.project(id.parse(projectId));
        const sessions = store.sessions(projectId);
        send(res, 200, { projects: store.projects(), sessions, consultations: store.consultations(projectId).map(c => ({ ...c, contextCurrent: store.contextCurrent(c) })),
          deliveries: deliveryView(projectId), analysis: analyzer.status(),
          messages: sessions.flatMap(s => store.events(s.projectId, s.adapter, s.sessionId, s.epoch, 20)),
          capabilities: { providerConfigured: provider.available, reasoningModel: 'gpt-6-astra', voiceModel: 'gpt-live-1',
            nativeScreenCapture: false, automaticSessionDelivery: false, deliveryBridgeAvailable: 'codex-stdio', deployment: 'single-user-preview' } }); return;
      }
      if (req.method === 'GET' && url.pathname === '/api/journal') {
        const after = z.coerce.number().int().nonnegative().parse(url.searchParams.get('after') ?? 0);
        send(res, 200, { events: store.journal(after) }); return;
      }
      if (req.method === 'GET' && url.pathname === '/api/deliveries') {
        const projectId = id.parse(url.searchParams.get('projectId'));
        const adapter = id.parse(url.searchParams.get('adapter')), sessionId = id.parse(url.searchParams.get('sessionId'));
        store.project(projectId);
        send(res, 200, { deliveries: deliveryView(projectId).filter(d => d.adapter === adapter && d.sessionId === sessionId) }); return;
      }
      if (req.method === 'POST' && url.pathname === '/api/projects') { send(res, 201, store.createProject(await body(req))); return; }
      if (req.method === 'POST' && url.pathname === '/api/demo') { await body(req); send(res, 200, seedDemo(store)); return; }
      const projectMatch = /^\/api\/projects\/([^/]+)$/.exec(url.pathname);
      if (req.method === 'PUT' && projectMatch) {
        const input = z.object({ expectedRevision: z.number().int().positive(), project: z.unknown() }).strict().parse(await body(req));
        send(res, 200, store.updateProject(id.parse(projectMatch[1]), input.project, input.expectedRevision)); return;
      }
      if (req.method === 'POST' && url.pathname === '/api/events') {
        const result = store.ingest(await body(req));
        if (!result.duplicate && result.event.kind === 'message' && result.event.origin !== 'innovox') {
          const pending = store.consultations(result.event.projectId).filter(q => q.status === 'pending');
          for (const session of store.sessions(result.event.projectId)) {
            if ((session.adapter === result.event.source.adapter && session.sessionId === result.event.source.sessionId) ||
                pending.some(q => q.adapter === session.adapter && q.sessionId === session.sessionId)) analyzer.schedule(session);
          }
        }
        send(res, result.duplicate ? 200 : 201, result); return;
      }
      if (req.method === 'POST' && url.pathname === '/api/analyze') {
        const input = sessionInput.parse(await body(req)); send(res, 200, { consultation: await analyzer.run(input) }); return;
      }
      const questionRead = /^\/api\/consultations\/([^/]+)$/.exec(url.pathname);
      if (req.method === 'GET' && questionRead) { const q = store.consultation(id.parse(questionRead[1]));
        send(res, 200, { ...q, contextCurrent: store.contextCurrent(q) }); return; }
      const questionMatch = /^\/api\/consultations\/([^/]+)\/(answer|cancel)$/.exec(url.pathname);
      if (req.method === 'POST' && questionMatch) {
        const qid = id.parse(questionMatch[1]);
        send(res, 200, questionMatch[2] === 'answer' ? store.answer(qid, await body(req)) : store.cancel(qid)); return;
      }
      const voiceMatch = /^\/api\/consultations\/([^/]+)\/voice\/(interpret|commit|readback)$/.exec(url.pathname);
      if (req.method === 'POST' && voiceMatch) {
        const qid = id.parse(voiceMatch[1]);
        if (voiceMatch[2] === 'interpret') send(res, 200, await voice.interpret(qid, await body(req)));
        else if (voiceMatch[2] === 'readback') {
          const input = z.object({ turnId: id }).strict().parse(await body(req));
          store.markVoiceReadback(qid, input.turnId); send(res, 200, { contextAdded: true });
        }
        else {
          const input = z.object({ resolutionId: id }).strict().parse(await body(req));
          const result = store.commitVoiceAnswer(qid, input.resolutionId);
          send(res, 200, { ...result, reply: '回答を保存しました。元の作業への送信はまだ確認していません。' });
        }
        return;
      }
      const deliveryMatch = /^\/api\/deliveries\/([^/]+)\/(claim|receipt)$/.exec(url.pathname);
      if (req.method === 'POST' && deliveryMatch) {
        const did = id.parse(deliveryMatch[1]);
        if (deliveryMatch[2] === 'claim') send(res, 200, store.claimDelivery(did));
        else { const data = deliveryReceiptSchema.parse(await body(req)); send(res, 200, store.receipt(did, data.status, data.receipt)); }
        return;
      }
      if (req.method === 'POST' && url.pathname === '/api/live/session') {
        const input = z.object({ consultationId: id, expectedVersion: z.number().int().positive(),
          sdp: z.string().min(1).max(100_000) }).strict().parse(await body(req));
        const q = store.consultation(input.consultationId);
        if (q.status !== 'pending' || q.version !== input.expectedVersion) throw new DomainError('stale_question', 'Question is no longer pending.');
        if (!store.contextCurrent(q)) throw new DomainError('stale_context', 'Re-analyze the question before opening voice.');
        if (!provider.available) throw new DomainError('provider_not_configured', 'OpenAI credentials are not configured.', 503);
        store.consumeBudget('live', options.maxLive ?? 6);
        store.resetVoiceDialogue(q.id);
        send(res, 201, await provider.createLive(input.sdp, q)); return;
      }
      throw new DomainError('not_found', 'Route not found.', 404);
    } catch (error) {
      if (res.headersSent) { res.end(); return; }
      if (error instanceof DomainError) send(res, error.status, { error: error.code, message: error.message });
      else if (error instanceof z.ZodError) send(res, 400, { error: 'validation', message: 'Input does not match the API contract.',
        fields: error.issues.map(i => ({ path: i.path.join('.'), code: i.code })) });
      else send(res, 500, { error: 'internal', message: 'Operation failed. No provider response or secret was logged.' });
    }
  });
  server.requestTimeout = 60_000; server.headersTimeout = 10_000;
  server.on('close', () => analyzer.close());
  return { server, analyzer };
}
