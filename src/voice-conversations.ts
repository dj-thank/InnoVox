import { DomainError, voiceTurnSchema } from './contracts.js';
import type { VoiceReasoner } from './provider.js';
import type { Store } from './store.js';

export class VoiceConversations {
  private busy = new Set<string>();
  constructor(private store: Store, private provider: VoiceReasoner, private hourlyLimit = 30) {}
  async interpret(consultationId: string, input: unknown) {
    const turn = voiceTurnSchema.parse(input);
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
      const previous = this.store.voiceState(q.id);
      const candidate = previous?.expectedVersion === q.version && previous.contextFingerprint === snapshot.fingerprint && previous.candidatePresented ? previous.candidate : null;
      this.store.invalidateVoiceConfirmation(q.id);
      this.store.consumeBudget('analysis', this.hourlyLimit);
      const result = await this.provider.respondToVoice(snapshot, q, turn.transcript, candidate);
      return this.store.recordVoiceResult(q.id, turn, result);
    } finally { this.busy.delete(consultationId); }
  }
}
