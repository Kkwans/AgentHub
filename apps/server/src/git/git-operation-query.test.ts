import express from 'express';
import request from 'supertest';
import { ZodError } from 'zod';
import { describe, expect, it, vi } from 'vitest';
import type { AuthPrincipal } from '../auth/auth-service.js';
import { GitService } from './git-service.js';
import { createGitRouter } from './git-routes.js';

const projectId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const operationId = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const account: AuthPrincipal = {
  kind: 'browser_session',
  accountId: 'original',
  sessionId: 'session-1',
  username: 'test',
  role: 'ADMIN',
};
const stored = {
  ownerScope: 'account:original',
  operationId,
  projectId,
  protocolVersion: 1,
  requestHash: 'hash',
  payloadJson: { message: '原说明', paths: ['a.ts'] },
  expectedHead: null,
  phase: 'UNKNOWN',
  observedAfterHead: null,
  commandExit: null,
  resultEvidenceJson: {},
  errorCode: 'GIT_OUTCOME_UNKNOWN',
  createdAt: new Date(),
  updatedAt: new Date(),
  dispatchToken: 'secret-dispatch',
  workerId: 'internal-worker',
  repositoryKey: 'internal-repo',
  canonicalCommonDir: '/private/repo/.git',
  worktreeIdentity: '/private/repo',
};
function fixture(principal: AuthPrincipal | undefined = account) {
  const get = vi.fn(async (owner: string, op: string, project: string) =>
    owner === stored.ownerScope && op === operationId && project === projectId ? stored : undefined,
  );
  const projects = {
    get: vi.fn(() => {
      throw new Error('Query must not touch live project/Git');
    }),
  };
  const service = new GitService(projects as never, {} as never, undefined, { get } as never);
  const app = express();
  app.use((_request, response, next) => {
    response.locals.authPrincipal = principal;
    next();
  });
  app.use('/projects/:id/git', createGitRouter(service));
  app.use(
    (
      error: { statusCode?: number; status?: number; code?: string; message?: string },
      _request: express.Request,
      response: express.Response,
      _next: express.NextFunction,
    ) => {
      response
        .status(error instanceof ZodError ? 400 : (error.statusCode ?? error.status ?? 500))
        .json({ code: error.code, message: error.message });
    },
  );
  return { app, service, get, projects };
}
const url = `/projects/${projectId}/git/commit-operations/${operationId}`;
describe('Git DB-only authenticated operation query', () => {
  it('returns original state without live project/Git probes or internal executor fields', async () => {
    const f = fixture();
    const response = await request(f.app).get(url);
    expect(response.status).toBe(200);
    expect(response.body.data).toMatchObject({
      operationId,
      projectId,
      phase: 'UNKNOWN',
      scope: 'account:original',
      payload: stored.payloadJson,
    });
    for (const key of [
      'ownerScope',
      'dispatchToken',
      'workerId',
      'repositoryKey',
      'canonicalCommonDir',
      'worktreeIdentity',
    ])
      expect(response.body.data).not.toHaveProperty(key);
    expect(f.get).toHaveBeenCalledExactlyOnceWith('account:original', operationId, projectId);
    expect(f.projects.get).not.toHaveBeenCalled();
  });
  it('same account new session can recover, but other account and token cannot', async () => {
    expect(
      (await request(fixture({ ...account, sessionId: 'new-session' }).app).get(url)).status,
    ).toBe(200);
    for (const principal of [
      { ...account, accountId: 'other' },
      { kind: 'api_token', tokenId: 'original', role: 'ADMIN' },
    ] as AuthPrincipal[]) {
      const response = await request(fixture(principal).app).get(url);
      expect(response.status).toBe(404);
      expect(response.body.code).toBe('GIT_OPERATION_NOT_FOUND');
    }
  });
  it('missing auth rejected before database read', async () => {
    const f = fixture();
    await expect(
      f.service.commitOperation(projectId, operationId, undefined),
    ).rejects.toMatchObject({ code: 'AUTH_REQUIRED' });
    expect(f.get).not.toHaveBeenCalled();
  });
  it('project mismatch and nonexistent operation share non-execution-neutral 404', async () => {
    const f = fixture();
    for (const other of [
      url.replace(projectId, 'cccccccc-cccc-4ccc-8ccc-cccccccccccc'),
      url.replace(operationId, 'dddddddd-dddd-4ddd-8ddd-dddddddddddd'),
    ]) {
      const response = await request(f.app).get(other);
      expect(response.status).toBe(404);
      expect(response.body.message).toContain('不证明提交未执行');
    }
  });
  it('normalizes valid uppercase UUID and rejects malformed UUID before read', async () => {
    const f = fixture();
    expect(
      (
        await request(f.app).get(
          url
            .toUpperCase()
            .replace('/PROJECTS/', '/projects/')
            .replace('/GIT/COMMIT-OPERATIONS/', '/git/commit-operations/'),
        )
      ).status,
    ).toBe(200);
    f.get.mockClear();
    expect((await request(f.app).get(url.replace(operationId, 'not-an-operation'))).status).toBe(
      400,
    );
    expect(f.get).not.toHaveBeenCalled();
  });
  it('missing repository adapter fails closed without synthesizing absence', async () => {
    const service = new GitService({} as never, {} as never);
    await expect(service.commitOperation(projectId, operationId, account)).rejects.toMatchObject({
      code: 'GIT_OPERATION_QUERY_UNAVAILABLE',
    });
  });
});
