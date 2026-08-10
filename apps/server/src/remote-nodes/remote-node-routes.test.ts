import { createPgliteDatabase, RemoteNodeRepository, type DatabaseClient } from '@agenthub/db';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';

import { createApp } from '../app.js';
import { RemoteNodeService } from './remote-node-service.js';

describe('Remote Node REST', () => {
  let database: DatabaseClient;
  let service: RemoteNodeService;

  beforeAll(async () => {
    database = await createPgliteDatabase({ dataDir: 'memory://' });
    service = new RemoteNodeService(new RemoteNodeRepository(database.db));
  });

  afterAll(async () => {
    await database.close();
  });

  it('注册码明文只在创建响应出现，根目录授权被拒绝', async () => {
    const app = createApp({ remoteNodes: service });
    const created = await request(app)
      .post('/api/v1/remote-nodes/registration-tokens')
      .send({
        name: '开发工作站',
        allowedRoots: ['/srv/projects'],
        expiresInMinutes: 10,
      });
    expect(created.status).toBe(201);
    expect(created.body.data).toMatchObject({
      name: '开发工作站',
      allowedRoots: ['/srv/projects'],
    });
    expect(created.body.data.token).toMatch(/^ahrn_/);

    const listed = await request(app).get('/api/v1/remote-nodes');
    expect(listed.status).toBe(200);
    expect(listed.body.data).toEqual([]);
    expect(JSON.stringify(listed.body)).not.toContain(created.body.data.token);

    const rejected = await request(app)
      .post('/api/v1/remote-nodes/registration-tokens')
      .send({ name: '过宽', allowedRoots: ['/'] });
    expect(rejected.status).toBe(400);
    expect(rejected.body.error.code).toBe('REMOTE_NODE_ROOT_TOO_BROAD');
  });
});
