import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
const [nodeMajor = 0, nodeMinor = 0] = process.versions.node.split('.').map(Number);
let osVersion = 'not inspected';
if (process.platform === 'darwin') {
  try { osVersion = execFileSync('/usr/bin/sw_vers', ['-productVersion'], { encoding: 'utf8', timeout: 3000 }).trim(); }
  catch { osVersion = 'unavailable'; }
}
console.log(JSON.stringify({
  platform: process.platform, architecture: process.arch, node: process.version, osVersion,
  nodeSupported: nodeMajor === 24 && nodeMinor >= 19,
  configured: { applicationToken: Boolean(process.env.INNOVOX_ACCESS_TOKEN) || existsSync('.innovox/access-token'),
    openaiKey: Boolean(process.env.OPENAI_API_KEY?.trim()) },
  implemented: { conversationLogCollector: true, persistentConsultations: true, browserWebRtcAdapter: true,
    nativeScreenCapture: false, accessibilityCapture: false, automaticSessionInput: false },
  verification: { microphonePermission: 'check in browser and OS settings', providerAccess: 'not tested by doctor',
    screenPermission: 'not requested', accessibilityPermission: 'not requested' },
  guide: process.platform === 'darwin' ? 'docs/platforms/macos.md' : 'docs/operations.md',
}, null, 2));
