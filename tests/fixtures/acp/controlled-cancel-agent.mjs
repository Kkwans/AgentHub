/* global process */
// Dedicated real-ACP cancellation fixture. The test owns a disposable release
// file; no database state or production runtime is manipulated.
import { createRequire } from 'node:module';
import { Buffer } from 'node:buffer';
import { ReadableStream, WritableStream } from 'node:stream/web';
import { read as readFd, write as writeFd, existsSync } from 'node:fs';
import { setTimeout as sleep } from 'node:timers/promises';
import { pathToFileURL, URL } from 'node:url';
const requireFromAdapter = createRequire(
  new URL('../../../packages/adapter-acp/package.json', import.meta.url),
);
const { AGENT_METHODS, CLIENT_METHODS, PROTOCOL_VERSION, agent, ndJsonStream } = await import(
  pathToFileURL(requireFromAdapter.resolve('@agentclientprotocol/sdk')).href
);
const releaseFile = process.argv[2];
if (!releaseFile) throw new Error('Cancellation fixture requires an isolated release file');
let counter = 0;
const canceled = new Set();
const fixture = agent({ name: 'AgentHub Controlled Cancellation Fixture' })
  .onRequest(AGENT_METHODS.initialize, () => ({
    protocolVersion: PROTOCOL_VERSION,
    agentInfo: { name: 'agenthub-cancel-fixture', version: '1.0.0' },
    agentCapabilities: { loadSession: true },
  }))
  .onRequest(AGENT_METHODS.session_new, () => ({ sessionId: `cancel-fixture-${++counter}` }))
  .onRequest(AGENT_METHODS.session_load, () => ({}))
  .onRequest(AGENT_METHODS.session_prompt, async ({ params, client }) => {
    await client.notify(CLIENT_METHODS.session_update, {
      sessionId: params.sessionId,
      update: {
        sessionUpdate: 'agent_message_chunk',
        content: { type: 'text', text: '取消测试：等待真实取消通知和测试释放门闩。' },
      },
    });
    while (!canceled.has(params.sessionId) || !existsSync(releaseFile)) await sleep(25);
    return { stopReason: 'cancelled' };
  })
  .onNotification(AGENT_METHODS.session_cancel, ({ params }) => {
    canceled.add(params.sessionId);
  });

const connection = fixture.connect(
  ndJsonStream(
    new WritableStream({
      write(chunk) {
        const data = Buffer.from(chunk);
        return new Promise((resolve, reject) => {
          writeFd(1, data, 0, data.byteLength, null, (error) => {
            if (error) reject(error);
            else resolve();
          });
        });
      },
    }),
    new ReadableStream({
      start(controller) {
        const readNext = () => {
          const buffer = Buffer.allocUnsafe(64 * 1024);
          readFd(0, buffer, 0, buffer.byteLength, null, (error, bytesRead) => {
            if (error) {
              controller.error(error);
              return;
            }
            if (bytesRead === 0) {
              controller.close();
              return;
            }
            controller.enqueue(Uint8Array.from(buffer.subarray(0, bytesRead)));
            readNext();
          });
        };
        readNext();
      },
    }),
  ),
);
await connection.closed;
