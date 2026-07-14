import { tmpdir } from 'node:os';
import { join, sep } from 'node:path';
import { describe, expect, it } from 'vitest';

import { ErrorCode } from '../src/engine/errors';
import {
  MANIFEST_FILE_NAME,
  parseManifest,
  resolveManifestFilePath,
} from '../src/engine/manifest';

describe('manifest', () => {
  describe('parseManifest', () => {
    it('parses a valid manifest', () => {
      const items = parseManifest([
        { href: 'index.html', checksum: 'aaa', sizeInBytes: 10 },
        { href: 'assets/app.js', checksum: 'bbb', sizeInBytes: 20 },
      ]);
      expect(items).toEqual([
        { href: 'index.html', checksum: 'aaa', sizeInBytes: 10 },
        { href: 'assets/app.js', checksum: 'bbb', sizeInBytes: 20 },
      ]);
    });

    it('defaults a missing or invalid sizeInBytes to 0', () => {
      const items = parseManifest([{ href: 'a', checksum: 'c' }]);
      expect(items[0]?.sizeInBytes).toBe(0);
    });

    it('ignores entries without a href or checksum', () => {
      const items = parseManifest([
        { href: 'a', checksum: 'c' },
        { href: 'b' },
        { checksum: 'd' },
        'garbage',
        null,
      ]);
      expect(items).toEqual([{ href: 'a', checksum: 'c', sizeInBytes: 0 }]);
    });

    it('throws when the manifest is not an array', () => {
      expect(() => parseManifest({})).toThrowError(
        expect.objectContaining({ code: ErrorCode.DownloadFailed }),
      );
    });
  });

  describe('resolveManifestFilePath', () => {
    it('resolves a nested path inside the target directory', () => {
      const root = join(tmpdir(), 'bundle');
      expect(resolveManifestFilePath(root, 'assets/app.js')).toBe(
        join(root, 'assets', 'app.js'),
      );
    });

    it('rejects path traversal', () => {
      const root = join(tmpdir(), 'bundle');
      for (const href of [
        '../escape.js',
        'assets/../../escape.js',
        `/etc/passwd`,
        'C:/windows',
        'a\0b',
        '',
      ]) {
        expect(() => resolveManifestFilePath(root, href)).toThrowError(
          expect.objectContaining({ code: ErrorCode.DownloadFailed }),
        );
      }
    });

    it('normalizes backslashes and keeps the path inside the root', () => {
      const root = join(tmpdir(), 'bundle');
      const resolved = resolveManifestFilePath(root, 'assets\\app.js');
      expect(resolved.startsWith(root + sep)).toBe(true);
    });
  });

  it('exposes the reserved manifest file name', () => {
    expect(MANIFEST_FILE_NAME).toBe('capawesome-live-update-manifest.json');
  });
});
