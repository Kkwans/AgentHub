import { EventEmitter } from 'node:events';
import type * as Http from 'node:http';
import { request } from 'node:http';
import { afterEach, expect, it, vi } from 'vitest';
import { DockerSocketEngineClient } from '../apps/server/src/discovery/docker-engine-client.js';
import { infrastructureEnvironment } from './e2e-real/infrastructure-isolation.js';

vi.mock('node:http', async (importOriginal) => ({
  ...(await importOriginal<typeof Http>()),
  request: vi.fn(() => {
    throw new Error('Unexpected unconfigured HTTP request');
  }),
}));
afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetAllMocks();
});

it.each(['empty-response', 'missing-socket'] as const)(
  'real Docker client uses only the controlled socket: %s',
  async (outcome) => {
    const env = infrastructureEnvironment('/tmp/isolated-docker-test', '/tmp/web');
    vi.stubEnv('DOCKER_SOCKET_PATH', env.DOCKER_SOCKET_PATH!);
    vi.stubEnv('DOCKER_ENGINE_API_VERSION', 'v1.43');
    const mockRequest = (_options: unknown, callback: (response: unknown) => void) => {
      const emitter = new EventEmitter();
      return Object.assign(emitter, {
        end: () => {
          if (outcome === 'missing-socket') {
            emitter.emit(
              'error',
              Object.assign(new Error('synthetic missing socket'), { code: 'ENOENT' }),
            );
            return;
          }
          const response = Object.assign(new EventEmitter(), { statusCode: 200 });
          callback(response);
          response.emit('data', Buffer.from('[]'));
          response.emit('end');
        },
      });
    };
    vi.mocked(request).mockImplementation(mockRequest as unknown as typeof request);
    const client = new DockerSocketEngineClient();
    if (outcome === 'empty-response')
      await expect(client.listContainers(true)).resolves.toEqual([]);
    else
      await expect(client.listContainers(true)).rejects.toMatchObject({
        code: 'DOCKER_ENGINE_UNAVAILABLE',
      });
    expect(request).toHaveBeenCalledTimes(1);
    expect(request).toHaveBeenCalledWith(
      {
        socketPath: '/tmp/isolated-docker-test/absent-docker.sock',
        path: '/v1.43/containers/json?all=1',
        method: 'GET',
      },
      expect.any(Function),
    );
  },
);
