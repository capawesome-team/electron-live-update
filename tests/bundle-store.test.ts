import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { BundleStore, assertValidBundleId } from '../src/engine/bundle-store';
import { ErrorCode, LiveUpdateError } from '../src/engine/errors';

import { createTemporaryDirectory, removeDirectory } from './helpers';

describe('assertValidBundleId', () => {
  it('accepts regular bundle identifiers', () => {
    expect(() => assertValidBundleId('1.0.0')).not.toThrow();
    expect(() => assertValidBundleId('my-bundle_2')).not.toThrow();
  });

  it('rejects an empty bundle identifier', () => {
    expect(() => assertValidBundleId('')).toThrowError(
      expect.objectContaining({ code: ErrorCode.BundleIdMissing }),
    );
  });

  it('rejects the reserved bundle identifier', () => {
    expect(() => assertValidBundleId('public')).toThrowError(
      expect.objectContaining({ code: ErrorCode.BundleIdInvalid }),
    );
  });

  it('rejects bundle identifiers with path separators or traversal', () => {
    for (const bundleId of ['..', '.', 'a/b', 'a\\b', 'a\0b']) {
      expect(() => assertValidBundleId(bundleId)).toThrowError(LiveUpdateError);
    }
  });
});

describe('BundleStore', () => {
  let dataDirectory: string;
  let store: BundleStore;

  beforeEach(async () => {
    dataDirectory = await createTemporaryDirectory();
    store = new BundleStore(dataDirectory);
    await store.initialize();
  });

  afterEach(async () => {
    await removeDirectory(dataDirectory);
  });

  async function stageBundle(content = 'hello'): Promise<string> {
    const staging = await store.createStagingDirectory();
    const bundleDirectory = join(staging, 'bundle');
    await mkdir(bundleDirectory);
    await writeFile(join(bundleDirectory, 'index.html'), content);
    return bundleDirectory;
  }

  it('installs a bundle atomically and lists it', async () => {
    const source = await stageBundle();
    await store.add('1.0.0', source);
    expect(await store.has('1.0.0')).toBe(true);
    expect(await store.list()).toEqual(['1.0.0']);
  });

  it('rejects adding a bundle that already exists', async () => {
    await store.add('1.0.0', await stageBundle());
    await expect(store.add('1.0.0', await stageBundle())).rejects.toMatchObject(
      {
        code: ErrorCode.BundleAlreadyExists,
        message: 'bundle already exists.',
      },
    );
  });

  it('deletes a bundle', async () => {
    await store.add('1.0.0', await stageBundle());
    await store.delete('1.0.0');
    expect(await store.has('1.0.0')).toBe(false);
    expect(await store.list()).toEqual([]);
  });

  it('rejects deleting a bundle that does not exist', async () => {
    await expect(store.delete('missing')).rejects.toMatchObject({
      code: ErrorCode.BundleNotFound,
      message: 'bundle not found.',
    });
  });

  it('clears leftover staging directories on initialize', async () => {
    const staging = await store.createStagingDirectory();
    await writeFile(join(staging, 'leftover.zip'), 'data');
    const secondStore = new BundleStore(dataDirectory);
    await secondStore.initialize();
    await expect(store.has('leftover.zip')).resolves.toBe(false);
    const freshStaging = await secondStore.createStagingDirectory();
    expect(freshStaging).not.toBe(staging);
  });
});
