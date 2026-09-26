import OpenAI from 'openai';
import { LiveWS } from 'openai/resources/live/ws';
import { parseArgs } from 'node:util';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { Store } from './store.js';
import { OpenAIProvider } from './provider.js';
import { seedDemo } from './demo.js';
import { DomainError } from './contracts.js';

type LiveProbe = { started: boolean; audioBytes: number; peak: number; finalized: boolean;
  seconds: number | null; error: string | null; pcm: Buffer };
export async function probeLive(key: string): Promise<LiveProbe> {
  // A bounded API test with synthetic silence; never opens a microphone or
  // records user audio, and never logs SDK errors or transcript contents.
  return new Promise(resolveProbe => {
    const ws = new LiveWS(new OpenAI({ apiKey: key, maxRetries: 0, timeout: 15_000 }),
      { reconnect: null, handshakeTimeout: 10_000, maxQueueSize: 64 * 1024 });
    const chunks: Buffer[] = [];
    let started = false, finalized = false, bytes = 0, peak = 0, seconds: number | null = null;
    let finished = false, closing = false, error: string | null = null;
    let inputTimer: ReturnType<typeof setInterval> | undefined;
    let speechTimer: ReturnType<typeof setTimeout> | undefined;
    let closeTimer: ReturnType<typeof setTimeout> | undefined;
    const finish = () => {
      if (finished) return; finished = true;
      clearTimeout(deadline); if (inputTimer) clearInterval(inputTimer);
      if (speechTimer) clearTimeout(speechTimer); if (closeTimer) clearTimeout(closeTimer);
      ws.socket.platformSocket.terminate();
      resolveProbe({ started, audioBytes: bytes, peak, finalized, seconds, error, pcm: Buffer.concat(chunks) });
    };
    const close = () => {
      if (closing || finished) return; closing = true;
      if (inputTimer) clearInterval(inputTimer);
      if (!started || ws.socket.readyState !== 1) { finish(); return; }
      ws.send({ type: 'session.close' }); closeTimer = setTimeout(finish, 10_000);
    };
    const deadline = setTimeout(() => { error ??= 'time_limit'; close(); }, 20_000);
    ws.socket.on('open', () => ws.send({ type: 'session.start', session: {
      model: 'gpt-live-1', store: false,
      instructions: 'これはInnoVoxのAPI接続試験です。開始後の指示に従い、日本語で短い挨拶を一文だけ話してください。',
      audio: { format: { type: 'audio/pcm', rate: 24000 }, output: { voice: 'marin' } }, delegation: { type: 'client' },
    } }));
    ws.on('event', event => {
      if (finished) return;
      if (event.type === 'session.started') {
        started = true;
        ws.send({ type: 'session.instructions.append', delegation_id: null,
          content: '今、InnoVoxの接続確認として、こんにちは、と一文だけ話してください。' });
        const silence = Buffer.alloc(4800).toString('base64');
        inputTimer = setInterval(() => {
          if (!closing && ws.socket.readyState === 1) ws.send({ type: 'session.input_audio.append', audio: silence });
        }, 100);
      } else if (event.type === 'session.output_audio.delta') {
        const audio = Buffer.from(event.delta, 'base64'); bytes += audio.length;
        if (bytes > 2_000_000) { error = 'audio_limit'; close(); return; }
        chunks.push(audio);
        for (let i = 0; i + 1 < audio.length; i += 2) peak = Math.max(peak, Math.abs(audio.readInt16LE(i)));
        if (peak > 0 && !speechTimer) speechTimer = setTimeout(close, 2500);
      } else if (event.type === 'session.closed') {
        finalized = true; seconds = event.usage.seconds; finish();
      } else if (event.type === 'error') { error = 'provider_event_error'; close(); }
    });
    ws.on('error', () => { error = 'connection_error'; finish(); });
    ws.socket.on('close', () => { if (!finalized) error ??= 'final_usage_unconfirmed'; finish(); });
  });
}
function wav(pcm: Buffer) {
  const audio = pcm.subarray(0, pcm.length - pcm.length % 2), header = Buffer.alloc(44);
  header.write('RIFF'); header.writeUInt32LE(36 + audio.length, 4); header.write('WAVEfmt ', 8);
  header.writeUInt32LE(16, 16); header.writeUInt16LE(1, 20); header.writeUInt16LE(1, 22);
  header.writeUInt32LE(24000, 24); header.writeUInt32LE(48000, 28); header.writeUInt16LE(2, 32); header.writeUInt16LE(16, 34);
  header.write('data', 36); header.writeUInt32LE(audio.length, 40); return Buffer.concat([header, audio]);
}
async function main() {
  const { values } = parseArgs({ options: { live: { type: 'boolean', default: false }, report: { type: 'string' }, audio: { type: 'string' } } });
  const key = process.env.OPENAI_API_KEY?.trim();
  if (!key) { console.log(JSON.stringify({ configured: false, tested: false, reason: 'OPENAI_API_KEY is not configured' })); process.exitCode = 2; return; }
  const store = new Store(':memory:'); const project = seedDemo(store);
  const report: Record<string, unknown> = { at: new Date().toISOString(), configured: true,
    realUserDataSent: false, humanVoiceAcceptance: false, requestedModels: { astra: 'gpt-6-astra', live: 'gpt-live-1' } };
  try {
    const snapshot = store.snapshot(project.id, 'synthetic', 'sample-session');
    const proposal = await new OpenAIProvider(key).analyze(snapshot);
    if (proposal) store.propose(snapshot, proposal);
    report.astra = { status: proposal ? 'structured_proposal_and_evidence_validated' : 'responded_without_intervention' };
  } catch (error) {
    report.astra = { status: 'failed', code: error instanceof DomainError ? error.code : 'unexpected_error' };
    process.exitCode = 1;
  } finally { store.close(); }
  if (values.live) {
    const live = await probeLive(key); const { pcm, ...metadata } = live;
    report.live = metadata;
    if (!live.started || !live.finalized || live.peak === 0 || live.error) process.exitCode = 1;
    if (values.audio && live.peak > 0) {
      const output = resolve(values.audio); await mkdir(dirname(output), { recursive: true }); await writeFile(output, wav(pcm));
      report.audioSaved = true;
    }
  } else report.live = { tested: false };
  if (values.report) { const output = resolve(values.report); await mkdir(dirname(output), { recursive: true }); await writeFile(output, JSON.stringify(report, null, 2) + '\n', 'utf8'); }
  console.log(JSON.stringify(report, null, 2));
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  void main().catch(() => { console.error('Provider check failed. No credential or raw provider error was printed.'); process.exitCode = 1; });
}
