export class TimeoutError extends Error {}

/**
 * Bounds a promise that has no timeout of its own (several third-party HTTP
 * clients, grammy's included, don't apply one by default) so a slow or
 * unreachable external dependency can't hang a caller indefinitely —
 * critical for anything invoked from `onModuleInit`, where hanging blocks
 * the whole app's bootstrap, not just the one feature involved.
 */
export function withTimeout<T>(promise: Promise<T>, timeoutMs: number, label: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout>;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new TimeoutError(`${label} timed out after ${timeoutMs}ms`)), timeoutMs);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}
