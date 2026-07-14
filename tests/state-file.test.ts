import type * as fsPromises from 'node:fs/promises';
import { readFile, rename } from 'node:fs/promises';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { RETRY_DELAYS_MS } from '../src/engine/fs-retry';
import { StateFile } from '../src/engine/state-file';

import { createTemporaryDirectory, removeDirectory } from './helpers';

// Simulates the Windows file-lock failure mode: `rename` onto a
// destination fails with EPERM/EACCES/EBUSY while another process
// (antivirus, an external reader) holds an open handle on it.
const renameFailures = vi.hoisted(() => ({ code: 'EPERM', remaining: 0 }));

vi.mock('node:fs/promises', async importOriginal => {
  const actual = await importOriginal<typeof fsPromises>();
  return {
    ...actual,
    rename: vi.fn(async (oldPath: string, newPath: string) => {
      if (renameFailures.remaining > 0) {
        renameFailures.remaining -= 1;
        const error = new Error(
          `${renameFailures.code}: operation not permitted, rename '${oldPath}' -> '${newPath}'`,
        ) as NodeJS.ErrnoException;
        error.code = renameFailures.code;
        throw error;
      }
      return actual.rename(oldPath, newPath);
    }),
  };
});

const MAX_RENAME_ATTEMPTS = RETRY_DELAYS_MS.length + 1;

async function readPersistedState(
  directory: string,
): Promise<Record<string, unknown>> {
  return JSON.parse(
    await readFile(join(directory, 'state.json'), 'utf8'),
  ) as Record<string, unknown>;
}

describe('StateFile', () => {
  let directory: string;
  let stateFile: StateFile;

  beforeEach(async () => {
    renameFailures.code = 'EPERM';
    renameFailures.remaining = 0;
    vi.mocked(rename).mockClear();
    directory = await createTemporaryDirectory();
    stateFile = new StateFile(directory);
    await stateFile.load();
  });

  afterEach(async () => {
    await removeDirectory(directory);
  });

  it('persists updates atomically', async () => {
    await stateFile.update(state => {
      state.currentBundleId = '1.0.0';
    });
    const persisted = await readPersistedState(directory);
    expect(persisted.currentBundleId).toBe('1.0.0');
  });

  it('retries the rename while the destination is transiently locked', async () => {
    renameFailures.remaining = 2;
    await stateFile.update(state => {
      state.currentBundleId = '2.0.0';
    });
    expect(rename).toHaveBeenCalledTimes(3);
    const persisted = await readPersistedState(directory);
    expect(persisted.currentBundleId).toBe('2.0.0');
  });

  it('does not retry non-lock errors', async () => {
    renameFailures.code = 'ENOENT';
    renameFailures.remaining = 1;
    await expect(
      stateFile.update(state => {
        state.currentBundleId = '2.0.0';
      }),
    ).rejects.toMatchObject({ code: 'ENOENT' });
    expect(rename).toHaveBeenCalledTimes(1);
  });

  it('rethrows a persistent lock and recovers on the next update', async () => {
    renameFailures.remaining = MAX_RENAME_ATTEMPTS;
    await expect(
      stateFile.update(state => {
        state.currentBundleId = '2.0.0';
      }),
    ).rejects.toMatchObject({ code: 'EPERM' });
    expect(rename).toHaveBeenCalledTimes(MAX_RENAME_ATTEMPTS);
    // The failed write must not poison the queue: the next update
    // persists the then-latest state, including the earlier mutation.
    await stateFile.update(state => {
      state.nextBundleId = '3.0.0';
    });
    const persisted = await readPersistedState(directory);
    expect(persisted.currentBundleId).toBe('2.0.0');
    expect(persisted.nextBundleId).toBe('3.0.0');
  });
});
