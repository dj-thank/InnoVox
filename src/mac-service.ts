import { createHash } from 'node:crypto';
import { existsSync, lstatSync, mkdirSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { homedir } from 'node:os';
import { posix, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { z } from 'zod';

const hash = (value: string) => createHash('sha256').update(value).digest('hex');
class ServiceSetupError extends Error {}
const xml = (value: string) => value.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' }[c]!));
export function launchAgent(root: string, node: string, home: string) {
  if (![root, node, home].every(p => posix.isAbsolute(p) && !/[\r\n\0]/.test(p))) throw new Error('Absolute local paths are required.');
  const label = 'org.innovox.server.' + hash(root).slice(0, 12);
  const plistPath = posix.join(home, 'Library/LaunchAgents', label + '.plist');
  const argumentsList = [node, '--env-file-if-exists=' + posix.join(root, '.env.local'), posix.join(root, 'dist/src/main.js')];
  const plist = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
<key>Label</key><string>${xml(label)}</string>
<key>ProgramArguments</key><array>${argumentsList.map(v => '<string>' + xml(v) + '</string>').join('')}</array>
<key>WorkingDirectory</key><string>${xml(root)}</string>
<key>RunAtLoad</key><true/><key>KeepAlive</key><true/>
<key>ThrottleInterval</key><integer>30</integer><key>ExitTimeOut</key><integer>65</integer>
<key>ProcessType</key><string>Background</string><key>Umask</key><integer>63</integer>
<key>StandardOutPath</key><string>${xml(posix.join(root, '.innovox/service/stdout.log'))}</string>
<key>StandardErrorPath</key><string>${xml(posix.join(root, '.innovox/service/stderr.log'))}</string>
</dict></plist>\n`;
  return { label, plistPath, plist, argumentsList };
}
export function launchStatus(text: string) {
  const pid = /(?:^|\n)\s*pid = (\d+)\s*(?:\n|$)/.exec(text)?.[1];
  return { state: /(?:^|\n)\s*state = ([\w -]+)/.exec(text)?.[1]?.trim() ?? 'loaded',
    pid: pid ? Number(pid) : null,
    lastExitCode: /(?:^|\n)\s*last exit code = (-?\d+)/.exec(text)?.[1] ?? null };
}
function regular(path: string) {
  if (!existsSync(path) || !lstatSync(path).isFile() || lstatSync(path).isSymbolicLink()) throw new ServiceSetupError('A required runtime or ownership file is missing or linked.');
}
function directory(path: string) {
  if (existsSync(path) && (!lstatSync(path).isDirectory() || lstatSync(path).isSymbolicLink())) throw new ServiceSetupError('Refusing a linked service directory.');
  mkdirSync(path, { recursive: true, mode: 0o700 });
}
async function main() {
  const action = process.argv[2] ?? 'status';
  if (!['install', 'start', 'stop', 'status'].includes(action)) throw new ServiceSetupError('Use install, start, stop or status.');
  if (process.platform !== 'darwin' || !process.getuid || process.getuid() === 0) throw new ServiceSetupError('Run as the signed-in Mac user, without sudo.');
  const [major = 0, minor = 0] = process.versions.node.split('.').map(Number);
  if (major !== 24 || minor < 19) throw new ServiceSetupError('Use Node.js 24.19 or a newer 24.x release.');
  const root = realpathSync(fileURLToPath(new URL('../../', import.meta.url)));
  const node = realpathSync(process.execPath), uid = process.getuid(), spec = launchAgent(root, node, realpathSync(homedir()));
  const statePath = posix.join(root, '.innovox/service'), manifestPath = posix.join(statePath, 'owner.json');
  const target = `gui/${uid}/${spec.label}`;
  const launchctl = (args: string[]) => spawnSync('/bin/launchctl', args, { encoding: 'utf8', timeout: 10_000, maxBuffer: 64 * 1024 });
  const status = () => {
    const result = launchctl(['print', target]);
    if (result.status === 0) return { loaded: true, ...launchStatus(result.stdout) };
    if (/Could not find (specified )?service/i.test(result.stderr ?? '')) return { loaded: false, state: 'not_loaded', pid: null, lastExitCode: null };
    return { loaded: null, state: 'query_failed', pid: null, lastExitCode: null };
  };
  const verifyOwner = () => {
    regular(manifestPath); regular(spec.plistPath);
    const owner = z.object({ root: z.literal(root), label: z.literal(spec.label), plistPath: z.literal(spec.plistPath),
      uid: z.literal(uid), digest: z.string() }).passthrough().parse(JSON.parse(readFileSync(manifestPath, 'utf8')));
    if (hash(readFileSync(spec.plistPath, 'utf8')) !== owner.digest) throw new ServiceSetupError('Installed service differs from its ownership record.');
  };
  if (action === 'install') {
    regular(posix.join(root, 'dist/src/main.js')); regular(posix.join(root, '.innovox/access-token'));
    if (existsSync(spec.plistPath) || existsSync(manifestPath)) {
      verifyOwner();
      if (readFileSync(spec.plistPath, 'utf8') !== spec.plist) throw new ServiceSetupError('The installed runtime changed. Keep the old service stopped and review its paths before updating.');
    } else {
      directory(posix.join(root, '.innovox')); directory(statePath);
      directory(posix.dirname(spec.plistPath));
      for (const name of ['stdout.log', 'stderr.log']) {
        const path = posix.join(statePath, name);
        if (existsSync(path)) regular(path); else writeFileSync(path, '', { flag: 'wx', mode: 0o600 });
      }
      writeFileSync(spec.plistPath, spec.plist, { flag: 'wx', mode: 0o600 });
      writeFileSync(manifestPath, JSON.stringify({ root, node, label: spec.label, plistPath: spec.plistPath,
        uid, digest: hash(spec.plist), installedAt: new Date().toISOString() }, null, 2), { flag: 'wx', mode: 0o600 });
    }
  }
  if (action === 'status' && !existsSync(manifestPath)) {
    if (existsSync(spec.plistPath)) throw new ServiceSetupError('A LaunchAgent exists without its ownership receipt; its lifecycle is unverified.');
    console.log(JSON.stringify({ installed: false, loaded: false, serverHealthChecked: false })); return;
  }
  verifyOwner();
  if (action === 'stop') {
    const before = status();
    if (before.loaded === null) throw new ServiceSetupError('Could not verify launchd state; no stop was requested.');
    if (before.loaded) {
      if (before.pid) {
        const started = spawnSync('/bin/ps', ['-p', String(before.pid), '-o', 'lstart='], { encoding: 'utf8', timeout: 3000 }).stdout?.trim();
        const check = status();
        const startedAgain = spawnSync('/bin/ps', ['-p', String(before.pid), '-o', 'lstart='], { encoding: 'utf8', timeout: 3000 }).stdout?.trim();
        if (!started || check.pid !== before.pid || startedAgain !== started) throw new ServiceSetupError('Service process changed; inspect status before retrying.');
      }
      if (launchctl(['bootout', target]).status !== 0) throw new ServiceSetupError('Could not stop the owned launchd service.');
    }
  } else if (action === 'install' || action === 'start') {
    const before = status();
    if (before.loaded === null) throw new ServiceSetupError('Could not verify launchd state. Run from a signed-in Mac session and inspect status.');
    if (!before.loaded && launchctl(['bootstrap', `gui/${uid}`, spec.plistPath]).status !== 0) throw new ServiceSetupError('Service was installed but could not start. Run from a signed-in Mac session and inspect status.');
  }
  console.log(JSON.stringify({ installed: true, label: spec.label, ...status(), serverHealthChecked: false,
    startsAfterLogin: true, microphoneOrScreenAccessGranted: false }, null, 2));
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  void main().catch(error => { console.error(error instanceof ServiceSetupError ? error.message : 'Mac service setup failed. Check filesystem permissions and ownership records; no credential was printed.'); process.exitCode = 1; });
}
