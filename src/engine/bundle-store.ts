import { randomUUID } from 'node:crypto';
import { mkdir, readdir, rename, rm, stat } from 'node:fs/promises';
import { join } from 'node:path';

import { ErrorCode, LiveUpdateError } from './errors';

/**
 * The bundle identifier value that is reserved for the built-in bundle.
 */
export const RESERVED_BUNDLE_ID = 'public';

/**
 * Validate a user-provided bundle identifier.
 *
 * Bundle identifiers are used as directory names, so anything that
 * could escape the bundle store directory is rejected.
 */
export function assertValidBundleId(bundleId: string): void {
  if (!bundleId) {
    throw new LiveUpdateError(
      ErrorCode.BundleIdMissing,
      'bundleId must be provided.',
    );
  }
  if (bundleId === RESERVED_BUNDLE_ID) {
    throw new LiveUpdateError(
      ErrorCode.BundleIdInvalid,
      `The bundle identifier '${RESERVED_BUNDLE_ID}' is reserved and cannot be used.`,
    );
  }
  if (
    bundleId === '.' ||
    bundleId === '..' ||
    bundleId.includes('/') ||
    bundleId.includes('\\') ||
    bundleId.includes('\0')
  ) {
    throw new LiveUpdateError(
      ErrorCode.BundleIdInvalid,
      'The bundle identifier contains invalid characters.',
    );
  }
}

/**
 * Stores downloaded bundles as directories under `<dataDirectory>/bundles/<bundleId>`.
 *
 * Bundles are installed with a single atomic rename from a staging
 * directory on the same volume, so a bundle directory either exists
 * completely or not at all.
 */
export class BundleStore {
  private readonly bundlesDirectory: string;
  private readonly stagingDirectory: string;

  constructor(dataDirectory: string) {
    this.bundlesDirectory = join(dataDirectory, 'bundles');
    this.stagingDirectory = join(dataDirectory, 'staging');
  }

  public async initialize(): Promise<void> {
    await mkdir(this.bundlesDirectory, { recursive: true });
    // Leftover staging data from a previous crashed run is garbage.
    await rm(this.stagingDirectory, { recursive: true, force: true });
    await mkdir(this.stagingDirectory, { recursive: true });
  }

  /**
   * Create a fresh staging directory on the same volume as the bundle
   * store so that the final installation is an atomic rename.
   */
  public async createStagingDirectory(): Promise<string> {
    const directory = join(this.stagingDirectory, randomUUID());
    await mkdir(directory, { recursive: true });
    return directory;
  }

  public getPath(bundleId: string): string {
    return join(this.bundlesDirectory, bundleId);
  }

  public async has(bundleId: string): Promise<boolean> {
    try {
      const stats = await stat(this.getPath(bundleId));
      return stats.isDirectory();
    } catch {
      return false;
    }
  }

  public async list(): Promise<string[]> {
    try {
      const entries = await readdir(this.bundlesDirectory, {
        withFileTypes: true,
      });
      return entries
        .filter(entry => entry.isDirectory())
        .map(entry => entry.name)
        .sort();
    } catch {
      return [];
    }
  }

  /**
   * Atomically install a fully prepared bundle directory.
   */
  public async add(bundleId: string, sourceDirectory: string): Promise<void> {
    if (await this.has(bundleId)) {
      throw new LiveUpdateError(
        ErrorCode.BundleAlreadyExists,
        'bundle already exists.',
      );
    }
    await rename(sourceDirectory, this.getPath(bundleId));
  }

  public async delete(bundleId: string): Promise<void> {
    if (!(await this.has(bundleId))) {
      throw new LiveUpdateError(ErrorCode.BundleNotFound, 'bundle not found.');
    }
    await rm(this.getPath(bundleId), { recursive: true, force: true });
  }

  public async cleanUpStaging(directory: string): Promise<void> {
    await rm(directory, { recursive: true, force: true });
  }
}
