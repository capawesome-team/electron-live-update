import type { KeyObject } from 'node:crypto';
import { createHash, createPublicKey, createVerify } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { readdir } from 'node:fs/promises';
import { join } from 'node:path';

import { ErrorCode, LiveUpdateError } from './errors';

/**
 * Compute the SHA-256 checksum of a file as a lowercase hex string.
 */
export async function calculateFileChecksum(filePath: string): Promise<string> {
  try {
    const hash = createHash('sha256');
    for await (const chunk of createReadStream(filePath)) {
      hash.update(chunk as Buffer);
    }
    return hash.digest('hex');
  } catch {
    throw new LiveUpdateError(
      ErrorCode.ChecksumCalculationFailed,
      'Failed to calculate checksum.',
    );
  }
}

export function parsePublicKey(publicKeyPem: string): KeyObject {
  try {
    const key = createPublicKey(publicKeyPem);
    if (key.asymmetricKeyType !== 'rsa') {
      throw new Error('Not an RSA key.');
    }
    return key;
  } catch {
    throw new LiveUpdateError(
      ErrorCode.PublicKeyInvalid,
      'Invalid public key.',
    );
  }
}

/**
 * Verify the RSA signature of a file.
 *
 * The signature is the RSA PKCS#1 v1.5 signature of the SHA-256
 * digest of the raw file bytes, encoded as base64. This matches the
 * signing scheme of the Capawesome Cloud CLI and the
 * `@capawesome/capacitor-live-update` plugin.
 */
export async function verifyFileSignature(
  filePath: string,
  signatureBase64: string,
  publicKey: KeyObject,
): Promise<void> {
  let valid = false;
  try {
    const verifier = createVerify('RSA-SHA256');
    for await (const chunk of createReadStream(filePath)) {
      verifier.update(chunk as Buffer);
    }
    valid = verifier.verify(publicKey, Buffer.from(signatureBase64, 'base64'));
  } catch {
    valid = false;
  }
  if (!valid) {
    throw new LiveUpdateError(
      ErrorCode.SignatureVerificationFailed,
      'Signature verification failed.',
    );
  }
}

export interface VerifyDownloadedFileOptions {
  /**
   * SHA-256 checksum in hex format, from the `checksum` option or the
   * `X-Checksum` response header.
   */
  checksum?: string;
  filePath: string;
  /**
   * SHA-256 checksum in hex format from the trusted bundle manifest
   * (a `manifest`/delta bundle item). Used to verify individual files
   * of a delta bundle when no `publicKey` is configured: it is used as
   * a fallback when no `checksum` header is present and, when both are
   * present, a `checksum` header contradicting it fails verification.
   */
  manifestChecksum?: string;
  /**
   * PEM-encoded RSA public key from the SDK configuration.
   */
  publicKey?: string;
  /**
   * Base64 signature, from the `signature` option or the
   * `X-Signature` response header.
   */
  signature?: string;
}

/**
 * Verify a downloaded file before it is installed.
 *
 * Verification precedence (mirrors the Capacitor plugin):
 * 1. If a `publicKey` is configured, a signature is REQUIRED and the
 *    checksum is ignored. A present-but-empty signature is NOT treated
 *    as missing: it flows into the verification and fails there. Only
 *    an absent (`undefined`) signature is reported as missing.
 * 2. Otherwise, if a `checksum` header and a `manifestChecksum` are
 *    both present and disagree, verification fails: a header
 *    contradicting the trusted manifest is suspicious.
 * 3. Otherwise, if either a `checksum` header or a `manifestChecksum`
 *    is available, it is verified (the header taking precedence). A
 *    present-but-empty value is a value: it is compared and rejects.
 * 4. Otherwise (both absent), the file is accepted without verification.
 */
export async function verifyDownloadedFile(
  options: VerifyDownloadedFileOptions,
): Promise<void> {
  if (options.publicKey) {
    const publicKey = parsePublicKey(options.publicKey);
    if (options.signature === undefined) {
      throw new LiveUpdateError(
        ErrorCode.SignatureMissing,
        'Bundle does not contain a signature.',
      );
    }
    await verifyFileSignature(options.filePath, options.signature, publicKey);
    return;
  }
  const headerChecksum = options.checksum?.toLowerCase();
  const manifestChecksum = options.manifestChecksum?.toLowerCase();
  if (
    headerChecksum !== undefined &&
    manifestChecksum !== undefined &&
    headerChecksum !== manifestChecksum
  ) {
    throw new LiveUpdateError(ErrorCode.ChecksumMismatch, 'Checksum mismatch.');
  }
  const expectedChecksum = headerChecksum ?? manifestChecksum;
  if (expectedChecksum !== undefined) {
    const actualChecksum = await calculateFileChecksum(options.filePath);
    if (actualChecksum !== expectedChecksum) {
      throw new LiveUpdateError(
        ErrorCode.ChecksumMismatch,
        'Checksum mismatch.',
      );
    }
  }
}

/**
 * Compute the checksums of all files in a bundle directory, keyed by
 * the file path relative to the bundle root (POSIX separators).
 *
 * The result is stored as bundle metadata at install time and
 * re-verified at activation time, so tampering with an installed
 * bundle between download and activation is detected.
 */
export async function calculateContentChecksums(
  directory: string,
): Promise<{ [path: string]: string }> {
  const checksums: { [path: string]: string } = {};
  const walk = async (
    currentDirectory: string,
    prefix: string,
  ): Promise<void> => {
    const entries = await readdir(currentDirectory, { withFileTypes: true });
    for (const entry of entries) {
      const relativePath = prefix ? `${prefix}/${entry.name}` : entry.name;
      if (entry.isDirectory()) {
        await walk(join(currentDirectory, entry.name), relativePath);
      } else if (entry.isFile()) {
        checksums[relativePath] = await calculateFileChecksum(
          join(currentDirectory, entry.name),
        );
      }
    }
  };
  await walk(directory, '');
  return checksums;
}

/**
 * Re-verify the content of an installed bundle against the checksums
 * recorded at install time.
 *
 * Returns `false` if any file was added, removed or modified.
 */
export async function verifyContentChecksums(
  directory: string,
  expected: { [path: string]: string },
): Promise<boolean> {
  let actual: { [path: string]: string };
  try {
    actual = await calculateContentChecksums(directory);
  } catch {
    return false;
  }
  const expectedPaths = Object.keys(expected);
  const actualPaths = Object.keys(actual);
  if (expectedPaths.length !== actualPaths.length) {
    return false;
  }
  return expectedPaths.every(path => expected[path] === actual[path]);
}
