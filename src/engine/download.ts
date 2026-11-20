import { createWriteStream } from 'node:fs';
import { Writable } from 'node:stream';
import { pipeline } from 'node:stream/promises';

import { ErrorCode, LiveUpdateError, toRequestError } from './errors';

const LOCALHOST_HOSTNAMES = new Set(['localhost', '127.0.0.1', '[::1]']);

/**
 * Whether the hostname refers to the local machine. Plain HTTP is
 * allowed for these hosts so that development against a local server
 * keeps working.
 */
export function isLocalhost(hostname: string): boolean {
  return LOCALHOST_HOSTNAMES.has(hostname) || hostname.endsWith('.localhost');
}

/**
 * Enforce HTTPS-only downloads. Plain HTTP is allowed for localhost
 * only, so that development against a local server keeps working.
 */
export function assertSecureUrl(url: string): URL {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new LiveUpdateError('url must be provided.');
  }
  if (parsed.protocol === 'https:') {
    return parsed;
  }
  if (parsed.protocol === 'http:' && isLocalhost(parsed.hostname)) {
    return parsed;
  }
  throw new LiveUpdateError(
    'Bundles must be downloaded via HTTPS. Plain HTTP is only allowed for localhost.',
  );
}

export interface DownloadFileOptions {
  destinationPath: string;
  httpTimeout: number;
  onProgress?: (downloadedBytes: number, totalBytes: number) => void;
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
 *
 * `httpTimeout` is an idle timeout: it limits the wait for the
 * response headers and for every body chunk, not the total transfer.
 */
export async function downloadFile(
  options: DownloadFileOptions,
): Promise<DownloadFileResult> {
  const url = assertSecureUrl(options.url);
  const controller = new AbortController();
  let idleTimer: NodeJS.Timeout | undefined;
  const resetIdleTimer = () => {
    clearTimeout(idleTimer);
    idleTimer = setTimeout(
      () =>
        controller.abort(
          new DOMException('Request timed out.', 'TimeoutError'),
        ),
      options.httpTimeout,
    );
  };
  resetIdleTimer();
  try {
    let response: Response;
    try {
      response = await fetch(url, { signal: controller.signal });
    } catch (error) {
      throw toRequestError(error);
    }
    if (!response.ok || !response.body) {
      throw new LiveUpdateError(
        'Bundle could not be downloaded.',
        ErrorCode.RequestFailed,
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
          resetIdleTimer();
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
  } finally {
    clearTimeout(idleTimer);
  }
}
