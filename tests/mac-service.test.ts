import test from 'node:test';
import assert from 'node:assert/strict';
import { launchAgent, launchStatus } from '../src/mac-service.js';
import { spawnSync } from 'node:child_process';

test('Mac launch agent binds its checkout and node executable without shell commands or embedded credentials', () => {
  const spec = launchAgent('/Users/example/Work & projects/InnoVox', '/Applications/Node App/node', '/Users/example');
  assert.deepEqual(spec.argumentsList, ['/Applications/Node App/node',
    '--env-file-if-exists=/Users/example/Work & projects/InnoVox/.env.local', '/Users/example/Work & projects/InnoVox/dist/src/main.js']);
  assert.ok(spec.plist.includes('Work &amp; projects'));
  assert.ok(!spec.plist.includes('OPENAI_API_KEY'));
  assert.notEqual(spec.label, launchAgent('/Users/example/other', '/usr/bin/node', '/Users/example').label);
  assert.throws(() => launchAgent('relative', '/usr/bin/node', '/Users/example'));
  if (process.platform === 'darwin') {
    const checked = spawnSync('/usr/bin/plutil', ['-lint', '-'], { input: spec.plist, encoding: 'utf8' });
    assert.equal(checked.status, 0, checked.stderr);
  }
});
test('Mac service status reports selected lifecycle fields without exposing launchd environment output', () => {
  assert.deepEqual(launchStatus('service = {\n state = running\n pid = 42\n last exit code = 0\n environment = PRIVATE\n}'),
    { state: 'running', pid: 42, lastExitCode: '0' });
});
