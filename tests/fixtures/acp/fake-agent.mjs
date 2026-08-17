/* global process */
import { createRequire } from 'node:module';
import { read as readFd, write as writeFd } from 'node:fs';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { pathToFileURL, URL } from 'node:url';

const requireFromAdapter = createRequire(
  new URL('../../../packages/adapter-acp/package.json', import.meta.url),
);
const { AGENT_METHODS, CLIENT_METHODS, PROTOCOL_VERSION, agent, ndJsonStream } = await import(
  pathToFileURL(requireFromAdapter.resolve('@agentclientprotocol/sdk')).href
);

let sessionCounter = 0;
let currentMode = 'agent';
let currentModel = 'fixture-model';
let currentReasoningEffort = 'low';
let currentCollaborationMode = 'default';

const availableModes = () => [
  { id: 'read-only', name: 'Read-only', description: '只读模式' },
  { id: 'agent', name: 'Agent', description: '执行模式' },
];

const configOptions = () => [
  {
    id: 'model',
    name: 'Model',
    category: 'model',
    type: 'select',
    currentValue: currentModel,
    options: [
      { value: 'fixture-model', name: 'Fixture Model' },
      { value: 'fixture-model-2', name: 'Fixture Model 2' },
    ],
  },
  {
    id: 'thought-level',
    name: 'Reasoning effort',
    category: 'thought_level',
    type: 'select',
    currentValue: currentReasoningEffort,
    options: [
      { value: 'low', name: 'Low' },
      { value: 'high', name: 'High' },
    ],
  },
  {
    id: 'collaboration-mode',
    name: 'Collaboration mode',
    category: 'collaboration_mode',
    type: 'select',
    currentValue: currentCollaborationMode,
    options: [
      { value: 'default', name: 'Default' },
      { value: 'plan', name: 'Plan', description: '规划模式' },
    ],
  },
];

const sessionConfiguration = () => ({
  modes: { currentModeId: currentMode, availableModes: availableModes() },
  configOptions: configOptions(),
});

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
      ...sessionConfiguration(),
    };
  })
  .onRequest(AGENT_METHODS.session_load, () => sessionConfiguration())
  .onRequest(AGENT_METHODS.session_resume, () => sessionConfiguration())
  .onRequest(AGENT_METHODS.session_close, async () => {
    if (process.argv.includes('--hang-close')) await new Promise(() => {});
    return {};
  })
  .onRequest(AGENT_METHODS.session_set_mode, async ({ params, client }) => {
    currentMode = params.modeId;
    await client.notify(CLIENT_METHODS.session_update, {
      sessionId: params.sessionId,
      update: { sessionUpdate: 'current_mode_update', currentModeId: currentMode },
    });
    return {};
  })
  .onRequest(AGENT_METHODS.session_set_config_option, async ({ params, client }) => {
    if (params.configId === 'thought-level') currentReasoningEffort = params.value;
    else if (params.configId === 'collaboration-mode') currentCollaborationMode = params.value;
    else currentModel = params.value;
    await client.notify(CLIENT_METHODS.session_update, {
      sessionId: params.sessionId,
      update: { sessionUpdate: 'config_option_update', configOptions: configOptions() },
    });
    return { configOptions: configOptions() };
  })
  .onRequest(AGENT_METHODS.session_prompt, async ({ params, client }) => {
    if (process.argv.includes('--hang-prompt')) await new Promise(() => {});
    if (process.argv.includes('--transport-warning')) {
      await client.notify(CLIENT_METHODS.session_update, {
        sessionId: params.sessionId,
        update: {
          sessionUpdate: 'agent_message_chunk',
          content: {
            type: 'text',
            text: 'Warning: Falling back from WebSockets to HTTPS transport. stream disconnected before completion: error sending request for url (https://example.invalid/private)\n',
          },
        },
      });
      return { stopReason: 'end_turn' };
    }
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
