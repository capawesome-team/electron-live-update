/**
 * Error codes that identify the reason a live update operation failed.
 *
 * Only an error that an app can handle in code carries one of these
 * codes. Every other {@link LiveUpdateError} has a message only.
 *
 * @since 0.1.0
 */
export enum ErrorCode {
  /**
   * A bundle with the given bundle identifier already exists.
   *
   * @since 0.1.0
   */
  BundleAlreadyExists = 'BUNDLE_ALREADY_EXISTS',
  /**
   * No bundle with the given bundle identifier exists.
   *
   * @since 0.1.0
   */
  BundleNotFound = 'BUNDLE_NOT_FOUND',
  /**
   * A request to the server failed. This happens if the device has no
   * connection, the request timed out, the server answered a check with
   * an error status or a bundle could not be downloaded.
   *
   * @since 0.2.0
   */
  RequestFailed = 'REQUEST_FAILED',
  /**
   * A sync operation is already in progress.
   *
   * @since 0.1.0
   */
  SyncInProgress = 'SYNC_IN_PROGRESS',
}

/**
 * Error thrown by all live update operations.
 *
 * @since 0.1.0
 */
export class LiveUpdateError extends Error {
  /**
   * The code identifying the reason the operation failed.
   *
   * Only set if the app can handle the error in code.
   *
   * @since 0.1.0
   */
  public readonly code?: ErrorCode;

  constructor(message: string, code?: ErrorCode) {
    super(message);
    this.name = 'LiveUpdateError';
    this.code = code;
  }
}

export function toLiveUpdateError(error: unknown): LiveUpdateError {
  if (error instanceof LiveUpdateError) {
    return error;
  }
  const message =
    error instanceof Error && error.message
      ? error.message
      : 'An unknown error has occurred.';
  return new LiveUpdateError(message);
}

export function toRequestError(error: unknown): LiveUpdateError {
  if (error instanceof LiveUpdateError) {
    return error;
  }
  if (isTimeoutError(error)) {
    return new LiveUpdateError('Request timed out.', ErrorCode.RequestFailed);
  }
  return new LiveUpdateError(
    getRequestErrorMessage(error),
    ErrorCode.RequestFailed,
  );
}

/**
 * Node's `fetch` rejects with the generic "fetch failed" and keeps the
 * reason, such as "getaddrinfo ENOTFOUND", in `cause`.
 */
function getRequestErrorMessage(error: unknown): string {
  const cause = error instanceof Error ? error.cause : undefined;
  if (cause instanceof Error && cause.message) {
    return cause.message;
  }
  if (error instanceof Error && error.message) {
    return error.message;
  }
  return 'An unknown error has occurred.';
}

function isTimeoutError(error: unknown): boolean {
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
