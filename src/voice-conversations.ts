import { DomainError, voiceTurnSchema } from './contracts.js';
import type { VoiceReasoner } from './provider.js';
import type { Store } from './store.js';

export class VoiceConversations {
  private busy = new Set<string>();
  constructor(private store: Store, private provider: VoiceReasoner, private hourlyLimit = 30) {}
  async interpret(consultationId: string, input: unknown) {
    const turn = voiceTurnSchema.parse(input);
    this.store.assertVoiceDialogue(consultationId, turn.dialogueId);
    const cached = this.store.voiceResult(consultationId, turn); if (cached) return cached;
    if (this.busy.has(consultationId)) throw new DomainError('voice_busy', 'The previous voice turn is still being interpreted.');
    if (!this.provider.available) throw new DomainError('provider_not_configured', 'OpenAI credentials are not configured.', 503);
    const q = this.store.consultation(consultationId);
    if (q.status !== 'pending' || q.version !== turn.expectedVersion || !this.store.contextCurrent(q)) {
      throw new DomainError('stale_context', 'The voice question changed; refresh before continuing.');
    }
    this.busy.add(consultationId);
    try {
      const snapshot = this.store.snapshot(q.projectId, q.adapter, q.sessionId);
      const dialogueId = turn.dialogueId;
      const prior = this.store.voiceState(q.id);
      const previous = prior?.dialogueId === dialogueId && prior.expectedVersion === q.version && prior.contextFingerprint === snapshot.fingerprint ? prior : undefined;
      const candidate = previous?.expectedVersion === q.version && previous.contextFingerprint === snapshot.fingerprint && previous.candidatePresented ? previous.candidate : null;
      this.store.invalidateVoiceConfirmation(q.id);
      this.store.consumeBudget('analysis', this.hourlyLimit);
      const result = await this.provider.respondToVoice(snapshot, q, turn.transcript, candidate, previous?.history);
      return this.store.recordVoiceResult(q.id, turn, result);
    } finally { this.busy.delete(consultationId); }
  }
}
