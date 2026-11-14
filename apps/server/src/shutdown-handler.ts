/** Failed cleanup must not become a successful process exit that releases healthy ownership. */
export function createShutdownHandler(
  close: () => Promise<void>,
  stopped: () => void,
  unconfirmed: () => void,
): () => void {
  let started = false;
  return () => {
    if (started) return;
    started = true;
    try {
      void close().then(stopped, unconfirmed);
    } catch {
      unconfirmed();
    }
  };
}
