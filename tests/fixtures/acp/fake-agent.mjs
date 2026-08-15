/* global process */
import { createRequire } from 'node:module';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { Readable, Writable } from 'node:stream';
import { pathToFileURL, URL } from 'node:url';

const requireFromAdapter = createRequire(
  new URL('../../../packages/adapter-acp/package.json', import.meta.url),
);
const { AGENT_METHODS, CLIENT_METHODS, PROTOCOL_VERSION, agent, ndJsonStream } = await import(
  pathToFileURL(requireFromAdapter.resolve('@agentclientprotocol/sdk')).href
);

let sessionCounter = 0;
let currentMode = 'agent';

const fixture = agent({ name: 'AgentHub ACP Fixture' })
  .onRequest(AGENT_METHODS.initialize, () => ({
    protocolVersion: PROTOCOL_VERSION,
    agentInfo: { name: 'agenthub-fixture', title: 'AgentHub Fixture', version: '1.0.0' },
    agentCapabilities: {
      loadSession: true,
      promptCapabilities: { image: true, embeddedContext: true },
      mcpCapabilities: { http: true },
      sessionCapabilities: { additionalDirectories: {}, resume: {}, close: {} },
    },
  }))
  .onRequest(AGENT_METHODS.session_new, () => {
    sessionCounter += 1;
    return {
      sessionId: `fixture-session-${sessionCounter}`,
      modes: {
        currentModeId: currentMode,
        availableModes: [
          { id: 'agent', name: 'Agent', description: '执行模式' },
          { id: 'plan', name: 'Plan', description: '规划模式' },
        ],
      },
    };
  })
  .onRequest(AGENT_METHODS.session_load, () => ({}))
  .onRequest(AGENT_METHODS.session_resume, () => ({}))
  .onRequest(AGENT_METHODS.session_close, async () => {
    if (process.argv.includes('--hang-close')) await new Promise(() => {});
    return {};
  })
  .onRequest(AGENT_METHODS.session_set_mode, ({ params }) => {
    currentMode = params.modeId;
    return {};
  })
  .onRequest(AGENT_METHODS.session_prompt, async ({ params, client }) => {
    await client.notify(CLIENT_METHODS.session_update, {
      sessionId: params.sessionId,
      update: {
        sessionUpdate: 'plan',
        entries: [{ content: '执行 Fixture', priority: 'high', status: 'in_progress' }],
      },
    });
    await client.notify(CLIENT_METHODS.session_update, {
      sessionId: params.sessionId,
      update: {
        sessionUpdate: 'tool_call',
        toolCallId: 'tool-1',
        title: '修改 Fixture 文件',
        kind: 'edit',
        status: 'pending',
        locations: [{ path: '/workspace/fixture.ts' }],
      },
    });
    const permission = await client.request(CLIENT_METHODS.session_request_permission, {
      sessionId: params.sessionId,
      toolCall: {
        toolCallId: 'tool-1',
        title: '修改 Fixture 文件',
        kind: 'edit',
        status: 'pending',
      },
      options: [
        { optionId: 'allow-once', name: '允许一次', kind: 'allow_once' },
        { optionId: 'reject-once', name: '拒绝', kind: 'reject_once' },
      ],
    });
    if (permission.outcome.outcome !== 'selected' || permission.outcome.optionId !== 'allow-once') {
      return { stopReason: 'refusal' };
    }
    if (process.argv.includes('--write-fixture')) {
      await writeFile(
        join(process.cwd(), 'fixture-output.md'),
        '# AgentHub real E2E\n\nApproval 已确认，真实 ACP fixture 已写入此文件。\n',
        'utf8',
      );
    }
    await client.notify(CLIENT_METHODS.session_update, {
      sessionId: params.sessionId,
      update: {
        sessionUpdate: 'tool_call_update',
        toolCallId: 'tool-1',
        status: 'completed',
      },
    });
    await client.notify(CLIENT_METHODS.session_update, {
      sessionId: params.sessionId,
      update: {
        sessionUpdate: 'agent_message_chunk',
        content: { type: 'text', text: 'Fixture 已完成' },
      },
    });
    await client.notify(CLIENT_METHODS.session_update, {
      sessionId: params.sessionId,
      update: { sessionUpdate: 'usage_update', used: 12, size: 128 },
    });
    return { stopReason: 'end_turn' };
  })
  .onNotification(AGENT_METHODS.session_cancel, () => {});

const connection = fixture.connect(
  ndJsonStream(Writable.toWeb(process.stdout), Readable.toWeb(process.stdin)),
);
await connection.closed;
