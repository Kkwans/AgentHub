import { describe, expect, it, vi } from 'vitest';
import {
  AgentAdmissionCoordinator,
  type AgentAdmissionCheckpoint,
} from './agent-admission-coordinator.js';

function deferred<T = void>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

describe('unwired process-local Agent admission coordinator', () => {
  it('serializes same-Agent short sections in invocation order', async () => {
    const coordinator = new AgentAdmissionCoordinator(() => undefined);
    const entered = deferred();
    const release = deferred();
    const calls: string[] = [];
    const first = coordinator.run('a', async () => {
      calls.push('first');
      entered.resolve();
      await release.promise;
      calls.push('first-end');
      return 1;
    });
    const second = coordinator.run('a', () => {
      calls.push('second');
      return 2;
    });
    const third = coordinator.run('a', () => {
      calls.push('third');
      return 3;
    });
    await entered.promise;
    expect(calls).toEqual(['first']);
    release.resolve();
    expect(await Promise.all([first, second, third])).toEqual([1, 2, 3]);
    expect(calls).toEqual(['first', 'first-end', 'second', 'third']);
  });
  it('different Agents do not wait for each other', async () => {
    const coordinator = new AgentAdmissionCoordinator(() => undefined);
    const release = deferred();
    const entered = deferred();
    const first = coordinator.run('a', async () => {
      entered.resolve();
      await release.promise;
    });
    await entered.promise;
    await expect(coordinator.run('b', () => 'independent')).resolves.toBe('independent');
    release.resolve();
    await first;
  });
  it.each(['sync', 'async'])(
    '%s failure reaches caller and does not poison the queue',
    async (kind) => {
      const coordinator = new AgentAdmissionCoordinator(() => undefined);
      const failure = new Error('expected');
      const first = coordinator.run('a', () => {
        if (kind === 'sync') throw failure;
        return Promise.reject(failure);
      });
      const observed = expect(first).rejects.toBe(failure);
      const second = coordinator.run('a', () => 'later');
      await observed;
      await expect(second).resolves.toBe('later');
      await expect(coordinator.run('a', () => 'fresh')).resolves.toBe('fresh');
    },
  );
  it('disable-first serial order prevents a subsequent admission in the supplied state contract', async () => {
    const coordinator = new AgentAdmissionCoordinator(() => undefined);
    let enabled = true;
    const release = deferred();
    const entered = deferred();
    const provider = vi.fn();
    const disable = coordinator.run('a', async ({ assertRuntimeHeld }) => {
      entered.resolve();
      await release.promise;
      assertRuntimeHeld();
      enabled = false;
    });
    const admission = coordinator.run('a', () => {
      if (!enabled) throw new Error('disabled');
      return true;
    });
    const observed = expect(admission.then(() => provider())).rejects.toThrow('disabled');
    await entered.promise;
    release.resolve();
    await disable;
    await observed;
    expect(provider).not.toHaveBeenCalled();
  });
  it('admit-first returns before a simulated provider lifetime; disable need not await that lifetime', async () => {
    const coordinator = new AgentAdmissionCoordinator(() => undefined);
    let enabled = true;
    const providerFinished = deferred();
    const admitted = await coordinator.run('a', () => ({ admitted: enabled }));
    expect(admitted.admitted).toBe(true);
    // Deliberately outside the short section. No real provider is started.
    let finished = false;
    const lifecycle = providerFinished.promise.then(() => {
      finished = true;
    });
    await coordinator.run('a', () => {
      enabled = false;
    });
    expect(enabled).toBe(false);
    expect(finished).toBe(false);
    providerFinished.resolve();
    await lifecycle;
  });
  it('runtime revocation while queued rejects before invoking the queued callback', async () => {
    let held = true;
    const revoked = new Error('revoked');
    const coordinator = new AgentAdmissionCoordinator(() => {
      if (!held) throw revoked;
    });
    const release = deferred();
    const entered = deferred();
    const callback = vi.fn();
    const first = coordinator.run('a', async () => {
      entered.resolve();
      await release.promise;
    });
    const second = coordinator.run('a', callback);
    const observed = expect(second).rejects.toBe(revoked);
    await entered.promise;
    held = false;
    release.resolve();
    await first;
    await observed;
    expect(callback).not.toHaveBeenCalled();
    await expect(coordinator.run('b', callback)).rejects.toBe(revoked);
    expect(callback).not.toHaveBeenCalled();
  });
  it('checkpoint rechecks after an awaited read and cannot be reused after the section', async () => {
    let held = true;
    const coordinator = new AgentAdmissionCoordinator(() => {
      if (!held) throw new Error('stopped');
    });
    const read = deferred();
    const entered = deferred();
    const commit = vi.fn();
    let saved!: AgentAdmissionCheckpoint;
    const operation = coordinator.run('a', async (checkpoint) => {
      saved = checkpoint;
      entered.resolve();
      await read.promise;
      checkpoint.assertRuntimeHeld();
      commit();
    });
    const observed = expect(operation).rejects.toThrow('stopped');
    await entered.promise;
    held = false;
    read.resolve();
    await observed;
    expect(commit).not.toHaveBeenCalled();
    held = true;
    expect(() => saved.assertRuntimeHeld()).toThrow('准入检查上下文已结束');
  });
  it('nested same-Agent or cross-Agent waits reject instead of creating queue deadlocks', async () => {
    const coordinator = new AgentAdmissionCoordinator(() => undefined);
    await coordinator.run('a', async () => {
      await expect(coordinator.run('a', () => undefined)).rejects.toMatchObject({
        code: 'AGENT_ADMISSION_REENTRANT',
      });
      await expect(coordinator.run('b', () => undefined)).rejects.toMatchObject({
        code: 'AGENT_ADMISSION_REENTRANT',
      });
    });
    await expect(coordinator.run('a', () => 1)).resolves.toBe(1);
  });
  it('an inherited async context can start independent admission after its original section ends', async () => {
    const coordinator = new AgentAdmissionCoordinator(() => undefined);
    const releaseDetached = deferred();
    let detached!: Promise<string>;
    await coordinator.run('a', async () => {
      // The continuation inherits the active section's ALS object, but is not
      // itself part of that short section or its completion promise.
      detached = releaseDetached.promise.then(() => coordinator.run('a', () => 'new admission'));
      await expect(coordinator.run('a', () => 'nested')).rejects.toMatchObject({
        code: 'AGENT_ADMISSION_REENTRANT',
      });
    });
    releaseDetached.resolve();
    await expect(detached).resolves.toBe('new admission');
  });
  it('successor tail remains installed while an earlier completed operation cleans up', async () => {
    const coordinator = new AgentAdmissionCoordinator(() => undefined);
    const release = deferred();
    const entered = deferred();
    const calls: string[] = [];
    const first = coordinator.run('a', () => calls.push('first'));
    const second = coordinator.run('a', async () => {
      entered.resolve();
      await release.promise;
      calls.push('second');
    });
    await first;
    await entered.promise;
    const third = coordinator.run('a', () => calls.push('third'));
    await Promise.resolve();
    expect(calls).toEqual(['first']);
    release.resolve();
    await Promise.all([second, third]);
    expect(calls).toEqual(['first', 'second', 'third']);
  });
  it('rejects empty Agent keys before callbacks', async () => {
    const assert = vi.fn();
    const callback = vi.fn();
    const coordinator = new AgentAdmissionCoordinator(assert);
    await expect(coordinator.run(' ', callback)).rejects.toMatchObject({
      code: 'AGENT_ADMISSION_ID_REQUIRED',
    });
    expect(assert).not.toHaveBeenCalled();
    expect(callback).not.toHaveBeenCalled();
  });
});
