import { expect, it, vi } from 'vitest';
import { createShutdownHandler } from './shutdown-handler.js';

it('exits only after confirmed cleanup and ignores repeated stop signals', async () => {
  let finish!: () => void;
  const close = vi.fn(
    () =>
      new Promise<void>((resolve) => {
        finish = resolve;
      }),
  );
  const stopped = vi.fn(),
    unconfirmed = vi.fn();
  const signal = createShutdownHandler(close, stopped, unconfirmed);
  signal();
  signal();
  await vi.waitFor(() => expect(close).toHaveBeenCalledOnce());
  expect(stopped).not.toHaveBeenCalled();
  finish();
  await vi.waitFor(() => expect(stopped).toHaveBeenCalledOnce());
  expect(unconfirmed).not.toHaveBeenCalled();
});
it('never exits on failed cleanup and preserves the unconfirmed state across repeated signals', async () => {
  const close = vi.fn(async () => {
    throw new Error('cleanup incomplete');
  });
  const stopped = vi.fn(),
    unconfirmed = vi.fn();
  const signal = createShutdownHandler(close, stopped, unconfirmed);
  signal();
  await vi.waitFor(() => expect(unconfirmed).toHaveBeenCalledOnce());
  signal();
  expect(close).toHaveBeenCalledOnce();
  expect(stopped).not.toHaveBeenCalled();
});
