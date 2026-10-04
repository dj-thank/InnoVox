import { existsSync, lstatSync, readFileSync, writeFileSync, linkSync, unlinkSync } from 'node:fs';
import { createHash, randomUUID } from 'node:crypto';
import { dirname, join } from 'node:path';
import { z } from 'zod';

const digest = (text: string) => createHash('sha256').update(text).digest('hex');
export type ServiceOwner = { root: string; node: string; label: string; plistPath: string; uid: number; digest: string; installedAt: string };
const ownerSchema = z.object({ root: z.string(), node: z.string(), label: z.string(), plistPath: z.string(),
  uid: z.number().int().nonnegative(), digest: z.string(), installedAt: z.iso.datetime() }).strict();
const receiptSchema = z.object({ version: z.literal(1), nonce: z.uuid(), owner: ownerSchema }).strict();
function contents(path: string) {
  const entry = lstatSync(path);
  if (!entry.isFile() || entry.isSymbolicLink()) throw new Error('Install state must be a regular unlinked file.');
  return readFileSync(path, 'utf8');
}
/** A retained hard-link staging inode proves that an interrupted install owns its final file. */
export function installServiceFiles(plist: string, manifestPath: string, owner: ServiceOwner,
  checkpoint: (phase: 'receipt' | 'plist' | 'manifest') => void = () => {}) {
  if (owner.digest !== digest(plist)) throw new Error('Install digest does not match.');
  const receiptPath = manifestPath + '.install.json';
  let receipt: z.infer<typeof receiptSchema>;
  if (existsSync(receiptPath)) {
    receipt = receiptSchema.parse(JSON.parse(contents(receiptPath)));
    for (const key of ['root', 'node', 'label', 'plistPath', 'uid', 'digest'] as const) {
      if (receipt.owner[key] !== owner[key]) throw new Error('Interrupted install belongs to a different runtime.');
    }
  } else {
    if (existsSync(owner.plistPath) || existsSync(manifestPath)) throw new Error('Refusing to adopt an existing service file.');
    receipt = { version: 1, nonce: randomUUID(), owner };
    writeFileSync(receiptPath, JSON.stringify(receipt), { flag: 'wx', mode: 0o600 });
  }
  const receiptText = contents(receiptPath), receiptEntry = lstatSync(receiptPath);
  checkpoint('receipt');
  // Each staging link must share its destination's filesystem. The checkout may
  // be on another volume from ~/Library/LaunchAgents. Non-plist stage suffixes
  // keep launchd from treating an incomplete stage as a second service.
  const stages = [[join(dirname(owner.plistPath), '.innovox-' + receipt.nonce + '.plist.stage'), owner.plistPath, plist],
    [join(dirname(manifestPath), '.install-' + receipt.nonce + '.owner.json'), manifestPath, JSON.stringify(receipt.owner, null, 2)]] as const;
  for (const [stage, target, text] of stages) {
    if (!existsSync(stage)) writeFileSync(stage, text, { flag: 'wx', mode: 0o600 });
    if (contents(stage) !== text) throw new Error('Install staging bytes changed; preserve them for review.');
    const staged = lstatSync(stage);
    if (existsSync(target)) {
      const final = lstatSync(target);
      if (contents(target) !== text || staged.dev !== final.dev || staged.ino !== final.ino) throw new Error('Refusing an unowned existing service file.');
    } else linkSync(stage, target);
    checkpoint(target === owner.plistPath ? 'plist' : 'manifest');
  }
  // Leave altered or replaced state intact instead of guessing at ownership.
  const currentReceipt = lstatSync(receiptPath);
  if (contents(receiptPath) !== receiptText || currentReceipt.dev !== receiptEntry.dev || currentReceipt.ino !== receiptEntry.ino) throw new Error('Install receipt changed.');
  for (const [stage, target, text] of stages) {
    const entry = lstatSync(stage), final = lstatSync(target);
    if (contents(stage) !== text || entry.dev !== final.dev || entry.ino !== final.ino) throw new Error('Install staging changed.');
  }
  // Remove the receipt first: a complete installation can use normal ownership verification.
  unlinkSync(receiptPath);
  for (const [stage] of stages) unlinkSync(stage);
}
