import { describe, expect, it } from 'vitest';

import { runtimeDisplayName, runtimeImageLabel, runtimeStatusDetail } from './InfrastructurePage';

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

describe('Runtime status detail truth', () => {
  it.each([
    ['READY', '就绪'],
    ['STOPPED', '已停止'],
    ['UNAVAILABLE', '不可用'],
    ['UNSUPPORTED', '不支持'],
    ['BROKEN', '异常'],
    ['UNKNOWN', '状态待确认'],
    ['FUTURE_STATE', '状态待确认'],
  ])('uses known state %s only when diagnostic detail is absent', (state, label) => {
    for (const statusText of [undefined, '', '  ']) {
      expect(
        runtimeStatusDetail({ state, ...(statusText !== undefined ? { statusText } : {}) }),
      ).toBe(label);
    }
  });
  it('preserves provider diagnostic text exactly, even with a known state', () => {
    const statusText = '  Up 2 minutes (health: starting)  ';
    expect(runtimeStatusDetail({ state: 'READY', statusText })).toBe(statusText);
    expect(runtimeStatusDetail({ state: 'UNKNOWN', statusText })).toBe(statusText);
  });
});
