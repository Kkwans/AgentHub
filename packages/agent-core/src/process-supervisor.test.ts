import { access, mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { runProcess, spawnSupervisedProcess } from './process-supervisor.js';
import type { ProcessSupervisorError } from './process-supervisor.js';
import { redactSecrets } from './redaction.js';

describe('Process Supervisor', () => {
  it('拒绝非绝对 executable', () => {
    expect(() => spawnSupervisedProcess({ executable: 'node', args: [] })).toThrowError(
      expect.objectContaining<Partial<ProcessSupervisorError>>({ code: 'EXECUTABLE_NOT_ABSOLUTE' }),
    );
  });

  it('使用 argv 与 shell:false，不执行 shell 元字符', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'agenthub-process-'));
    const marker = join(directory, 'must-not-exist');
    const hostile = `$(touch ${marker})`;

    const result = await runProcess({
      executable: process.execPath,
      args: ['-e', 'process.stdout.write(process.argv[1])', hostile],
      cwd: directory,
    });

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toBe(hostile);
    await expect(access(marker)).rejects.toThrow();
  });

  it('限制输出并对 secret 脱敏', async () => {
    const secret = 'super-secret-value';
    const result = await runProcess({
      executable: process.execPath,
      args: [
        '-e',
        `process.stdout.write('OPENAI_API_KEY=${secret}\\n' + 'x'.repeat(200)); process.stderr.write('Authorization: Bearer ${secret}')`,
      ],
      maxOutputBytes: 80,
      redactValues: [secret],
    });

    expect(result.truncated).toBe(true);
    expect(`${result.stdout}${result.stderr}`).not.toContain(secret);
    expect(result.stdout).toContain('OPENAI_API_KEY=[REDACTED]');
  });

  it('timeout 后执行 TERM 并报告取消', async () => {
    const result = await runProcess({
      executable: process.execPath,
      args: ['-e', 'setInterval(() => {}, 1000)'],
      timeoutMs: 30,
      cancelGraceMs: 50,
    });

    expect(result.timedOut).toBe(true);
    expect(result.canceled).toBe(true);
    expect(result.signal).toMatch(/SIGTERM|SIGKILL/);
  });

  it('显式 cancel 会先调用 protocol cancel', async () => {
    const processHandle = spawnSupervisedProcess({
      executable: process.execPath,
      args: ['-e', 'setInterval(() => {}, 1000)'],
      protocolCancelGraceMs: 10,
      cancelGraceMs: 50,
    });
    const calls: string[] = [];
    const result = await processHandle.cancel(async () => {
      calls.push('protocol');
    });

    expect(calls).toEqual(['protocol']);
    expect(result.canceled).toBe(true);
  });
});

describe('日志脱敏', () => {
  it('遮蔽常见 header、环境变量和 JSON secret', () => {
    const value = [
      'OPENAI_API_KEY=sk-test-value',
      'Authorization: Bearer bearer-value',
      '{"token":"json-token"}',
    ].join('\n');

    const redacted = redactSecrets(value);
    expect(redacted).not.toMatch(/sk-test-value|bearer-value|json-token/);
    expect(redacted.match(/\[REDACTED\]/g)).toHaveLength(3);
  });
});
