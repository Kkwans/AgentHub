import pino from 'pino';
import request from 'supertest';
import { describe, expect, it } from 'vitest';

import { createApp } from '../app.js';
import { AppError } from '../errors.js';

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

  it('keeps discovery route contracts stable across list, rescan, and adopt', async () => {
    const calls = { runtimeRescan: 0, agentRescan: 0, runtimeAdopt: '', agentAdopt: '' };
    const app = createApp({
      logger: pino({ level: 'silent' }),
      runtimeDiscovery: {
        list: async () => [{ candidateId: 'docker:claude', kind: 'DOCKER_CONTAINER' }],
        rescan: async () => {
          calls.runtimeRescan += 1;
          return [{ candidateId: 'docker:claude', kind: 'DOCKER_CONTAINER', state: 'READY' }];
        },
        adopt: async (candidateId: string) => {
          calls.runtimeAdopt = candidateId;
          return { id: 'target-claude' };
        },
      } as never,
      agentDiscovery: {
        list: async () => [{ candidateId: 'docker:claude:claude_code', state: 'READY' }],
        rescan: async () => {
          calls.agentRescan += 1;
          return [{ candidateId: 'docker:claude:claude_code', state: 'READY' }];
        },
        adopt: async (candidateId: string) => {
          calls.agentAdopt = candidateId;
          return { agent: { id: 'agent-claude' }, preflight: { status: 'READY' } };
        },
      } as never,
    });

    expect((await request(app).get('/api/v1/discovery/agents')).status).toBe(200);
    expect((await request(app).get('/api/v1/discovery/runtimes')).status).toBe(200);
    expect((await request(app).post('/api/v1/discovery/agents/rescan')).status).toBe(200);
    expect((await request(app).post('/api/v1/discovery/runtimes/rescan')).status).toBe(200);
    expect(
      (await request(app).post('/api/v1/discovery/agents/docker%3Aclaude%3Aclaude_code/adopt'))
        .status,
    ).toBe(201);
    expect(
      (await request(app).post('/api/v1/discovery/runtimes/docker%3Aclaude/adopt')).status,
    ).toBe(201);
    expect(calls).toEqual({
      runtimeRescan: 1,
      agentRescan: 1,
      runtimeAdopt: 'docker:claude',
      agentAdopt: 'docker:claude:claude_code',
    });
  });

  it('returns stable validation and adoption errors for unsafe candidate actions', async () => {
    const app = createApp({
      logger: pino({ level: 'silent' }),
      runtimeDiscovery: {
        list: async () => [],
        rescan: async () => [],
        adopt: async () => {
          throw new AppError(409, 'RUNTIME_CANDIDATE_NOT_ADOPTABLE', '当前 Runtime 不能接管');
        },
      } as never,
      agentDiscovery: {
        list: async () => [],
        rescan: async () => [],
        adopt: async () => {
          throw new AppError(409, 'AGENT_CANDIDATE_NOT_ADOPTABLE', '该 Agent 当前不能接入', {
            state: 'STOPPED',
            reasonCode: 'RUNTIME_STOPPED',
          });
        },
      } as never,
    });

    const invalid = await request(app).post(`/api/v1/discovery/agents/${'a'.repeat(241)}/adopt`);
    expect(invalid.status).toBe(400);
    expect(invalid.body.error).toMatchObject({ code: 'VALIDATION_FAILED' });

    const agentError = await request(app).post(
      '/api/v1/discovery/agents/docker%3Astopped%3Ahermes/adopt',
    );
    expect(agentError.status).toBe(409);
    expect(agentError.body.error).toMatchObject({
      code: 'AGENT_CANDIDATE_NOT_ADOPTABLE',
      details: { state: 'STOPPED', reasonCode: 'RUNTIME_STOPPED' },
    });

    const runtimeError = await request(app).post(
      '/api/v1/discovery/runtimes/docker%3Astopped/adopt',
    );
    expect(runtimeError.status).toBe(409);
    expect(runtimeError.body.error.code).toBe('RUNTIME_CANDIDATE_NOT_ADOPTABLE');
  });
});
