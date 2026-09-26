import { createHash } from 'node:crypto';
import type { ConversationEvent, Snapshot } from './contracts.js';

/** Provider evidence IDs must remain unambiguous across vendor sessions. */
export const evidenceRef = (e: ConversationEvent) => 'ev_' + createHash('sha256')
  .update(JSON.stringify([e.projectId, e.source.adapter, e.source.sessionId, e.source.epoch, e.eventId])).digest('hex');

export function reasoningContext(snapshot: Snapshot, characterBudget = 80_000) {
  const observations: Array<{ id: string; sourceEventId: string; source: ConversationEvent['source']; role: unknown; text: string }> = [];
  const omitted: Array<{ id: string; source: ConversationEvent['source']; characters: number }> = [];
  let used = 0;
  // Interleave current and surrounding conversations, newest complete records first.
  const own = [...snapshot.events].reverse(), peers = [...snapshot.relatedEvents].reverse();
  for (let i = 0; i < Math.max(own.length, peers.length); i++) {
    for (const event of [own[i], peers[i]]) {
      if (!event) continue;
      const text = String(event.payload.text), id = evidenceRef(event);
      if (used + text.length > characterBudget) {
        omitted.push({ id, source: event.source, characters: text.length }); continue;
      }
      used += text.length;
      observations.push({ id, sourceEventId: event.eventId, source: event.source, role: event.payload.role, text });
    }
  }
  return { project: snapshot.project.name, conditions: snapshot.project.conditions,
    targetSession: snapshot.session, observations, coverage: {
      history: 'bounded recent complete records; not the entire project history', omitted,
      selectedCharacters: used, characterBudget,
    } };
}
