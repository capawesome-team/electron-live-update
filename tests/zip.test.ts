import { access, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { LiveUpdateError } from '../src/engine/errors';
import { extractZip, findIndexHtmlDirectory } from '../src/engine/zip';

import {
  createTemporaryDirectory,
  removeDirectory,
  writeRawZip,
  writeZip,
} from './helpers';

describe('extractZip', () => {
  let workingDirectory: string;
  let zipPath: string;
  let targetDirectory: string;

  beforeEach(async () => {
    workingDirectory = await createTemporaryDirectory();
    zipPath = join(workingDirectory, 'bundle.zip');
    targetDirectory = join(workingDirectory, 'extracted');
  });

  afterEach(async () => {
    await removeDirectory(workingDirectory);
  });

  it('extracts files and nested directories', async () => {
    await writeZip(zipPath, [
      { path: 'index.html', content: '<html></html>' },
      { path: 'assets/js/app.js', content: 'console.log(1);' },
    ]);
    await extractZip(zipPath, targetDirectory);
    expect(await readFile(join(targetDirectory, 'index.html'), 'utf8')).toBe(
      '<html></html>',
    );
    expect(
      await readFile(join(targetDirectory, 'assets', 'js', 'app.js'), 'utf8'),
    ).toBe('console.log(1);');
  });

  it('rejects entries with parent directory traversal', async () => {
    await writeRawZip(zipPath, [
      { name: 'index.html', content: 'ok' },
      { name: '../evil.txt', content: 'evil' },
    ]);
    await expect(extractZip(zipPath, targetDirectory)).rejects.toBeInstanceOf(
      LiveUpdateError,
    );
    await expect(access(join(workingDirectory, 'evil.txt'))).rejects.toThrow();
  });

  it('rejects entries with backslash traversal', async () => {
    await writeRawZip(zipPath, [{ name: '..\\evil.txt', content: 'evil' }]);
    await expect(extractZip(zipPath, targetDirectory)).rejects.toBeInstanceOf(
      LiveUpdateError,
    );
    await expect(access(join(workingDirectory, 'evil.txt'))).rejects.toThrow();
  });

  it('rejects entries with absolute paths', async () => {
    await writeRawZip(zipPath, [{ name: '/tmp/evil.txt', content: 'evil' }]);
    await expect(extractZip(zipPath, targetDirectory)).rejects.toBeInstanceOf(
      LiveUpdateError,
    );
  });

  it('rejects entries with drive letters', async () => {
    await writeRawZip(zipPath, [{ name: 'C:/evil.txt', content: 'evil' }]);
    await expect(extractZip(zipPath, targetDirectory)).rejects.toBeInstanceOf(
      LiveUpdateError,
    );
  });

  it('does not extract symlink entries', async () => {
    await writeZip(zipPath, [
      { path: 'index.html', content: 'ok' },
      { path: 'link', content: '/etc/hosts', mode: 0o120777 },
    ]);
    await extractZip(zipPath, targetDirectory);
    await expect(access(join(targetDirectory, 'link'))).rejects.toThrow();
    expect(await readFile(join(targetDirectory, 'index.html'), 'utf8')).toBe(
      'ok',
    );
  });

  it('fails on a file that is not a zip archive', async () => {
    const { writeFile } = await import('node:fs/promises');
    await writeFile(zipPath, 'not a zip');
    await expect(extractZip(zipPath, targetDirectory)).rejects.toBeInstanceOf(
      LiveUpdateError,
    );
  });
});

describe('findIndexHtmlDirectory', () => {
  let workingDirectory: string;

  beforeEach(async () => {
    workingDirectory = await createTemporaryDirectory();
  });

  afterEach(async () => {
    await removeDirectory(workingDirectory);
  });

  it('finds index.html at the root', async () => {
    const zipPath = join(workingDirectory, 'bundle.zip');
    const target = join(workingDirectory, 'extracted');
    await writeZip(zipPath, [{ path: 'index.html', content: 'root' }]);
    await extractZip(zipPath, target);
    expect(await findIndexHtmlDirectory(target)).toBe(target);
  });

  it('finds index.html in a nested directory', async () => {
    const zipPath = join(workingDirectory, 'bundle.zip');
    const target = join(workingDirectory, 'extracted');
    await writeZip(zipPath, [
      { path: 'dist/index.html', content: 'nested' },
      { path: 'dist/app.js', content: '' },
    ]);
    await extractZip(zipPath, target);
    expect(await findIndexHtmlDirectory(target)).toBe(join(target, 'dist'));
  });

  it('returns null when no index.html exists', async () => {
    const zipPath = join(workingDirectory, 'bundle.zip');
    const target = join(workingDirectory, 'extracted');
    await writeZip(zipPath, [{ path: 'readme.txt', content: 'no html' }]);
    await extractZip(zipPath, target);
    expect(await findIndexHtmlDirectory(target)).toBeNull();
  });
});
