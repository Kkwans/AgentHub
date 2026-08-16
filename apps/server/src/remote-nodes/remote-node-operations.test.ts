import { describe, expect, it } from 'vitest';

import { RemoteNodeOperations } from './remote-node-operations.js';

describe('RemoteNodeOperations 文件边界', () => {
  it('将 Node 授权根映射为目录并使用相对路径转发 fs.list', async () => {
    const requests: Array<{ command: string; payload: Record<string, unknown> }> = [];
    const operations = new RemoteNodeOperations(
      {
        getByTargetId: async () => ({
          id: 'node-1',
          targetId: 'target-1',
          allowedRootsJson: ['/srv/projects'],
          revokedAt: null,
        }),
      } as never,
      {
        request: async (_nodeId: string, command: string, payload: Record<string, unknown>) => {
          requests.push({ command, payload });
          return {
            entries: [
              {
                name: 'demo',
                path: 'demo',
                type: 'DIRECTORY',
                size: 0,
                modifiedAt: new Date(0).toISOString(),
              },
            ],
          };
        },
      } as never,
    );

    const [root] = await operations.listRoots('target-1');
    expect(root).toMatchObject({
      rootId: 'target-1:/srv/projects',
      source: 'REMOTE_NODE',
      path: '/srv/projects',
    });
    const listing = await operations.listDirectories(
      'target-1',
      root?.rootId,
      '/srv/projects/demo',
    );
    expect(listing).toMatchObject({ path: '/srv/projects/demo' });
    expect(listing.entries[0]).toMatchObject({
      name: 'demo',
      path: '/srv/projects/demo/demo',
      accessible: true,
    });
    expect(requests).toEqual([
      {
        command: 'fs.list',
        payload: { rootPath: '/srv/projects', requestedPath: 'demo', depth: 0 },
      },
    ]);
  });

  it('拒绝超出 Remote Node 授权根的目录请求', async () => {
    const operations = new RemoteNodeOperations(
      {
        getByTargetId: async () => ({
          id: 'node-1',
          targetId: 'target-1',
          allowedRootsJson: ['/srv/projects'],
          revokedAt: null,
        }),
      } as never,
      { request: async () => ({ entries: [] }) } as never,
    );

    await expect(
      operations.listDirectories('target-1', 'target-1:/srv/projects', '/etc'),
    ).rejects.toMatchObject({ code: 'PATH_TRAVERSAL' });
  });

  it('从远程授权根的工程标记生成候选 Project', async () => {
    const operations = new RemoteNodeOperations(
      {
        getByTargetId: async () => ({
          id: 'node-1',
          targetId: 'target-1',
          allowedRootsJson: ['/srv/projects'],
          revokedAt: null,
        }),
      } as never,
      {
        request: async () => ({
          entries: [
            {
              name: 'package.json',
              path: 'package.json',
              type: 'FILE',
              size: 2,
              modifiedAt: new Date(0).toISOString(),
            },
            {
              name: 'notes.txt',
              path: 'notes.txt',
              type: 'FILE',
              size: 1,
              modifiedAt: new Date(0).toISOString(),
            },
          ],
        }),
      } as never,
    );

    await expect(
      operations.discoverProjects('target-1', 'target-1:/srv/projects'),
    ).resolves.toEqual([
      expect.objectContaining({
        name: 'projects',
        rootPath: '/srv/projects',
        relativePath: '.',
        markers: ['package.json'],
        packageManagers: [],
        git: false,
        readable: true,
      }),
    ]);
  });
});
