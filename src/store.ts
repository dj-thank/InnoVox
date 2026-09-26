import { DatabaseSync } from 'node:sqlite';
import { createHash, randomUUID } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { answerSchema, eventSchema, fail, messageSchema, projectInput, proposalSchema, voiceDecisionSchema } from './contracts.js';
import type { Answer, Consultation, ConversationEvent, Delivery, Project, Session, Snapshot, VoiceState, VoiceResolution, VoiceTurn } from './contracts.js';
import { evidenceRef, reasoningContext } from './context.js';

function canonical(value: unknown): string {
  if (Array.isArray(value)) return '[' + value.map(canonical).join(',') + ']';
  if (value !== null && typeof value === 'object') {
    return '{' + Object.entries(value).sort(([a], [b]) => a.localeCompare(b))
      .map(([k, v]) => JSON.stringify(k) + ':' + canonical(v)).join(',') + '}';
  }
  return JSON.stringify(value);
}
const hash = (value: unknown) => createHash('sha256').update(canonical(value)).digest('hex');
type Row = Record<string, unknown>;
const decode = <T>(row: Row | undefined): T | undefined => row ? JSON.parse(String(row.json)) as T : undefined;

/** One transactional writer. Provider calls never run inside a transaction. */
export class Store {
  readonly db: DatabaseSync;
  constructor(path: string, private now: () => Date = () => new Date()) {
    if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true });
    this.db = new DatabaseSync(path);
    this.db.exec('PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL; PRAGMA busy_timeout=5000; PRAGMA foreign_keys=ON;');
    const version = Number(this.db.prepare('PRAGMA user_version').get()?.user_version);
    if (version > 3) { this.db.close(); fail('schema_version', 'Database was created by a newer InnoVox version.'); }
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS projects (id TEXT PRIMARY KEY, json TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS sessions (project TEXT, adapter TEXT, session TEXT, json TEXT NOT NULL,
        PRIMARY KEY(project,adapter,session));
      CREATE TABLE IF NOT EXISTS events (cursor INTEGER PRIMARY KEY AUTOINCREMENT, project TEXT,
        adapter TEXT, session TEXT, epoch INTEGER, event_id TEXT, sequence INTEGER, digest TEXT, json TEXT,
        UNIQUE(project,adapter,session,epoch,event_id), UNIQUE(project,adapter,session,epoch,sequence));
      CREATE TABLE IF NOT EXISTS consultations (id TEXT PRIMARY KEY, project TEXT, fingerprint TEXT, json TEXT,
        UNIQUE(project,fingerprint));
      CREATE TABLE IF NOT EXISTS deliveries (id TEXT PRIMARY KEY, consultation TEXT UNIQUE, project TEXT, json TEXT);
      CREATE TABLE IF NOT EXISTS journal (cursor INTEGER PRIMARY KEY AUTOINCREMENT, kind TEXT, at TEXT, json TEXT);
      CREATE TABLE IF NOT EXISTS provider_usage (kind TEXT, at INTEGER);
      CREATE TABLE IF NOT EXISTS voice_state (consultation TEXT PRIMARY KEY, json TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS voice_turns (consultation TEXT, turn_id TEXT, digest TEXT, json TEXT,
        PRIMARY KEY(consultation,turn_id));
      CREATE INDEX IF NOT EXISTS event_session ON events(project,adapter,session,epoch,sequence);
      PRAGMA user_version=3;
    `);
    // An in-flight delivery may have reached the destination before a crash.
    for (const d of this.deliveries()) {
      if (d.status === 'claimed') this.saveDelivery({ ...d, status: 'unknown', receipt: 'Process restarted before receipt.' });
    }
  }
  close() { this.db.close(); }
  private tx<T>(fn: () => T): T {
    this.db.exec('BEGIN IMMEDIATE');
    try { const result = fn(); this.db.exec('COMMIT'); return result; }
    catch (error) { this.db.exec('ROLLBACK'); throw error; }
  }
  private audit(kind: string, value: unknown) {
    this.db.prepare('INSERT INTO journal(kind,at,json) VALUES(?,?,?)').run(kind, this.now().toISOString(), JSON.stringify(value));
  }
  private saveProject(p: Project) { this.db.prepare('INSERT OR REPLACE INTO projects VALUES(?,?)').run(p.id, JSON.stringify(p)); }
  private saveSession(s: Session) {
    this.db.prepare('INSERT OR REPLACE INTO sessions VALUES(?,?,?,?)').run(s.projectId, s.adapter, s.sessionId, JSON.stringify(s));
  }
  private saveConsultation(c: Consultation) {
    this.db.prepare('INSERT OR REPLACE INTO consultations VALUES(?,?,?,?)').run(c.id, c.projectId, c.fingerprint, JSON.stringify(c));
  }
  private saveDelivery(d: Delivery) {
    this.db.prepare('INSERT OR REPLACE INTO deliveries VALUES(?,?,?,?)').run(d.id, d.consultationId, d.projectId, JSON.stringify(d));
  }
  projects(): Project[] { return this.db.prepare('SELECT json FROM projects ORDER BY rowid').all().map(r => decode<Project>(r)!); }
  project(projectId: string): Project {
    return decode<Project>(this.db.prepare('SELECT json FROM projects WHERE id=?').get(projectId)) ?? fail('not_found', 'Project not found.', 404);
  }
  createProject(input: unknown): Project {
    const data = projectInput.parse(input);
    const p: Project = { id: randomUUID(), ...data, revision: 1 };
    return this.tx(() => { this.saveProject(p); this.audit('project.created', p); return p; });
  }
  updateProject(projectId: string, input: unknown, expectedRevision: number): Project {
    const data = projectInput.parse(input);
    return this.tx(() => {
      const current = this.project(projectId);
      if (current.revision !== expectedRevision) fail('stale_project', 'Project changed; reload before saving.');
      const updated = { ...current, ...data, revision: current.revision + 1 };
      this.saveProject(updated);
      this.invalidate(projectId);
      this.audit('project.updated', updated);
      return updated;
    });
  }
  sessions(projectId?: string): Session[] {
    return (projectId ? this.db.prepare('SELECT json FROM sessions WHERE project=?').all(projectId)
      : this.db.prepare('SELECT json FROM sessions').all()).map(r => decode<Session>(r)!);
  }
  session(projectId: string, adapter: string, sessionId: string): Session {
    return decode<Session>(this.db.prepare('SELECT json FROM sessions WHERE project=? AND adapter=? AND session=?')
      .get(projectId, adapter, sessionId)) ?? fail('not_found', 'Session not found.', 404);
  }
  ingest(input: unknown): { event: ConversationEvent; duplicate: boolean } {
    let event = eventSchema.parse(input);
    const inputDigest = hash(event);
    if (event.kind === 'message') messageSchema.parse(event.payload);
    this.project(event.projectId);
    return this.tx(() => {
      const { adapter, sessionId, epoch } = event.source;
      const previous = this.db.prepare('SELECT digest,json FROM events WHERE project=? AND adapter=? AND session=? AND epoch=? AND event_id=?')
        .get(event.projectId, adapter, sessionId, epoch, event.eventId);
      if (previous) {
        if (previous.digest !== inputDigest) fail('event_conflict', 'Event id was reused with different content.');
        return { event: decode<ConversationEvent>(previous)!, duplicate: true };
      }
      if (event.kind === 'message' && event.origin === 'innovox') {
        const message = messageSchema.parse(event.payload);
        const delivery = message.relay ? this.deliveries(event.projectId).find(d => d.id === message.relay!.deliveryId) : undefined;
        const verified = delivery && ['claimed', 'accepted', 'delivered', 'unknown'].includes(delivery.status) &&
          delivery.adapter === adapter && delivery.sessionId === sessionId && delivery.epoch === epoch &&
          createHash('sha256').update(delivery.text).digest('hex') === message.relay?.digest &&
          message.text === `[innovox-delivery:${delivery.id}:${message.relay.digest}]\n${delivery.text}`;
        if (!verified) event = { ...event, origin: message.role === 'user' ? 'human' : 'agent' };
        else if (delivery.status !== 'delivered') {
          this.saveDelivery({ ...delivery, status: 'delivered', receipt: JSON.stringify({ level: 'source-message-echo', modelActionVerified: false }) });
          this.audit('delivery.source_echo', { id: delivery.id, sourceEventId: event.eventId });
        }
      }
      const occupied = this.db.prepare('SELECT event_id FROM events WHERE project=? AND adapter=? AND session=? AND epoch=? AND sequence=?')
        .get(event.projectId, adapter, sessionId, epoch, event.sequence);
      if (occupied) fail('sequence_conflict', 'Sequence belongs to another event.');
      const current = decode<Session>(this.db.prepare('SELECT json FROM sessions WHERE project=? AND adapter=? AND session=?')
        .get(event.projectId, adapter, sessionId));
      if (current && epoch !== current.epoch) {
        if (epoch < current.epoch || event.kind !== 'session.started') fail('stale_epoch', 'A newer epoch requires an explicit session.started event.');
        this.invalidate(event.projectId, adapter, sessionId);
      }
      this.db.prepare('INSERT INTO events(project,adapter,session,epoch,event_id,sequence,digest,json) VALUES(?,?,?,?,?,?,?,?)')
        .run(event.projectId, adapter, sessionId, epoch, event.eventId, event.sequence, inputDigest, JSON.stringify(event));
      this.saveSession({ projectId: event.projectId, adapter, sessionId, epoch,
        highSequence: Math.max(current?.epoch === epoch ? current.highSequence : -1, event.sequence) });
      this.audit('event.ingested', { projectId: event.projectId, source: event.source, eventId: event.eventId });
      return { event, duplicate: false };
    });
  }
  events(projectId: string, adapter: string, sessionId: string, epoch: number, limit = 40): ConversationEvent[] {
    return this.db.prepare('SELECT json FROM events WHERE project=? AND adapter=? AND session=? AND epoch=? ORDER BY sequence DESC LIMIT ?')
      .all(projectId, adapter, sessionId, epoch, limit).reverse().map(r => decode<ConversationEvent>(r)!);
  }
  snapshot(projectId: string, adapter: string, sessionId: string): Snapshot {
    const project = this.project(projectId), session = this.session(projectId, adapter, sessionId);
    const events = this.db.prepare(`SELECT json FROM events WHERE project=? AND adapter=? AND session=? AND epoch=?
      AND json_extract(json,'$.kind')='message' AND json_extract(json,'$.origin')!='innovox'
      ORDER BY sequence DESC LIMIT 40`).all(projectId, adapter, sessionId, session.epoch).reverse().map(r => decode<ConversationEvent>(r)!);
    const relatedEvents = this.db.prepare(`SELECT e.json FROM events e JOIN sessions s
      ON e.project=s.project AND e.adapter=s.adapter AND e.session=s.session
      WHERE e.project=? AND NOT (e.adapter=? AND e.session=?) AND e.epoch=json_extract(s.json,'$.epoch')
      AND json_extract(e.json,'$.kind')='message' AND json_extract(e.json,'$.origin')!='innovox'
      ORDER BY e.cursor DESC LIMIT 40`).all(projectId, adapter, sessionId).reverse().map(r => decode<ConversationEvent>(r)!);
    const scope = { projectId, adapter, sessionId, epoch: session.epoch };
    return { project, session, events, relatedEvents, fingerprint: hash({ project, scope, events, relatedEvents }) };
  }
  contextCurrent(c: Consultation): boolean {
    return c.contextFingerprint === this.snapshot(c.projectId, c.adapter, c.sessionId).fingerprint;
  }
  clearObsoleteQuestion(snapshot: Snapshot) {
    this.tx(() => {
      const s = snapshot.session;
      if (this.snapshot(s.projectId, s.adapter, s.sessionId).fingerprint !== snapshot.fingerprint) fail('stale_analysis', 'Conversation changed during analysis.');
      for (const q of this.consultations(s.projectId)) {
        if (q.status === 'pending' && q.adapter === s.adapter && q.sessionId === s.sessionId) {
          this.saveConsultation({ ...q, status: 'superseded', version: q.version + 1 });
          this.audit('consultation.superseded', { id: q.id, reason: 'Fresh analysis no longer requests this confirmation.' });
        }
      }
    });
  }
  propose(snapshot: Snapshot, input: unknown): Consultation {
    const proposal = proposalSchema.parse(input);
    return this.tx(() => {
      const { project, session } = snapshot;
      if (this.snapshot(project.id, session.adapter, session.sessionId).fingerprint !== snapshot.fingerprint) {
        fail('stale_analysis', 'Conversation or project changed during analysis.');
      }
      const evidence = [...snapshot.events, ...snapshot.relatedEvents];
      const supplied = new Set(reasoningContext(snapshot).observations.map(o => o.id));
      if (!proposal.evidenceEventIds.every(ref => (supplied.has(ref) && evidence.some(e => evidenceRef(e) === ref)) ||
          snapshot.events.some(e => e.eventId === ref && supplied.has(evidenceRef(e)))) ||
          !proposal.conditionIds.every(id => project.conditions.some(c => c.id === id))) {
        fail('invalid_evidence', 'Suggestion cites evidence outside its context.');
      }
      const fingerprint = hash({ projectId: project.id, revision: project.revision, session: session.sessionId,
        adapter: session.adapter, epoch: session.epoch, events: [...new Set(proposal.evidenceEventIds)].sort(),
        conditions: [...new Set(proposal.conditionIds)].sort(), context: snapshot.fingerprint });
      const existing = decode<Consultation>(this.db.prepare('SELECT json FROM consultations WHERE project=? AND fingerprint=?').get(project.id, fingerprint));
      const pending = this.consultations(project.id).find(c => c.adapter === session.adapter && c.sessionId === session.sessionId && c.status === 'pending');
      if (existing?.status === 'pending') {
        if (existing.contextFingerprint === snapshot.fingerprint && canonical(proposal) === canonical({ question: existing.question,
          reason: existing.reason, evidenceEventIds: existing.evidenceEventIds, conditionIds: existing.conditionIds })) return existing;
        const revised = { ...existing, ...proposal, contextFingerprint: snapshot.fingerprint, version: existing.version + 1 };
        this.saveConsultation(revised); this.audit('consultation.revalidated', revised); return revised;
      }
      if (existing && existing.status !== 'superseded' && existing.status !== 'expired') return existing;
      if (pending) {
        this.saveConsultation({ ...pending, status: 'superseded', version: pending.version + 1 });
        this.audit('consultation.superseded', { id: pending.id, reason: 'Fresh analysis replaced the question.' });
      }
      if (existing) {
        const revived = { ...existing, ...proposal, status: 'pending' as const, version: existing.version + 1,
          contextFingerprint: snapshot.fingerprint, expiresAt: new Date(this.now().getTime() + 15 * 60_000).toISOString() };
        this.saveConsultation(revived); this.audit('consultation.revalidated', revived); return revived;
      }
      const now = this.now();
      const c: Consultation = { ...proposal, id: randomUUID(), projectId: project.id, adapter: session.adapter,
        sessionId: session.sessionId, epoch: session.epoch, contextRevision: project.revision,
        fingerprint, contextFingerprint: snapshot.fingerprint,
        version: 1, status: 'pending', createdAt: now.toISOString(),
        expiresAt: new Date(now.getTime() + 15 * 60_000).toISOString(), answer: null };
      this.saveConsultation(c); this.audit('consultation.created', c); return c;
    });
  }
  private expire() {
    for (const c of this.db.prepare('SELECT json FROM consultations').all().map(r => decode<Consultation>(r)!)) {
      if (c.status === 'pending' && Date.parse(c.expiresAt) <= this.now().getTime()) {
        this.saveConsultation({ ...c, status: 'expired', version: c.version + 1 });
        this.audit('consultation.expired', { id: c.id });
      }
    }
  }
  consultations(projectId?: string): Consultation[] {
    this.expire();
    return (projectId ? this.db.prepare('SELECT json FROM consultations WHERE project=? ORDER BY rowid DESC').all(projectId)
      : this.db.prepare('SELECT json FROM consultations ORDER BY rowid DESC').all()).map(r => decode<Consultation>(r)!);
  }
  consultation(consultationId: string): Consultation {
    this.expire();
    return decode<Consultation>(this.db.prepare('SELECT json FROM consultations WHERE id=?').get(consultationId)) ?? fail('not_found', 'Question not found.', 404);
  }
  private invalidate(projectId: string, adapter?: string, sessionId?: string) {
    for (const c of this.consultations(projectId)) {
      if (adapter && (c.adapter !== adapter || c.sessionId !== sessionId)) continue;
      if (c.status === 'pending') {
        this.saveConsultation({ ...c, status: 'superseded', version: c.version + 1 });
        this.audit('consultation.superseded', { id: c.id });
      }
      for (const d of this.deliveries().filter(d => d.consultationId === c.id && d.status === 'queued')) {
        this.saveDelivery({ ...d, status: 'cancelled', receipt: 'Context superseded before dispatch.' });
      }
    }
  }
  cancel(consultationId: string): Consultation {
    return this.tx(() => {
      const c = this.consultation(consultationId);
      if (c.status !== 'pending') fail('not_pending', 'Question is no longer pending.');
      const updated = { ...c, status: 'cancelled' as const, version: c.version + 1 };
      this.saveConsultation(updated); this.audit('consultation.cancelled', { id: c.id }); return updated;
    });
  }
  answer(consultationId: string, input: unknown): { consultation: Consultation; delivery: Delivery } {
    const answer: Answer = answerSchema.parse(input);
    return this.tx(() => {
      const c = this.consultation(consultationId);
      const previous = this.deliveries().find(d => d.consultationId === c.id);
      if (c.answer?.answerId === answer.answerId && previous) {
        if (canonical(c.answer) !== canonical(answer)) fail('answer_conflict', 'Answer id was reused with different content.');
        return { consultation: c, delivery: previous };
      }
      if (c.status !== 'pending' || c.version !== answer.expectedVersion) fail('stale_question', 'Question changed or is no longer pending.');
      if (!this.contextCurrent(c)) fail('stale_context', 'Conversation changed. Re-analyze this question before answering.');
      if (this.project(c.projectId).revision !== c.contextRevision || this.session(c.projectId, c.adapter, c.sessionId).epoch !== c.epoch) {
        fail('stale_context', 'Question belongs to an older context.');
      }
      const updated = { ...c, status: 'answered' as const, version: c.version + 1, answer };
      const delivery: Delivery = { id: randomUUID(), consultationId: c.id, projectId: c.projectId,
        adapter: c.adapter, sessionId: c.sessionId, epoch: c.epoch,
        text: `InnoVox human response\nQuestion: ${c.question}\nContext: ${c.reason}\nAnswer: ${answer.text}\nEvidence: ${c.evidenceEventIds.join(', ')}`,
        answerText: answer.text, question: c.question, evidenceEventIds: c.evidenceEventIds,
        status: 'queued', receipt: null };
      this.saveConsultation(updated); this.saveDelivery(delivery); this.audit('consultation.answered', { consultation: updated, delivery });
      return { consultation: updated, delivery };
    });
  }
  deliveries(projectId?: string): Delivery[] {
    const rows = (projectId ? this.db.prepare('SELECT json FROM deliveries WHERE project=?').all(projectId)
      : this.db.prepare('SELECT json FROM deliveries').all()).map(r => decode<Delivery>(r)!);
    return rows.map(d => {
      if (d.status !== 'claimed' || !d.claimDeadline || Date.parse(d.claimDeadline) > this.now().getTime()) return d;
      const expired: Delivery = { ...d, status: 'unknown', receipt: 'Delivery claim expired without a receipt; automatic resend disabled.' };
      this.saveDelivery(expired); this.audit('delivery.claim_expired', { id: d.id }); return expired;
    });
  }
  claimDelivery(deliveryId: string): Delivery {
    return this.tx(() => {
      const d = this.deliveries().find(d => d.id === deliveryId) ?? fail('not_found', 'Delivery not found.', 404);
      if (d.status !== 'queued') fail('delivery_not_queued', 'Delivery cannot be retried without reconciliation.');
      const c = this.consultation(d.consultationId);
      if (!this.contextCurrent(c)) fail('stale_context', 'Conversation changed before delivery; reconcile the answer first.');
      if (this.project(c.projectId).revision !== c.contextRevision || this.session(c.projectId, c.adapter, c.sessionId).epoch !== c.epoch) {
        fail('stale_context', 'Delivery context changed.');
      }
      const updated = { ...d, status: 'claimed' as const, claimDeadline: new Date(this.now().getTime() + 60_000).toISOString() };
      this.saveDelivery(updated); this.audit('delivery.claimed', { id: d.id }); return updated;
    });
  }
  receipt(deliveryId: string, status: 'accepted' | 'delivered' | 'unknown', receipt: string): Delivery {
    return this.tx(() => {
      const d = this.deliveries().find(d => d.id === deliveryId) ?? fail('not_found', 'Delivery not found.', 404);
      if (d.status === status && d.receipt === receipt) return d;
      if (d.status === 'delivered' && ['accepted', 'unknown'].includes(status)) return d;
      if (!['claimed', 'unknown'].includes(d.status) && !(d.status === 'accepted' && status === 'delivered')) fail('invalid_receipt', 'Delivery was not claimed or cannot advance to that state.');
      const updated = { ...d, status, receipt };
      this.saveDelivery(updated); this.audit('delivery.receipt', updated); return updated;
    });
  }
  voiceState(consultationId: string): VoiceState | undefined {
    return decode<VoiceState>(this.db.prepare('SELECT json FROM voice_state WHERE consultation=?').get(consultationId));
  }
  resetVoiceDialogue(consultationId: string) {
    this.tx(() => {
      this.db.prepare('DELETE FROM voice_state WHERE consultation=?').run(consultationId);
      this.audit('voice.dialogue_started', { consultationId, previousReadbackInvalidated: true });
    });
  }
  voiceResult(consultationId: string, input: VoiceTurn): VoiceResolution | undefined {
    const row = this.db.prepare('SELECT digest,json FROM voice_turns WHERE consultation=? AND turn_id=?').get(consultationId, input.turnId);
    if (row && row.digest !== hash(input)) fail('voice_turn_conflict', 'Voice turn id was reused with different content.');
    return decode<VoiceResolution>(row);
  }
  invalidateVoiceConfirmation(consultationId: string) {
    this.tx(() => {
      const state = this.voiceState(consultationId);
      if (!state?.latest.resolutionId) return;
      this.db.prepare('UPDATE voice_state SET json=? WHERE consultation=?').run(
        JSON.stringify({ ...state, latest: { ...state.latest, resolutionId: null } }), consultationId);
      this.audit('voice.confirmation_invalidated', { consultationId, reason: 'A newer utterance is being interpreted.' });
    });
  }
  recordVoiceResult(consultationId: string, input: VoiceTurn, decisionInput: unknown): VoiceResolution {
    const decision = voiceDecisionSchema.parse(decisionInput);
    return this.tx(() => {
      const existing = this.voiceResult(consultationId, input); if (existing) return existing;
      const q = this.consultation(consultationId);
      if (q.status !== 'pending' || q.version !== input.expectedVersion || !this.contextCurrent(q)) {
        fail('stale_context', 'Question changed during voice interpretation.');
      }
      const previous = this.voiceState(consultationId);
      const candidate = previous?.expectedVersion === q.version && previous.contextFingerprint === q.contextFingerprint && previous.candidatePresented ? previous.candidate : null;
      if (decision.intent === 'confirm' && !candidate) fail('voice_confirmation', 'No current read-back answer exists to confirm.');
      if (decision.intent === 'draft' && !decision.answerText) fail('voice_draft', 'Voice draft is empty.');
      const answerText = decision.intent === 'confirm' ? candidate : decision.intent === 'draft' ? decision.answerText : null;
      const result: VoiceResolution = { turnId: input.turnId, intent: decision.intent, answerText,
        reply: decision.intent === 'draft' ? `${answerText}、という回答でよいですか？` : decision.reply,
        resolutionId: decision.intent === 'confirm' ? randomUUID() : null, expectedVersion: q.version,
        expiresAt: new Date(this.now().getTime() + 60_000).toISOString() };
      const state: VoiceState = { candidate: decision.intent === 'draft' ? answerText : candidate,
        candidatePresented: decision.intent === 'draft' ? false : Boolean(candidate),
        expectedVersion: q.version, contextFingerprint: q.contextFingerprint!, latest: result };
      this.db.prepare('INSERT OR REPLACE INTO voice_state VALUES(?,?)').run(q.id, JSON.stringify(state));
      this.db.prepare('INSERT INTO voice_turns VALUES(?,?,?,?)').run(q.id, input.turnId, hash(input), JSON.stringify(result));
      this.audit('voice.interpreted', { consultationId, input, result }); return result;
    });
  }
  markVoiceReadback(consultationId: string, turnId: string) {
    this.tx(() => {
      const q = this.consultation(consultationId), state = this.voiceState(consultationId);
      if (!state || state.latest.turnId !== turnId || state.latest.intent !== 'draft' ||
          state.expectedVersion !== q.version || !this.contextCurrent(q) || q.status !== 'pending') {
        fail('stale_readback', 'Read-back belongs to a replaced voice answer.');
      }
      this.db.prepare('UPDATE voice_state SET json=? WHERE consultation=?').run(JSON.stringify({ ...state, candidatePresented: true }), q.id);
      this.audit('voice.readback_context_added', { consultationId, turnId, evidence: 'client observed provider context-injection acknowledgment; not playback or approval' });
    });
  }
  commitVoiceAnswer(consultationId: string, resolutionId: string) {
    const state = this.voiceState(consultationId);
    if (!state || state.latest.resolutionId !== resolutionId || state.latest.intent !== 'confirm' || !state.candidate) {
      fail('voice_confirmation', 'This voice confirmation was replaced or does not exist.');
    }
    if (Date.parse(state.latest.expiresAt) <= this.now().getTime()) fail('voice_expired', 'Voice confirmation expired.');
    // answer() atomically persists both the answer and outbox item; retries use
    // this same resolution ID rather than executing a second effect.
    return this.answer(consultationId, { answerId: resolutionId, text: state.candidate,
      expectedVersion: state.latest.expectedVersion, channel: 'voice' });
  }
  consumeBudget(kind: string, limit: number) {
    this.tx(() => {
      const now = this.now().getTime(), cutoff = now - 3600_000;
      this.db.prepare('DELETE FROM provider_usage WHERE at<?').run(cutoff);
      const used = Number(this.db.prepare('SELECT count(*) AS n FROM provider_usage WHERE kind=?').get(kind)?.n);
      if (used >= limit) fail('rate_limit', 'Hourly provider request limit reached.', 429);
      this.db.prepare('INSERT INTO provider_usage VALUES(?,?)').run(kind, now);
    });
  }
  journal(after: number, limit = 100): Row[] {
    return this.db.prepare('SELECT cursor,kind,at,json FROM journal WHERE cursor>? ORDER BY cursor LIMIT ?').all(after, limit)
      .map(r => ({ cursor: r.cursor, kind: r.kind, at: r.at, data: JSON.parse(String(r.json)) as unknown }));
  }
}
