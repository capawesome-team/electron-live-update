import { randomUUID } from 'node:crypto';
import { mkdir, readdir, rm, stat } from 'node:fs/promises';
import { join } from 'node:path';

import { ErrorCode, LiveUpdateError } from './errors';
import { renameWithRetry } from './fs-retry';

/**
 * Options for the recursive `rm` calls: on Windows, deleting a
 * directory fails with EPERM/EBUSY while another process (e.g. an
 * antivirus scanner) holds a handle on a file inside it. `rm` retries
 * these errors natively with a linear backoff.
 */
const RM_RETRY_OPTIONS = {
  force: true,
  maxRetries: 5,
  recursive: true,
} as const;

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
    await rm(this.stagingDirectory, RM_RETRY_OPTIONS);
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
    // Retried: on Windows the rename fails with EPERM/EACCES while an
    // antivirus scanner holds a freshly written file in the staging
    // directory.
    await renameWithRetry(sourceDirectory, this.getPath(bundleId));
  }

  public async delete(bundleId: string): Promise<void> {
    if (!(await this.has(bundleId))) {
      throw new LiveUpdateError(ErrorCode.BundleNotFound, 'bundle not found.');
    }
    await rm(this.getPath(bundleId), RM_RETRY_OPTIONS);
  }

  public async cleanUpStaging(directory: string): Promise<void> {
    await rm(directory, RM_RETRY_OPTIONS);
  }
}
