import { rename } from 'node:fs/promises';

const RETRYABLE_ERROR_CODES = new Set(['EACCES', 'EBUSY', 'EPERM']);

/**
 * Delays between retry attempts, roughly one second in total.
 *
 * Exported for tests so they can exhaust the retries deterministically.
 */
export const RETRY_DELAYS_MS = [20, 40, 80, 160, 300, 400];

/**
 * Run a file system operation, retrying briefly when it fails because
 * another process holds an open handle on the target.
 *
 * On Windows, replacing, renaming or deleting a file fails with EPERM,
 * EACCES or EBUSY while ANY other handle is open on it. Antivirus
 * scanners and external readers do this routinely and release the
 * handle within milliseconds, so the operation is retried with
 * increasing delays (the same remedy graceful-fs applies) before the
 * error is rethrown. On POSIX systems these codes indicate persistent
 * permission problems, which surface unchanged after the bounded
 * retries.
 */
export async function retryOnFileLock<T>(
  operation: () => Promise<T>,
): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    try {
      return await operation();
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (
        attempt >= RETRY_DELAYS_MS.length ||
        code === undefined ||
        !RETRYABLE_ERROR_CODES.has(code)
      ) {
        throw error;
      }
      await new Promise(resolve =>
        setTimeout(resolve, RETRY_DELAYS_MS[attempt]),
      );
    }
  }
}

/**
 * `rename` with bounded retries for transient file locks.
 */
export function renameWithRetry(
  oldPath: string,
  newPath: string,
): Promise<void> {
  return retryOnFileLock(() => rename(oldPath, newPath));
}
