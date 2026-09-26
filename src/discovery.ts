import { lstat, open, readdir, realpath } from 'node:fs/promises';
import { isAbsolute, join, relative, resolve, sep } from 'node:path';
import { id } from './contracts.js';

export type DiscoveredSource = { file: string; adapter: 'codex' | 'claude'; sessionId: string; workspace: string; version: string | null };
export type DiscoveryReport = { sources: DiscoveredSource[]; inspectedFiles: number; skippedFiles: number;
  metadataReads: number; ambiguousSessions: string[]; limitReached: boolean };
export type DiscoveryCache = Map<string, { size: number; mtime: number; ino: number; dev: number; meta?: Omit<DiscoveredSource, 'file'> }>;
function inside(root: string, path: string): boolean {
  const r = process.platform === 'win32' ? root.toLowerCase() : root;
  const p = process.platform === 'win32' ? path.toLowerCase() : path;
  const tail = relative(r, p); return tail === '' || (!tail.startsWith('..' + sep) && tail !== '..' && !isAbsolute(tail));
}
function object(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
}
async function metadata(file: string): Promise<Omit<DiscoveredSource, 'file'> | undefined> {
  const handle = await open(file, 'r');
  try {
    const buffer = Buffer.alloc(256 * 1024);
    const { bytesRead } = await handle.read(buffer, 0, buffer.length, 0);
    const content = buffer.subarray(0, bytesRead).toString('utf8');
    const lines = content.split('\n').slice(0, 20);
    for (const line of lines) {
      if (!line.trim()) continue;
      let record: Record<string, unknown> | undefined;
      try { record = object(JSON.parse(line)); } catch { return undefined; }
      if (!record) continue;
      const payload = record.type === 'session_meta' ? object(record.payload) : undefined;
      if (payload && typeof payload.cwd === 'string' && id.safeParse(payload.id).success) {
        return { adapter: 'codex', sessionId: String(payload.id), workspace: payload.cwd,
          version: typeof payload.cli_version === 'string' ? payload.cli_version : null };
      }
      if (typeof record.cwd === 'string' && id.safeParse(record.sessionId).success) {
        return { adapter: 'claude', sessionId: String(record.sessionId), workspace: record.cwd,
          version: typeof record.version === 'string' ? record.version : null };
      }
    }
    return undefined;
  } finally { await handle.close(); }
}

/** Only explicit source roots and matching workspace metadata are eligible. */
export async function discoverSessions(roots: string[], workspace: string, options: { maxFiles?: number; maxDepth?: number; cache?: DiscoveryCache } = {}): Promise<DiscoveryReport> {
  const workspaceRoot = await realpath(resolve(workspace));
  const maxFiles = options.maxFiles ?? 1000, maxDepth = options.maxDepth ?? 8;
  if (!Number.isInteger(maxFiles) || maxFiles < 1 || maxFiles > 10000) throw new Error('Invalid discovery limit.');
  if (!Number.isInteger(maxDepth) || maxDepth < 0 || maxDepth > 16) throw new Error('Invalid discovery depth.');
  const report: DiscoveryReport = { sources: [], inspectedFiles: 0, metadataReads: 0, skippedFiles: 0, ambiguousSessions: [], limitReached: false };
  const candidates: DiscoveredSource[] = [], seenFiles = new Set<string>();
  let directories = 0;
  const walk = async (root: string, directory: string, depth: number): Promise<void> => {
    if (report.inspectedFiles >= maxFiles || directories >= 1024) { report.limitReached = true; return; }
    directories++;
    if (depth > maxDepth) { report.limitReached = true; return; }
    let entries;
    try { entries = await readdir(directory, { withFileTypes: true }); } catch { report.skippedFiles++; return; }
    entries.sort((a, b) => b.name.localeCompare(a.name));
    for (const entry of entries) {
      if (report.inspectedFiles >= maxFiles || directories >= 1024) { report.limitReached = true; return; }
      if (entry.isSymbolicLink()) { report.skippedFiles++; continue; }
      const path = join(directory, entry.name);
      if (entry.isDirectory()) { await walk(root, path, depth + 1); continue; }
      if (!entry.isFile() || !entry.name.endsWith('.jsonl')) continue;
      if (report.inspectedFiles >= maxFiles) { report.limitReached = true; return; }
      let actual: string;
      try { actual = await realpath(path); } catch { report.skippedFiles++; continue; }
      if (!inside(root, actual) || seenFiles.has(actual)) continue;
      seenFiles.add(actual); report.inspectedFiles++;
      let meta: Omit<DiscoveredSource, 'file'> | undefined;
      try {
        const info = await lstat(actual), cached = options.cache?.get(actual);
        if (!info.isFile() || info.isSymbolicLink()) { report.skippedFiles++; continue; }
        if (cached && cached.size === info.size && cached.mtime === info.mtimeMs && cached.ino === info.ino && cached.dev === info.dev) meta = cached.meta;
        else { report.metadataReads++; meta = await metadata(actual); options.cache?.set(actual,
          { size: info.size, mtime: info.mtimeMs, ino: info.ino, dev: info.dev, meta }); }
      } catch { report.skippedFiles++; continue; }
      if (!meta || !isAbsolute(meta.workspace)) { report.skippedFiles++; continue; }
      let actualWorkspace: string;
      try { actualWorkspace = await realpath(meta.workspace); } catch { report.skippedFiles++; continue; }
      if (!inside(workspaceRoot, actualWorkspace)) { report.skippedFiles++; continue; }
      candidates.push({ ...meta, workspace: actualWorkspace, file: actual });
    }
  };
  for (const input of roots) {
    const path = resolve(input);
    const info = await lstat(path);
    if (!info.isDirectory() || info.isSymbolicLink()) throw new Error('Discovery roots must be explicit regular directories.');
    const root = await realpath(path); await walk(root, root, 0);
  }
  const groups = new Map<string, DiscoveredSource[]>();
  for (const candidate of candidates) {
    const key = candidate.adapter + ':' + candidate.sessionId;
    groups.set(key, [...(groups.get(key) ?? []), candidate]);
  }
  for (const [key, group] of groups) {
    if (group.length > 1) report.ambiguousSessions.push(key);
    else report.sources.push(group[0]!);
  }
  if (options.cache) for (const path of options.cache.keys()) if (!seenFiles.has(path)) options.cache.delete(path);
  return report;
}
