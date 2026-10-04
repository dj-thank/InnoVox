import { backup, DatabaseSync } from 'node:sqlite';
import { constants, createReadStream } from 'node:fs';
import { chmod, copyFile, lstat, mkdir, readFile, stat, writeFile, link, unlink } from 'node:fs/promises';
import { createHash, randomUUID } from 'node:crypto';
import { dirname, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';
import { z } from 'zod';

const manifestSchema = z.object({ formatVersion: z.literal(1), schemaVersion: z.number().int().min(1).max(4),
  createdAt: z.iso.datetime(), bytes: z.number().int().positive(), sha256: z.string().regex(/^[a-f0-9]{64}$/) }).strict();
const fingerprint = async (path: string) => {
  const hash = createHash('sha256'); for await (const chunk of createReadStream(path)) hash.update(chunk);
  return hash.digest('hex');
};
async function regular(path: string) {
  const entry = await lstat(path);
  if (!entry.isFile() || entry.isSymbolicLink()) throw new Error('Expected a regular database or manifest file.');
}
function inspect(database: DatabaseSync) {
  const version = Number(database.prepare('PRAGMA user_version').get()?.user_version);
  if (version < 1 || version > 4) throw new Error('Unsupported InnoVox database version.');
  if (database.prepare('PRAGMA quick_check').get()?.quick_check !== 'ok') throw new Error('Database integrity check failed.');
  for (const table of ['projects', 'sessions', 'events', 'consultations', 'deliveries', 'journal']) {
    if (!database.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?").get(table)) throw new Error('Missing InnoVox state table.');
  }
  return version;
}
/** SQLite's online backup includes WAL content without opening a domain writer. */
export async function backupState(source: string, destination: string) {
  source = resolve(source); destination = resolve(destination);
  if (source === destination) throw new Error('Backup must use a new destination.');
  await regular(source);
  const database = new DatabaseSync(source, { readOnly: true });
  const pending = destination + '.pending-' + randomUUID();
  const pendingManifest = pending + '.manifest.json';
  const owned = new Map<string, { dev: number; ino: number; sha256: string }>();
  const remember = async (path: string) => {
    const entry = await lstat(path); owned.set(path, { dev: entry.dev, ino: entry.ino, sha256: await fingerprint(path) });
  };
  const removeOwned = async (path: string) => {
    const expected = owned.get(path); if (!expected) return;
    try {
      const entry = await lstat(path);
      if (entry.isFile() && !entry.isSymbolicLink() && entry.dev === expected.dev && entry.ino === expected.ino && await fingerprint(path) === expected.sha256) await unlink(path);
    } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
  };
  let publishedManifest = false, complete = false;
  try {
    inspect(database); // Invalid sources must not reserve any output name.
    await mkdir(dirname(destination), { recursive: true, mode: 0o700 });
    await writeFile(pending, '', { flag: 'wx', mode: 0o600 }); await remember(pending);
    await backup(database, pending); await chmod(pending, 0o600); await remember(pending);
    const check = new DatabaseSync(pending);
    let schemaVersion: number;
    try {
      // The standalone backup must not leave WAL sidecars at its temporary name.
      check.exec('PRAGMA journal_mode=DELETE'); schemaVersion = inspect(check);
    } finally { check.close(); }
    await remember(pending);
    const manifest = { formatVersion: 1 as const, schemaVersion, createdAt: new Date().toISOString(),
      bytes: (await stat(pending)).size, sha256: await fingerprint(pending) };
    await writeFile(pendingManifest, JSON.stringify(manifest, null, 2) + '\n', { flag: 'wx', mode: 0o600 }); await remember(pendingManifest);
    // Hard links publish exclusively; a preexisting file is never replaced.
    await link(pendingManifest, destination + '.manifest.json');
    owned.set(destination + '.manifest.json', owned.get(pendingManifest)!); publishedManifest = true;
    await link(pending, destination); complete = true;
    return manifest;
  } finally {
    database.close();
    if (publishedManifest && !complete) await removeOwned(destination + '.manifest.json');
    await removeOwned(pendingManifest); await removeOwned(pending);
  }
}
/** Restore to a new file only. Activation requires an explicit service reconfiguration. */
export async function restoreState(source: string, destination: string) {
  source = resolve(source); destination = resolve(destination);
  await regular(source); await regular(source + '.manifest.json');
  const manifest = manifestSchema.parse(JSON.parse(await readFile(source + '.manifest.json', 'utf8')));
  if ((await stat(source)).size !== manifest.bytes || await fingerprint(source) !== manifest.sha256) throw new Error('Backup fingerprint does not match its manifest.');
  await mkdir(dirname(destination), { recursive: true, mode: 0o700 });
  await copyFile(source, destination, constants.COPYFILE_EXCL); await chmod(destination, 0o600);
  if (await fingerprint(destination) !== manifest.sha256) throw new Error('Restored bytes do not match the verified backup.');
  const restored = new DatabaseSync(destination, { readOnly: true });
  try { if (inspect(restored) !== manifest.schemaVersion) throw new Error('Restored schema does not match.'); }
  finally { restored.close(); }
  return { verified: true, activated: false, schemaVersion: manifest.schemaVersion };
}
async function main() {
  const { values } = parseArgs({ options: { restore: { type: 'string' }, output: { type: 'string' } } });
  if (values.restore && !values.output) throw new Error('Restore requires a new --output file.');
  const output = resolve(values.output ?? `.innovox/backups/${new Date().toISOString().replace(/[:.]/g, '-')}-${randomUUID().slice(0, 8)}.sqlite`);
  const result = values.restore ? await restoreState(values.restore, output)
    : await backupState(process.env.INNOVOX_DATABASE ?? '.innovox/state.sqlite', output);
  console.log(JSON.stringify({ output, ...result, configurationFilesIncluded: false }, null, 2));
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  void main().catch(() => { console.error('State backup or restore failed. Check paths, ownership, manifest and database version. Existing files were not replaced.'); process.exitCode = 1; });
}
