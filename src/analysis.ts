import { DomainError } from './contracts.js';
import type { Session } from './contracts.js';
import type { Reasoner } from './provider.js';
import type { Store } from './store.js';

const key = (s: Pick<Session, 'projectId' | 'adapter' | 'sessionId'>) => JSON.stringify([s.projectId, s.adapter, s.sessionId]);
export class Analyzer {
  private running = false;
  private queue = new Map<string, Session>();
  private timer?: ReturnType<typeof setTimeout>;
  private closed = false;
  private results = new Map<string, { state: string; at: string; code?: string }>();
  constructor(private store: Store, private reasoner: Reasoner, private hourlyLimit = 30, private batchMs = 1000) {}
  status() { return Object.fromEntries(this.results); }
  private arm() {
    if (this.closed || this.timer || !this.queue.size) return;
    this.timer = setTimeout(() => { this.timer = undefined; void this.drain(); }, this.batchMs);
    this.timer.unref();
  }
  schedule(s: Session) {
    if (this.closed || !this.reasoner.available || !this.store.project(s.projectId).autoAnalyze) return;
    if (this.queue.size >= 20 && !this.queue.has(key(s))) {
      this.results.set(key(s), { state: 'deferred', at: new Date().toISOString(), code: 'queue_full' }); return;
    }
    this.queue.set(key(s), s);
    // Fixed batching window prevents an endless token stream from starving analysis.
    this.arm();
  }
  private async drain() {
    if (this.closed || this.running) return;
    const next = this.queue.entries().next().value as [string, Session] | undefined;
    if (!next) return;
    this.queue.delete(next[0]);
    try { await this.run(next[1]); } catch { /* safe status recorded by run */ }
    this.arm();
  }
  async run(s: Pick<Session, 'projectId' | 'adapter' | 'sessionId'>) {
    if (this.closed) throw new DomainError('closing', 'Analyzer is closing.', 503);
    if (this.running) throw new DomainError('analysis_busy', 'Another analysis is running; try again shortly.', 409);
    if (!this.reasoner.available) throw new DomainError('provider_not_configured', 'OpenAI credentials are not configured.', 503);
    this.running = true;
    if (this.results.size >= 100 && !this.results.has(key(s))) this.results.delete(this.results.keys().next().value!);
    this.results.set(key(s), { state: 'running', at: new Date().toISOString() });
    try {
      const snapshot = this.store.snapshot(s.projectId, s.adapter, s.sessionId);
      if (!snapshot.events.length) throw new DomainError('no_messages', 'No accessible messages in this session.', 422);
      const pending = this.store.consultations(s.projectId).find(c => c.status === 'pending' &&
        c.adapter === s.adapter && c.sessionId === s.sessionId && c.epoch === snapshot.session.epoch);
      if (pending) {
        this.results.set(key(s), { state: 'question', at: new Date().toISOString() });
        return pending;
      }
      this.store.consumeBudget('analysis', this.hourlyLimit);
      const proposal = await this.reasoner.analyze(snapshot);
      if (this.closed) return null;
      const c = proposal ? this.store.propose(snapshot, proposal) : null;
      this.results.set(key(s), { state: c ? 'question' : 'quiet', at: new Date().toISOString() });
      return c;
    } catch (e) {
      this.results.set(key(s), { state: 'failed', at: new Date().toISOString(), code: e instanceof DomainError ? e.code : 'analysis_error' });
      throw e;
    } finally { this.running = false; this.arm(); }
  }
  close() { this.closed = true; if (this.timer) clearTimeout(this.timer); this.queue.clear(); }
}
