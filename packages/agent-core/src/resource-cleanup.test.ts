import { expect, it } from 'vitest';
import { ResourceCleanupUnconfirmedError, isResourceCleanupUnconfirmed } from './contracts.js';

it('resource cleanup contract is explicit and preserves cause only internally', () => {
  const cause = new Error('private provider output');
  const error = new ResourceCleanupUnconfirmedError({ cause });
  expect(isResourceCleanupUnconfirmed(error)).toBe(true);
  expect(error.code).toBe('RESOURCE_CLEANUP_UNCONFIRMED');
  expect(error.message).not.toContain('private');
  expect(error.cause).toBe(cause);
  expect(isResourceCleanupUnconfirmed(new Error('RESOURCE_CLEANUP_UNCONFIRMED'))).toBe(false);
  expect(isResourceCleanupUnconfirmed({ code: 'RESOURCE_CLEANUP_UNCONFIRMED' })).toBe(false);
  expect(isResourceCleanupUnconfirmed(new Error('wrapped', { cause: error }))).toBe(false);
});
