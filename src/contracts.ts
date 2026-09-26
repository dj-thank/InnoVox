import { z } from 'zod';

export const id = z.string().min(1).max(128).regex(/^[A-Za-z0-9_.:-]+$/);
const text = (max: number) => z.string().trim().min(1).max(max);
export const conditionSchema = z.object({ id, text: text(2000), reason: text(2000) }).strict();
export const projectInput = z.object({
  name: text(100), conditions: z.array(conditionSchema).min(1).max(30),
  autoAnalyze: z.boolean().default(false),
}).strict().refine(p => new Set(p.conditions.map(c => c.id)).size === p.conditions.length, 'Duplicate condition id');
export const eventSchema = z.object({
  schemaVersion: z.literal(1), eventId: id, projectId: id,
  source: z.object({ adapter: id, sessionId: id, epoch: z.number().int().nonnegative() }).strict(),
  sequence: z.number().int().nonnegative(), occurredAt: z.iso.datetime(),
  kind: id, origin: z.enum(['agent', 'human', 'innovox']),
  payload: z.record(z.string(), z.unknown()),
}).strict();
export const messageSchema = z.object({
  role: z.enum(['user', 'assistant', 'tool']), text: text(16000),
  relay: z.object({ deliveryId: id, digest: z.string().regex(/^[a-f0-9]{64}$/) }).strict().optional(),
}).strict();
export const proposalSchema = z.object({
  question: text(1200), reason: text(2400),
  evidenceEventIds: z.array(id).min(1).max(10),
  conditionIds: z.array(id).min(1).max(10),
}).strict();
export const reasoningSchema = z.object({ proposal: proposalSchema.nullable() }).strict();
export const voiceDecisionSchema = z.object({
  intent: z.enum(['clarify', 'draft', 'confirm']), reply: text(1600), answerText: text(4000).nullable(),
}).strict();
export const voiceTurnSchema = z.object({
  turnId: id, expectedVersion: z.number().int().positive(), transcript: text(8000),
}).strict();
export type VoiceTurn = z.infer<typeof voiceTurnSchema>;
export type VoiceDecision = z.infer<typeof voiceDecisionSchema>;
export type VoiceResolution = {
  turnId: string; intent: VoiceDecision['intent']; reply: string; answerText: string | null;
  resolutionId: string | null; expectedVersion: number; expiresAt: string;
};
export type VoiceState = { candidate: string | null; expectedVersion: number;
  candidatePresented: boolean; contextFingerprint: string; latest: VoiceResolution };
export const answerSchema = z.object({
  answerId: id, text: text(4000), expectedVersion: z.number().int().positive(),
  channel: z.enum(['typed', 'voice']),
}).strict();
export const deliveryReceiptSchema = z.object({
  status: z.enum(['accepted', 'delivered', 'unknown']),
  receipt: text(1000),
}).strict();

export type ConversationEvent = z.infer<typeof eventSchema>;
export type Condition = z.infer<typeof conditionSchema>;
export type Proposal = z.infer<typeof proposalSchema>;
export type Answer = z.infer<typeof answerSchema>;
export type Project = {
  id: string; name: string; conditions: Condition[]; revision: number; autoAnalyze: boolean;
};
export type Session = {
  projectId: string; adapter: string; sessionId: string; epoch: number; highSequence: number;
};
export type Snapshot = {
  project: Project; session: Session; events: ConversationEvent[];
  relatedEvents: ConversationEvent[]; fingerprint: string;
};
export type Consultation = Proposal & {
  id: string; projectId: string; adapter: string; sessionId: string; epoch: number;
  contextRevision: number; fingerprint: string; status: 'pending' | 'answered' | 'cancelled' | 'superseded' | 'expired';
  version: number; createdAt: string; expiresAt: string; answer: Answer | null;
  contextFingerprint?: string;
  contextCurrent?: boolean;
};
export type Delivery = {
  id: string; consultationId: string; projectId: string; adapter: string; sessionId: string;
  epoch: number; text: string; status: 'queued' | 'claimed' | 'accepted' | 'delivered' | 'unknown' | 'cancelled';
  receipt: string | null;
  answerText?: string;
  question?: string;
  evidenceEventIds?: string[];
  contextCurrent?: boolean;
  claimDeadline?: string;
};

export class DomainError extends Error {
  constructor(public code: string, message: string, public status = 409) { super(message); }
}
export function fail(code: string, message: string, status = 409): never {
  throw new DomainError(code, message, status);
}
