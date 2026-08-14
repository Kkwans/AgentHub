import { mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { FilesystemService } from './filesystem-service.js';

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

describe('FilesystemService', () => {
  it('keeps directory browsing inside configured roots and discovers projects', async () => {
    const root = await mkdtemp(join(tmpdir(), 'agenthub-v06-fs-'));
    temporaryDirectories.push(root);
    const project = join(root, 'demo');
    const outside = await mkdtemp(join(tmpdir(), 'agenthub-v06-outside-'));
    temporaryDirectories.push(outside);
    await mkdir(join(project, '.git'), { recursive: true });
    await writeFile(join(project, 'package.json'), '{}');
    await symlink(outside, join(root, 'escape'));
    const service = new FilesystemService(
      { get: async () => ({ id: 'target-1', kind: 'LOCAL_HOST' }) } as never,
      [root],
    );

    const roots = await service.listRoots('target-1');
    expect(roots).toHaveLength(1);
    const listing = await service.listDirectories('target-1', roots[0]?.rootId, root);
    expect(listing.entries.find((entry) => entry.name === 'escape')).toMatchObject({
      type: 'SYMLINK',
      accessible: false,
    });
    await expect(
      service.listDirectories('target-1', roots[0]?.rootId, outside),
    ).rejects.toMatchObject({
      code: 'PATH_TRAVERSAL',
    });
    await expect(
      service.listDirectories('target-1', roots[0]?.rootId, '../outside'),
    ).rejects.toMatchObject({
      code: 'PATH_TRAVERSAL',
    });

    const candidates = await service.discoverProjects('target-1', roots[0]?.rootId);
    expect(candidates).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          name: 'demo',
          git: true,
          markers: expect.arrayContaining(['.git']),
        }),
      ]),
    );
  });

  it('does not expose Docker mounts outside the configured workspace allow-list', async () => {
    const root = await mkdtemp(join(tmpdir(), 'agenthub-v06-docker-root-'));
    const outside = await mkdtemp(join(tmpdir(), 'agenthub-v06-docker-outside-'));
    temporaryDirectories.push(root, outside);
    const service = new FilesystemService(
      {
        get: async () => ({
          id: 'target-2',
          kind: 'DOCKER_CONTAINER',
          workspaceMappingsJson: [{ hostRoot: outside, containerRoot: '/workspace' }],
        }),
      } as never,
      [root],
    );

    await expect(service.listRoots('target-2')).resolves.toEqual([]);
  });
});
