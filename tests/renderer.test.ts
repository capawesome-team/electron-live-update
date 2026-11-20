import { afterEach, describe, expect, it } from 'vitest';

import { ErrorCode, LiveUpdate } from '../src/renderer';
import {
  IPC_GLOBAL_KEY,
  type IpcMethod,
  type IpcResult,
  type LiveUpdateBridge,
} from '../src/shared/ipc';

describe('LiveUpdate', () => {
  afterEach(() => {
    delete (globalThis as Record<string, unknown>)[IPC_GLOBAL_KEY];
  });

  it('keeps the code of an error across the IPC bridge', async () => {
    const results: Partial<Record<IpcMethod, IpcResult>> = {
      deleteBundle: {
        error: { code: ErrorCode.BundleNotFound, message: 'bundle not found.' },
        ok: false,
      },
      downloadBundle: {
        error: { message: 'Checksum mismatch.' },
        ok: false,
      },
    };
    const bridge: LiveUpdateBridge = {
      addEventListener: () => () => undefined,
      invoke: async method => results[method] as IpcResult,
    };
    (globalThis as Record<string, unknown>)[IPC_GLOBAL_KEY] = bridge;
    await expect(
      LiveUpdate.deleteBundle({ bundleId: '1.0.0' }),
    ).rejects.toMatchObject({ code: ErrorCode.BundleNotFound });
    await expect(
      LiveUpdate.downloadBundle({ bundleId: '1.0.0', url: 'https://x' }),
    ).rejects.toMatchObject({ code: undefined });
  });
});
