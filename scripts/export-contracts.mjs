import { mkdirSync, writeFileSync } from 'node:fs';
import { z } from 'zod';
import { eventSchema, answerSchema, projectInput, proposalSchema, deliveryReceiptSchema } from '../dist/src/contracts.js';
mkdirSync('schemas', { recursive: true });
for (const [name, schema] of Object.entries({ 'event-v1': eventSchema, 'answer-v1': answerSchema,
  'project-v1': projectInput, 'proposal-v1': proposalSchema, 'delivery-receipt-v1': deliveryReceiptSchema })) {
  writeFileSync(`schemas/${name}.schema.json`, JSON.stringify(z.toJSONSchema(schema), null, 2) + '\n', 'utf8');
}
console.log('Exported 5 versioned JSON Schemas. Runtime cross-field and state checks remain authoritative.');
