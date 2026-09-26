import { parseArgs } from 'node:util';
import { BrokerClient, brokerToken, serverOrigin } from './broker-client.js';

try {
  const { values } = parseArgs({ options: { url: { type: 'string', default: `http://127.0.0.1:${process.env.INNOVOX_PORT ?? '4317'}` } } });
  const origin = serverOrigin(values.url!);
  const broker = new BrokerClient(origin, await brokerToken(origin));
  const pair = await broker.request<{ code: string; expiresAt: string }>('/api/pairing', {});
  console.log(JSON.stringify({ url: process.env.INNOVOX_ORIGIN ?? origin.origin, pairingCode: pair.code, expiresAt: pair.expiresAt,
    instructions: 'Open InnoVox on your browser and enter this one-time code. Never enter an OpenAI API key there.' }, null, 2));
} catch {
  console.error('Browser pairing failed. Start the server and use its owner access token. No credential was printed.');
  process.exitCode = 1;
}
