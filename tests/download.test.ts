import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { assertSecureUrl, downloadFile } from '../src/engine/download';
import { ErrorCode } from '../src/engine/errors';

import {
  MockServer,
  createTemporaryDirectory,
  removeDirectory,
} from './helpers';

describe('assertSecureUrl', () => {
  it('allows https URLs', () => {
    expect(() =>
      assertSecureUrl('https://example.com/bundle.zip'),
    ).not.toThrow();
  });

  it('allows http URLs for localhost', () => {
    expect(() =>
      assertSecureUrl('http://localhost:3000/bundle.zip'),
    ).not.toThrow();
    expect(() =>
      assertSecureUrl('http://127.0.0.1:3000/bundle.zip'),
    ).not.toThrow();
    expect(() =>
      assertSecureUrl('http://api.localhost/bundle.zip'),
    ).not.toThrow();
  });

  it('rejects http URLs for remote hosts', () => {
    expect(() => assertSecureUrl('http://example.com/bundle.zip')).toThrowError(
      expect.objectContaining({ code: ErrorCode.InsecureUrl }),
    );
  });

  it('rejects other protocols', () => {
    expect(() => assertSecureUrl('file:///etc/passwd')).toThrowError(
      expect.objectContaining({ code: ErrorCode.InsecureUrl }),
    );
    expect(() => assertSecureUrl('ftp://example.com/bundle.zip')).toThrowError(
      expect.objectContaining({ code: ErrorCode.InsecureUrl }),
    );
  });

  it('rejects invalid URLs', () => {
    expect(() => assertSecureUrl('not a url')).toThrowError(
      expect.objectContaining({ code: ErrorCode.UrlMissing }),
    );
  });
});

describe('downloadFile', () => {
  let server: MockServer;
  let workingDirectory: string;

  beforeEach(async () => {
    server = new MockServer();
    await server.start();
    workingDirectory = await createTemporaryDirectory();
  });

  afterEach(async () => {
    await server.stop();
    await removeDirectory(workingDirectory);
  });

  it('downloads a file and reports progress', async () => {
    const payload = Buffer.alloc(64 * 1024, 7);
    server.route('/bundle.zip', { body: payload });
    const destinationPath = join(workingDirectory, 'bundle.zip');
    const progressEvents: { downloadedBytes: number; totalBytes: number }[] =
      [];
    await downloadFile({
      destinationPath,
      httpTimeout: 5000,
      onProgress: (downloadedBytes, totalBytes) =>
        progressEvents.push({ downloadedBytes, totalBytes }),
      url: `${server.origin}/bundle.zip`,
    });
    expect((await readFile(destinationPath)).equals(payload)).toBe(true);
    expect(progressEvents.length).toBeGreaterThan(0);
    const lastEvent = progressEvents[progressEvents.length - 1];
    expect(lastEvent?.downloadedBytes).toBe(payload.length);
    expect(lastEvent?.totalBytes).toBe(payload.length);
  });

  it('returns the X-Checksum and X-Signature response headers', async () => {
    server.route('/bundle.zip', {
      body: 'data',
      headers: { 'X-Checksum': 'abc123', 'X-Signature': 'ZmFrZQ==' },
    });
    const result = await downloadFile({
      destinationPath: join(workingDirectory, 'bundle.zip'),
      httpTimeout: 5000,
      url: `${server.origin}/bundle.zip`,
    });
    expect(result.checksum).toBe('abc123');
    expect(result.signature).toBe('ZmFrZQ==');
  });

  it('fails with DOWNLOAD_FAILED on a non-2xx response', async () => {
    server.route('/bundle.zip', { body: 'gone', status: 404 });
    await expect(
      downloadFile({
        destinationPath: join(workingDirectory, 'bundle.zip'),
        httpTimeout: 5000,
        url: `${server.origin}/bundle.zip`,
      }),
    ).rejects.toMatchObject({
      code: ErrorCode.DownloadFailed,
      message: 'Bundle could not be downloaded.',
    });
  });

  it('rejects insecure remote URLs', async () => {
    await expect(
      downloadFile({
        destinationPath: join(workingDirectory, 'bundle.zip'),
        httpTimeout: 5000,
        url: 'http://example.com/bundle.zip',
      }),
    ).rejects.toMatchObject({ code: ErrorCode.InsecureUrl });
  });
});
