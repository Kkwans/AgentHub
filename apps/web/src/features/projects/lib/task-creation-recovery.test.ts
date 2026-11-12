// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest';
import {
  browserCreationScope,
  newCreationOperationId,
  markerKey,
  readRecoveryRecords,
  saveMarker,
  parseRecoveredTask,
  type CreationMarker,
} from './task-creation-recovery';
const projectId = '11111111-1111-4111-8111-111111111111';
const operationId = '55555555-5555-4555-8555-555555555555';
const marker: CreationMarker = {
  version: 1,
  scope: 'local-trusted',
  projectId,
  operationId,
  stage: 'CREATE_PENDING',
};
afterEach(() => {
  localStorage.clear();
  vi.unstubAllGlobals();
});
it('明确身份范围，未知token身份不成为本地信任', () => {
  expect(browserCreationScope('token', null)).toBeNull();
  expect(browserCreationScope(undefined, null)).toBeNull();
  expect(browserCreationScope('local_trusted', null)).toBe('local-trusted');
  expect(browserCreationScope('token', { id: projectId })).toBe(`account:${projectId}`);
});
it('只保存允许的ID元数据，即使调用者对象带有正文变量也不序列化', () => {
  saveMarker(localStorage, {
    ...marker,
    title: 'PRIVATE TITLE',
    description: 'PRIVATE BODY',
    promptVariables: { secret: 'PRIVATE VARIABLE' },
    token: 'PRIVATE TOKEN',
  } as CreationMarker);
  expect(localStorage.getItem(markerKey(marker))).toBe(JSON.stringify(marker));
  expect(readRecoveryRecords(localStorage, marker.scope, projectId)[0]?.marker).toEqual(marker);
  expect(readRecoveryRecords(localStorage, `account:${projectId}`, projectId)).toEqual([]);
});
it.each([
  'broken-json',
  JSON.stringify({ ...marker, version: 2 }),
  JSON.stringify({ ...marker, operationId: 'bad' }),
  JSON.stringify({ ...marker, description: 'should-not-be-here' }),
])('损坏记录保留且明确报告：%s', (value) => {
  localStorage.setItem(markerKey(marker), value);
  expect(readRecoveryRecords(localStorage, marker.scope, projectId)).toEqual([
    { key: markerKey(marker), marker: undefined },
  ]);
  expect(localStorage.getItem(markerKey(marker))).toBe(value);
});
it('恢复结果必须匹配原操作和项目，不能跳转到错误身份', () => {
  const result = {
    operationId,
    projectId,
    taskId: '33333333-3333-4333-8333-333333333333',
    status: 'READY',
    sessionId: null,
  };
  expect(parseRecoveredTask(result, marker)).toEqual(result);
  expect(() => parseRecoveredTask({ ...result, projectId: operationId }, marker)).toThrow();
  expect(() => parseRecoveredTask({ ...result, operationId: projectId }, marker)).toThrow();
  expect(() => parseRecoveredTask({ ...result, sessionId: 'bad' }, marker)).toThrow();
});

it('HTTP LAN没有randomUUID时使用安全随机字节生成UUID，不用不安全随机数', () => {
  const getRandomValues = crypto.getRandomValues.bind(crypto);
  vi.stubGlobal('crypto', { getRandomValues });
  const first = newCreationOperationId();
  expect(first).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  expect(newCreationOperationId()).not.toBe(first);
});
