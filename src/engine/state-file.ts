import { open, mkdir, readFile, rm } from 'node:fs/promises';
import { dirname, join } from 'node:path';

import { renameWithRetry, retryOnFileLock } from './fs-retry';

/**
 * Metadata stored for each downloaded bundle.
 *
 * @since 0.1.0
 */
export interface BundleMetadata {
  /**
   * SHA-256 hex checksums of every file in the bundle, keyed by the
   * file path relative to the bundle root (POSIX separators).
   *
   * Computed at install time from the verified download and re-verified
   * at activation time to detect post-download tampering.
   *
   * @since 0.1.0
   */
  fileChecksums: { [path: string]: string };
  /**
   * Whether the download of this bundle was verified with a signature.
   *
   * @since 0.1.0
   */
  signed: boolean;
}

/**
 * The marker that is written to disk BEFORE a not-yet-proven bundle
 * is loaded. It is cleared by `ready()`. If it is still present at
 * the next process start, the previous boot died before the app
 * became ready and the engine rolls back.
 *
 * @since 0.1.0
 */
export interface PendingBootMarker {
  /**
   * The number of boot attempts for this bundle.
   *
   * @since 0.1.0
   */
  attempts: number;
  /**
   * The unique identifier of the bundle being booted.
   *
   * @since 0.1.0
   */
  bundleId: string;
}

export interface PersistedState {
  blockedBundleIds: string[];
  bundles: { [bundleId: string]: BundleMetadata };
  channel: string | null;
  currentBundleId: string | null;
  customId: string | null;
  deviceIds: { [appId: string]: string };
  lastSuccessfulBundleId: string | null;
  nextBundleId: string | null;
  pendingBoot: PendingBootMarker | null;
  previousBundleId: string | null;
}

const STATE_FILE_NAME = 'state.json';

function createDefaultState(): PersistedState {
  return {
    blockedBundleIds: [],
    bundles: {},
    channel: null,
    currentBundleId: null,
    customId: null,
    deviceIds: {},
    lastSuccessfulBundleId: null,
    nextBundleId: null,
    pendingBoot: null,
    previousBundleId: null,
  };
}

function normalizeState(raw: unknown): PersistedState {
  const state = createDefaultState();
  if (typeof raw !== 'object' || raw === null) {
    return state;
  }
  const record = raw as Record<string, unknown>;
  if (Array.isArray(record.blockedBundleIds)) {
    state.blockedBundleIds = record.blockedBundleIds.filter(
      (value): value is string => typeof value === 'string',
    );
  }
  if (typeof record.bundles === 'object' && record.bundles !== null) {
    for (const [bundleId, metadata] of Object.entries(
      record.bundles as Record<string, unknown>,
    )) {
      if (typeof metadata === 'object' && metadata !== null) {
        const metadataRecord = metadata as Record<string, unknown>;
        const fileChecksums: { [path: string]: string } = {};
        if (
          typeof metadataRecord.fileChecksums === 'object' &&
          metadataRecord.fileChecksums !== null
        ) {
          for (const [path, checksum] of Object.entries(
            metadataRecord.fileChecksums as Record<string, unknown>,
          )) {
            if (typeof checksum === 'string') {
              fileChecksums[path] = checksum;
            }
          }
        }
        state.bundles[bundleId] = {
          fileChecksums,
          signed: metadataRecord.signed === true,
        };
      }
    }
  }
  if (typeof record.channel === 'string') {
    state.channel = record.channel;
  }
  if (typeof record.currentBundleId === 'string') {
    state.currentBundleId = record.currentBundleId;
  }
  if (typeof record.customId === 'string') {
    state.customId = record.customId;
  }
  if (typeof record.deviceIds === 'object' && record.deviceIds !== null) {
    for (const [appId, deviceId] of Object.entries(
      record.deviceIds as Record<string, unknown>,
    )) {
      if (typeof deviceId === 'string') {
        state.deviceIds[appId] = deviceId;
      }
    }
  }
  if (typeof record.lastSuccessfulBundleId === 'string') {
    state.lastSuccessfulBundleId = record.lastSuccessfulBundleId;
  }
  if (typeof record.nextBundleId === 'string') {
    state.nextBundleId = record.nextBundleId;
  }
  if (typeof record.pendingBoot === 'object' && record.pendingBoot !== null) {
    const marker = record.pendingBoot as Record<string, unknown>;
    if (typeof marker.bundleId === 'string') {
      state.pendingBoot = {
        attempts:
          typeof marker.attempts === 'number' &&
          Number.isFinite(marker.attempts)
            ? marker.attempts
            : 1,
        bundleId: marker.bundleId,
      };
    }
  }
  if (typeof record.previousBundleId === 'string') {
    state.previousBundleId = record.previousBundleId;
  }
  return state;
}

/**
 * Persisted engine state with crash-safe writes.
 *
 * Every save writes to a temporary file, flushes it to disk with
 * `fsync`, and atomically renames it over the previous state file.
 * A crash or kill at any point leaves either the old or the new
 * state on disk, never a torn write.
 */
export class StateFile {
  private readonly filePath: string;
  private state: PersistedState = createDefaultState();
  private writeQueue: Promise<void> = Promise.resolve();

  constructor(directory: string) {
    this.filePath = join(directory, STATE_FILE_NAME);
  }

  public async load(): Promise<void> {
    try {
      const content = await readFile(this.filePath, 'utf8');
      this.state = normalizeState(JSON.parse(content));
    } catch {
      // Missing or corrupt state file: start from defaults. A corrupt
      // state file must never prevent the app from booting.
      this.state = createDefaultState();
    }
  }

  public get(): Readonly<PersistedState> {
    return this.state;
  }

  /**
   * Apply a mutation to the state and persist it atomically.
   *
   * The returned promise resolves after the new state has been
   * flushed to disk. Writes are serialized to prevent interleaving.
   */
  public async update(mutate: (state: PersistedState) => void): Promise<void> {
    mutate(this.state);
    const snapshot = JSON.stringify(this.state, null, 2);
    // A failed write rejects THIS update, but must not poison the
    // queue: later updates write the then-latest snapshot regardless.
    this.writeQueue = this.writeQueue
      .catch(() => undefined)
      .then(() => this.write(snapshot));
    return this.writeQueue;
  }

  private async write(content: string): Promise<void> {
    await mkdir(dirname(this.filePath), { recursive: true });
    const temporaryPath = `${this.filePath}.tmp`;
    const fileHandle = await open(temporaryPath, 'w');
    try {
      await fileHandle.writeFile(content, 'utf8');
      await fileHandle.sync();
    } finally {
      await fileHandle.close();
    }
    // Retried: on Windows the rename fails with EPERM while any other
    // process (antivirus, an external reader) holds the destination.
    await renameWithRetry(temporaryPath, this.filePath);
    try {
      // Flush the rename itself. Not supported on all platforms
      // (e.g. directories cannot be opened on Windows), so best effort.
      const directoryHandle = await open(dirname(this.filePath), 'r');
      try {
        await directoryHandle.sync();
      } finally {
        await directoryHandle.close();
      }
    } catch {
      // Best effort only.
    }
  }

  public async delete(): Promise<void> {
    // Retried for the same reason as the rename in write(): deleting
    // an externally held file fails with EPERM/EBUSY on Windows.
    await retryOnFileLock(() => rm(this.filePath, { force: true }));
    this.state = createDefaultState();
  }
}
