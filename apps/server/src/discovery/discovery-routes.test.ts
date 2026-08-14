import pino from 'pino';
import request from 'supertest';
import { describe, expect, it } from 'vitest';

import { createApp } from '../app.js';

describe('Discovery API', () => {
  it('exposes rescan/adopt routes without leaking manual Docker fields', async () => {
    const app = createApp({
      logger: pino({ level: 'silent' }),
      runtimeDiscovery: {
        list: async () => [
          {
            candidateId: 'host:local',
            kind: 'LOCAL_HOST',
            displayName: '本机',
            state: 'READY',
            workspaceMappings: [],
            adoptable: true,
          },
        ],
        rescan: async () => [],
        adopt: async () => ({ id: 'target-1' }),
      } as never,
      agentDiscovery: {
        list: async () => [
          {
            candidateId: 'host:codex',
            agentKind: 'CODEX',
            displayName: 'Codex',
            targetCandidateId: 'host:local',
            state: 'INSTALLED',
            adapterKind: 'ACP_STDIO',
            adoptable: true,
          },
        ],
        rescan: async () => [],
        adopt: async () => ({ id: 'agent-1' }),
      } as never,
    });

    const runtimes = await request(app).get('/api/v1/discovery/runtimes');
    expect(runtimes.status).toBe(200);
    expect(runtimes.body.data[0]).not.toHaveProperty('expectedContainerId');
    expect(runtimes.body.data[0]).not.toHaveProperty('hostname');

    const agents = await request(app).post('/api/v1/discovery/agents/rescan');
    expect(agents.status).toBe(200);
    expect(agents.body.data).toEqual([]);

    const adopted = await request(app).post('/api/v1/discovery/runtimes/host%3Alocal/adopt');
    expect(adopted.status).toBe(201);
    expect(adopted.body.data).toEqual({ id: 'target-1' });
  });
});
