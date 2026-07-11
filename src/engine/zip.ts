import { createWriteStream } from 'node:fs';
import { mkdir, readdir } from 'node:fs/promises';
import { dirname, join, resolve, sep } from 'node:path';
import { pipeline } from 'node:stream/promises';
import * as yauzl from 'yauzl';

import { ErrorCode, LiveUpdateError } from './errors';

const SYMLINK_MODE = 0xa000;

/**
 * Validate a zip entry file name against path traversal (zip slip)
 * and return the safe path segments.
 */
function toSafeSegments(entryFileName: string): string[] {
  if (entryFileName.includes('\0')) {
    throw new LiveUpdateError(
      ErrorCode.DownloadFailed,
      'Bundle could not be downloaded.',
    );
  }
  // Zip entries use forward slashes, but be lenient with archives
  // created by tools that emit backslashes.
  const normalized = entryFileName.replace(/\\/g, '/');
  if (normalized.startsWith('/') || /^[a-zA-Z]:/.test(normalized)) {
    throw new LiveUpdateError(
      ErrorCode.DownloadFailed,
      'Bundle could not be downloaded.',
    );
  }
  const segments = normalized
    .split('/')
    .filter(segment => segment.length > 0 && segment !== '.');
  if (segments.some(segment => segment === '..')) {
    throw new LiveUpdateError(
      ErrorCode.DownloadFailed,
      'Bundle could not be downloaded.',
    );
  }
  return segments;
}

function isSymlinkEntry(entry: yauzl.Entry): boolean {
  const mode = entry.externalFileAttributes >>> 16;
  return (mode & 0xf000) === SYMLINK_MODE;
}

/**
 * Extract a zip archive into the given directory.
 *
 * Protections applied:
 * - Zip slip: entries that would escape the target directory are rejected.
 * - Symbolic links are not extracted.
 */
export async function extractZip(
  zipFilePath: string,
  targetDirectory: string,
): Promise<void> {
  const zipFile = await new Promise<yauzl.ZipFile>(
    (resolvePromise, rejectPromise) => {
      yauzl.open(zipFilePath, { lazyEntries: true }, (error, file) => {
        if (error) {
          rejectPromise(
            new LiveUpdateError(
              ErrorCode.DownloadFailed,
              'Bundle could not be downloaded.',
            ),
          );
        } else {
          resolvePromise(file);
        }
      });
    },
  );
  const targetRoot = resolve(targetDirectory);
  await new Promise<void>((resolvePromise, rejectPromise) => {
    const fail = (error: unknown) => {
      zipFile.close();
      rejectPromise(
        error instanceof LiveUpdateError
          ? error
          : new LiveUpdateError(
              ErrorCode.DownloadFailed,
              'Bundle could not be downloaded.',
            ),
      );
    };
    zipFile.on('error', fail);
    zipFile.on('end', () => resolvePromise());
    zipFile.on('entry', (entry: yauzl.Entry) => {
      void (async () => {
        const segments = toSafeSegments(entry.fileName);
        if (segments.length === 0 || isSymlinkEntry(entry)) {
          zipFile.readEntry();
          return;
        }
        const entryPath = join(targetRoot, ...segments);
        // Belt and suspenders: never write outside of the target directory.
        if (
          entryPath !== targetRoot &&
          !entryPath.startsWith(targetRoot + sep)
        ) {
          throw new LiveUpdateError(
            ErrorCode.DownloadFailed,
            'Bundle could not be downloaded.',
          );
        }
        if (entry.fileName.endsWith('/')) {
          await mkdir(entryPath, { recursive: true });
          zipFile.readEntry();
          return;
        }
        await mkdir(dirname(entryPath), { recursive: true });
        const readStream = await new Promise<NodeJS.ReadableStream>(
          (resolveStream, rejectStream) => {
            zipFile.openReadStream(entry, (error, stream) => {
              if (error) {
                rejectStream(error);
              } else {
                resolveStream(stream);
              }
            });
          },
        );
        await pipeline(readStream, createWriteStream(entryPath));
        zipFile.readEntry();
      })().catch(fail);
    });
    zipFile.readEntry();
  });
}

/**
 * Find the directory containing the `index.html` file of a bundle.
 *
 * The directory that contains the `index.html` becomes the bundle
 * root; archives may nest their web assets in a subdirectory.
 */
export async function findIndexHtmlDirectory(
  directory: string,
): Promise<string | null> {
  const entries = await readdir(directory, { withFileTypes: true });
  if (entries.some(entry => entry.isFile() && entry.name === 'index.html')) {
    return directory;
  }
  for (const entry of entries) {
    if (entry.isDirectory()) {
      const result = await findIndexHtmlDirectory(join(directory, entry.name));
      if (result) {
        return result;
      }
    }
  }
  return null;
}
