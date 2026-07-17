import { createWriteStream } from 'node:fs';
import { Writable } from 'node:stream';
import { pipeline } from 'node:stream/promises';

import { ErrorCode, LiveUpdateError } from './errors';

const LOCALHOST_HOSTNAMES = new Set(['localhost', '127.0.0.1', '[::1]', '::1']);

/**
 * Enforce HTTPS-only downloads. Plain HTTP is allowed for localhost
 * only, so that development against a local server keeps working.
 */
export function assertSecureUrl(url: string): URL {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new LiveUpdateError(ErrorCode.UrlMissing, 'url must be provided.');
  }
  if (parsed.protocol === 'https:') {
    return parsed;
  }
  if (
    parsed.protocol === 'http:' &&
    (LOCALHOST_HOSTNAMES.has(parsed.hostname) ||
      parsed.hostname.endsWith('.localhost'))
  ) {
    return parsed;
  }
  throw new LiveUpdateError(
    ErrorCode.InsecureUrl,
    'Bundles must be downloaded via HTTPS. Plain HTTP is only allowed for localhost.',
  );
}

export interface DownloadFileOptions {
  destinationPath: string;
  httpTimeout: number;
  onProgress?: (downloadedBytes: number, totalBytes: number) => void;
  /**
   * An optional external signal to abort the download (e.g. to cancel
   * sibling downloads when one of a parallel batch fails).
   */
  signal?: AbortSignal;
  url: string;
}

export interface DownloadFileResult {
  /**
   * Value of the `X-Checksum` response header, if present.
   */
  checksum?: string;
  /**
   * Value of the `X-Signature` response header, if present.
   */
  signature?: string;
}

/**
 * Download a file to disk, reporting progress and returning the
 * verification headers of the response.
 */
export async function downloadFile(
  options: DownloadFileOptions,
): Promise<DownloadFileResult> {
  const url = assertSecureUrl(options.url);
  const timeoutSignal = AbortSignal.timeout(options.httpTimeout);
  const signal = options.signal
    ? AbortSignal.any([timeoutSignal, options.signal])
    : timeoutSignal;
  let response: Response;
  try {
    response = await fetch(url, { signal });
  } catch (error) {
    throw toRequestError(error);
  }
  if (!response.ok || !response.body) {
    throw new LiveUpdateError(
      ErrorCode.DownloadFailed,
      'Bundle could not be downloaded.',
    );
  }
  const totalBytes = Number(response.headers.get('content-length')) || 0;
  let downloadedBytes = 0;
  const progress = new Writable({
    write: (chunk: Buffer, _encoding, callback) => {
      downloadedBytes += chunk.length;
      options.onProgress?.(downloadedBytes, totalBytes);
      callback();
    },
  });
  try {
    // Consume the body once, teeing progress accounting off the file write.
    const reader = response.body.getReader();
    const fileStream = createWriteStream(options.destinationPath);
    await pipeline(async function* () {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) {
          break;
        }
        const chunk = Buffer.from(value);
        await new Promise<void>((resolve, reject) =>
          progress.write(chunk, error => (error ? reject(error) : resolve())),
        );
        yield chunk;
      }
    }, fileStream);
  } catch (error) {
    throw toRequestError(error);
  }
  return {
    checksum: response.headers.get('x-checksum') ?? undefined,
    signature: response.headers.get('x-signature') ?? undefined,
  };
}

export function toRequestError(error: unknown): LiveUpdateError {
  if (error instanceof LiveUpdateError) {
    return error;
  }
  if (isTimeoutError(error)) {
    return new LiveUpdateError(ErrorCode.HttpTimeout, 'Request timed out.');
  }
  return new LiveUpdateError(
    ErrorCode.DownloadFailed,
    'Bundle could not be downloaded.',
  );
}

export function isTimeoutError(error: unknown): boolean {
  if (typeof error !== 'object' || error === null) {
    return false;
  }
  const name = (error as { name?: string }).name;
  if (name === 'TimeoutError' || name === 'AbortError') {
    return true;
  }
  const cause = (error as { cause?: unknown }).cause;
  return cause !== undefined && cause !== error && isTimeoutError(cause);
}
