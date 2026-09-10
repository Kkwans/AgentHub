import { describe, expect, it } from 'vitest';

import { runtimeDisplayName, runtimeImageLabel } from './InfrastructurePage';

describe('Infrastructure runtime presentation', () => {
  it('keeps image digests out of the primary runtime label', () => {
    expect(
      runtimeImageLabel({
        kind: 'DOCKER_CONTAINER',
        image: 'docker.io/library/node:24-alpine@sha256:abcdef',
      }),
    ).toBe('node:24-alpine');
    expect(runtimeImageLabel({ kind: 'LOCAL_HOST' })).toBe('Local Host');
    expect(
      runtimeImageLabel({
        kind: 'DOCKER_CONTAINER',
        image: 'sha256:abcdef0123456789abcdef0123456789',
      }),
    ).toBe('Docker 容器');
  });

  it('does not expose unnamed container digests as display names', () => {
    expect(runtimeDisplayName('sha256:0123456789abcdef0123456789abcdef')).toBe(
      '未命名 Docker 容器',
    );
    expect(runtimeDisplayName('agenthub')).toBe('agenthub');
  });
});
