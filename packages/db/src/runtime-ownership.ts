/** One PostgreSQL session owns the runtime for the lifetime of the service.
 * Not a lease, external-process fence, or permission to replay UNKNOWN work.
 */
export interface RuntimeOwnershipGuard {
  assertHeld(): void;
  onLost(listener: () => void): () => void;
  release(): Promise<void>;
}
export class RuntimeOwnershipError extends Error {
  constructor(
    readonly code:
      | 'RUNTIME_OWNERSHIP_HELD'
      | 'RUNTIME_OWNERSHIP_LOST'
      | 'RUNTIME_OWNERSHIP_UNAVAILABLE'
      | 'RUNTIME_OWNERSHIP_UNSUPPORTED',
  ) {
    super(
      {
        RUNTIME_OWNERSHIP_HELD: '同一数据库已有 AgentHub 服务运行，请先停止原服务。',
        RUNTIME_OWNERSHIP_LOST: '运行实例数据库归属已失效，服务不能继续执行。',
        RUNTIME_OWNERSHIP_UNAVAILABLE: '无法确认运行实例数据库归属，未启动服务。',
        RUNTIME_OWNERSHIP_UNSUPPORTED: '当前数据库尚未提供安全的运行实例排他能力。',
      }[code],
    );
    this.name = 'RuntimeOwnershipError';
  }
}
export interface OwnershipConnection {
  connect(): Promise<unknown>;
  query(sql: string, values: number[]): Promise<{ rows: Array<{ held: unknown }> }>;
  end(): Promise<unknown>;
  on(event: 'error' | 'end', listener: () => void): unknown;
}
// Stable across deployment paths, DSN aliases and hosts. Advisory locks are database-local.
// Two-int key space is separate from the bigint advisory key space.
export const RUNTIME_OWNERSHIP_KEYS = [0x41485542, 0x52554e31] as const;
export async function acquirePostgresRuntimeOwnership(
  connection: OwnershipConnection,
): Promise<RuntimeOwnershipGuard> {
  let state: 'acquiring' | 'held' | 'lost' | 'released' = 'acquiring';
  let closing: Promise<void> | undefined;
  const listeners = new Set<() => void>();
  const lost = () => {
    if (state === 'lost' || state === 'released') return;
    state = 'lost';
    for (const listener of listeners) {
      // One faulty subscriber must not prevent other admission gates closing.
      try {
        listener();
      } catch {
        /* State remains irrevocably lost. */
      }
    }
    listeners.clear();
  };
  connection.on('error', lost);
  connection.on('end', lost);
  const guard: RuntimeOwnershipGuard = {
    assertHeld() {
      if (state !== 'held') throw new RuntimeOwnershipError('RUNTIME_OWNERSHIP_LOST');
    },
    onLost(listener) {
      if (state === 'lost') listener();
      else if (state !== 'released') listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    release() {
      if (!closing) {
        state = 'released';
        listeners.clear();
        closing = Promise.resolve()
          .then(() => connection.end())
          .then(() => undefined);
      }
      return closing;
    },
  };
  try {
    await connection.connect();
    if (state !== 'acquiring') throw new RuntimeOwnershipError('RUNTIME_OWNERSHIP_LOST');
    const result = await connection.query(
      'SELECT pg_try_advisory_lock($1::integer, $2::integer) AS held',
      [...RUNTIME_OWNERSHIP_KEYS],
    );
    if (state !== 'acquiring') throw new RuntimeOwnershipError('RUNTIME_OWNERSHIP_LOST');
    if (result.rows.length !== 1 || typeof result.rows[0]?.held !== 'boolean')
      throw new RuntimeOwnershipError('RUNTIME_OWNERSHIP_UNAVAILABLE');
    if (!result.rows[0].held) throw new RuntimeOwnershipError('RUNTIME_OWNERSHIP_HELD');
    state = 'held';
    return guard;
  } catch (error) {
    try {
      await guard.release();
    } catch {
      /* Preserve only a sanitized ownership error. */
    }
    throw error instanceof RuntimeOwnershipError
      ? error
      : new RuntimeOwnershipError('RUNTIME_OWNERSHIP_UNAVAILABLE');
  }
}
