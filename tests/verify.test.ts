import { createHash } from 'node:crypto';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { ErrorCode } from '../src/engine/errors';
import {
  calculateContentChecksums,
  calculateFileChecksum,
  parsePublicKey,
  verifyContentChecksums,
  verifyDownloadedFile,
} from '../src/engine/verify';

import {
  createTemporaryDirectory,
  generateRsaKeyPair,
  removeDirectory,
  signBytes,
} from './helpers';

describe('verification', () => {
  let workingDirectory: string;
  let filePath: string;
  const fileContent = Buffer.from('bundle bytes');

  beforeEach(async () => {
    workingDirectory = await createTemporaryDirectory();
    filePath = join(workingDirectory, 'bundle.zip');
    await writeFile(filePath, fileContent);
  });

  afterEach(async () => {
    await removeDirectory(workingDirectory);
  });

  it('calculates the SHA-256 checksum of a file in hex format', async () => {
    const expected = createHash('sha256').update(fileContent).digest('hex');
    expect(await calculateFileChecksum(filePath)).toBe(expected);
  });

  it('accepts a file with a matching checksum', async () => {
    const checksum = createHash('sha256').update(fileContent).digest('hex');
    await expect(
      verifyDownloadedFile({ filePath, checksum }),
    ).resolves.toBeUndefined();
  });

  it('accepts an uppercase checksum', async () => {
    const checksum = createHash('sha256')
      .update(fileContent)
      .digest('hex')
      .toUpperCase();
    await expect(
      verifyDownloadedFile({ filePath, checksum }),
    ).resolves.toBeUndefined();
  });

  it('rejects a file with a mismatching checksum', async () => {
    await expect(
      verifyDownloadedFile({ filePath, checksum: 'a'.repeat(64) }),
    ).rejects.toMatchObject({
      code: ErrorCode.ChecksumMismatch,
      message: 'Checksum mismatch.',
    });
  });

  it('accepts a file without checksum and without public key', async () => {
    await expect(verifyDownloadedFile({ filePath })).resolves.toBeUndefined();
  });

  it('rejects a present-but-empty checksum header', async () => {
    await expect(
      verifyDownloadedFile({ filePath, checksum: '' }),
    ).rejects.toMatchObject({
      code: ErrorCode.ChecksumMismatch,
      message: 'Checksum mismatch.',
    });
  });

  it('verifies a valid signature', async () => {
    const { privateKeyPem, publicKeyPem } = generateRsaKeyPair();
    const signature = signBytes(fileContent, privateKeyPem);
    await expect(
      verifyDownloadedFile({ filePath, publicKey: publicKeyPem, signature }),
    ).resolves.toBeUndefined();
  });

  it('rejects a tampered file', async () => {
    const { privateKeyPem, publicKeyPem } = generateRsaKeyPair();
    const signature = signBytes(fileContent, privateKeyPem);
    await writeFile(filePath, Buffer.from('tampered bytes'));
    await expect(
      verifyDownloadedFile({ filePath, publicKey: publicKeyPem, signature }),
    ).rejects.toMatchObject({
      code: ErrorCode.SignatureVerificationFailed,
      message: 'Signature verification failed.',
    });
  });

  it('rejects a signature from a different key', async () => {
    const { privateKeyPem } = generateRsaKeyPair();
    const { publicKeyPem } = generateRsaKeyPair();
    const signature = signBytes(fileContent, privateKeyPem);
    await expect(
      verifyDownloadedFile({ filePath, publicKey: publicKeyPem, signature }),
    ).rejects.toMatchObject({
      code: ErrorCode.SignatureVerificationFailed,
    });
  });

  it('requires a signature when a public key is configured', async () => {
    const { publicKeyPem } = generateRsaKeyPair();
    const checksum = createHash('sha256').update(fileContent).digest('hex');
    await expect(
      verifyDownloadedFile({ filePath, publicKey: publicKeyPem, checksum }),
    ).rejects.toMatchObject({
      code: ErrorCode.SignatureMissing,
      message: 'Bundle does not contain a signature.',
    });
  });

  it('rejects a present-but-empty signature (not treated as missing)', async () => {
    const { publicKeyPem } = generateRsaKeyPair();
    await expect(
      verifyDownloadedFile({
        filePath,
        publicKey: publicKeyPem,
        signature: '',
      }),
    ).rejects.toMatchObject({
      code: ErrorCode.SignatureVerificationFailed,
      message: 'Signature verification failed.',
    });
  });

  it('ignores the checksum when a public key is configured', async () => {
    const { privateKeyPem, publicKeyPem } = generateRsaKeyPair();
    const signature = signBytes(fileContent, privateKeyPem);
    // Wrong checksum, valid signature: the signature path wins.
    await expect(
      verifyDownloadedFile({
        filePath,
        publicKey: publicKeyPem,
        signature,
        checksum: 'a'.repeat(64),
      }),
    ).resolves.toBeUndefined();
  });

  it('rejects an invalid public key', () => {
    expect(() => parsePublicKey('not a key')).toThrowError(
      expect.objectContaining({
        code: ErrorCode.PublicKeyInvalid,
        message: 'Invalid public key.',
      }),
    );
  });
});

describe('content checksums', () => {
  let bundleDirectory: string;

  beforeEach(async () => {
    bundleDirectory = await createTemporaryDirectory();
    await writeFile(join(bundleDirectory, 'index.html'), '<html></html>');
    await mkdir(join(bundleDirectory, 'assets'));
    await writeFile(
      join(bundleDirectory, 'assets', 'app.js'),
      'console.log(1);',
    );
  });

  afterEach(async () => {
    await removeDirectory(bundleDirectory);
  });

  it('computes checksums for all files with POSIX relative paths', async () => {
    const checksums = await calculateContentChecksums(bundleDirectory);
    expect(Object.keys(checksums).sort()).toEqual([
      'assets/app.js',
      'index.html',
    ]);
  });

  it('verifies unchanged content', async () => {
    const checksums = await calculateContentChecksums(bundleDirectory);
    expect(await verifyContentChecksums(bundleDirectory, checksums)).toBe(true);
  });

  it('detects a modified file', async () => {
    const checksums = await calculateContentChecksums(bundleDirectory);
    await writeFile(
      join(bundleDirectory, 'assets', 'app.js'),
      'console.log(2);',
    );
    expect(await verifyContentChecksums(bundleDirectory, checksums)).toBe(
      false,
    );
  });

  it('detects an added file', async () => {
    const checksums = await calculateContentChecksums(bundleDirectory);
    await writeFile(join(bundleDirectory, 'extra.js'), 'alert(1);');
    expect(await verifyContentChecksums(bundleDirectory, checksums)).toBe(
      false,
    );
  });

  it('detects a removed file', async () => {
    const checksums = await calculateContentChecksums(bundleDirectory);
    await rm(join(bundleDirectory, 'assets', 'app.js'));
    expect(await verifyContentChecksums(bundleDirectory, checksums)).toBe(
      false,
    );
  });
});
