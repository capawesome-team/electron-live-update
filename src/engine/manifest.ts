import { join, resolve, sep } from 'node:path';

import { ErrorCode, LiveUpdateError } from './errors';

/**
 * The reserved file name of the manifest of a `manifest` (delta) bundle.
 *
 * DO NOT CHANGE: this is part of the Capawesome Cloud Live Update
 * protocol and must match the mobile plugins.
 */
export const MANIFEST_FILE_NAME = 'capawesome-live-update-manifest.json';

/**
 * A single entry of a bundle manifest.
 */
export interface ManifestItem {
  /**
   * The SHA-256 checksum of the file, used for diffing.
   */
  checksum: string;
  /**
   * The path of the file relative to the bundle root.
   */
  href: string;
  /**
   * The size of the file in bytes, used for progress aggregation.
   */
  sizeInBytes: number;
}

/**
 * Parse the JSON of a bundle manifest into a list of manifest items.
 *
 * The manifest is a JSON array of `{ href, checksum, sizeInBytes }`
 * objects. Entries without a `href` or `checksum` are ignored.
 */
export function parseManifest(json: unknown): ManifestItem[] {
  if (!Array.isArray(json)) {
    throw new LiveUpdateError(
      ErrorCode.DownloadFailed,
      'Bundle could not be downloaded.',
    );
  }
  const items: ManifestItem[] = [];
  for (const entry of json) {
    if (typeof entry !== 'object' || entry === null) {
      continue;
    }
    const record = entry as Record<string, unknown>;
    if (
      typeof record.href !== 'string' ||
      typeof record.checksum !== 'string'
    ) {
      continue;
    }
    items.push({
      checksum: record.checksum,
      href: record.href,
      sizeInBytes:
        typeof record.sizeInBytes === 'number' &&
        Number.isFinite(record.sizeInBytes)
          ? record.sizeInBytes
          : 0,
    });
  }
  return items;
}

/**
 * Resolve a manifest item `href` to an absolute path inside the target
 * directory, rejecting any path that would escape it (path traversal).
 */
export function resolveManifestFilePath(
  targetDirectory: string,
  href: string,
): string {
  if (href.includes('\0')) {
    throw pathError();
  }
  const normalized = href.replace(/\\/g, '/');
  if (normalized.startsWith('/') || /^[a-zA-Z]:/.test(normalized)) {
    throw pathError();
  }
  const segments = normalized
    .split('/')
    .filter(segment => segment.length > 0 && segment !== '.');
  if (segments.length === 0 || segments.some(segment => segment === '..')) {
    throw pathError();
  }
  const targetRoot = resolve(targetDirectory);
  const filePath = join(targetRoot, ...segments);
  if (filePath !== targetRoot && !filePath.startsWith(targetRoot + sep)) {
    throw pathError();
  }
  return filePath;
}

function pathError(): LiveUpdateError {
  return new LiveUpdateError(
    ErrorCode.DownloadFailed,
    'Bundle could not be downloaded.',
  );
}
