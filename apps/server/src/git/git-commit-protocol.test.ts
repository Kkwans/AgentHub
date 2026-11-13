import { expect, it } from 'vitest';
import {
  gitCommitOperationBody,
  gitCommitOperationParams,
  gitCommitOperationPayload,
} from './git-commit-protocol.js';
const id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const body = {
  protocolVersion: 1,
  operationId: id,
  expectedHead: 'b'.repeat(40),
  message: ' change ',
  mode: 'SELECTED',
  paths: ['b.ts', 'A.ts', 'b.ts'],
};
it('规范UUID/SHA/message但保留path顺序、大小写与重复语义', () => {
  const input = gitCommitOperationBody.parse({
    ...body,
    operationId: id.toUpperCase(),
    expectedHead: 'B'.repeat(64),
  });
  expect(input).toMatchObject({
    operationId: id,
    expectedHead: 'b'.repeat(64),
    message: 'change',
    paths: ['b.ts', 'A.ts', 'b.ts'],
  });
  const payload = gitCommitOperationPayload(input);
  input.paths!.push('later.ts');
  expect(payload).toEqual({
    operationKind: 'COMMIT',
    mode: 'SELECTED',
    message: 'change',
    paths: ['b.ts', 'A.ts', 'b.ts'],
  });
  expect(
    gitCommitOperationParams.parse({ id: id.toUpperCase(), operationId: id.toUpperCase() }),
  ).toEqual({ id, operationId: id });
});
it('必须显式operationId/protocol/expectedHead，缺失不能假装unborn或生成新键', () => {
  for (const key of ['operationId', 'protocolVersion', 'expectedHead']) {
    const invalid: Record<string, unknown> = { ...body };
    delete invalid[key];
    expect(gitCommitOperationBody.safeParse(invalid).success).toBe(false);
  }
  expect(gitCommitOperationBody.safeParse({ ...body, expectedHead: null }).success).toBe(true);
  for (const expectedHead of ['', 'abc', 'b'.repeat(41)])
    expect(gitCommitOperationBody.safeParse({ ...body, expectedHead }).success).toBe(false);
});
it('拒绝客户端伪造owner/device/dispatch身份及其他未定义字段', () => {
  for (const key of ['ownerScope', 'targetId', 'repositoryKey', 'dispatchToken', 'workerId'])
    expect(gitCommitOperationBody.safeParse({ ...body, [key]: 'forged' }).success).toBe(false);
});
it('模式无歧义且保留现有消息/路径数量限制', () => {
  expect(gitCommitOperationBody.safeParse({ ...body, mode: 'STAGED' }).success).toBe(false);
  const staged: Record<string, unknown> = { ...body };
  delete staged.paths;
  expect(gitCommitOperationBody.safeParse({ ...staged, mode: 'STAGED' }).success).toBe(true);
  for (const patch of [
    { paths: [] },
    { paths: Array(501).fill('a') },
    { message: ' ' },
    { message: 'a'.repeat(10001) },
    { paths: ['a'.repeat(4097)] },
    { protocolVersion: 2 },
  ])
    expect(gitCommitOperationBody.safeParse({ ...body, ...patch }).success).toBe(false);
});
