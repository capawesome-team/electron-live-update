/**
 * Error codes that identify the reason a live update operation failed.
 *
 * Every error thrown by this SDK is a {@link LiveUpdateError} carrying
 * one of these codes.
 *
 * @since 0.1.0
 */
export enum ErrorCode {
  /**
   * The `appId` option must be configured for this operation.
   *
   * @since 0.1.0
   */
  AppIdMissing = 'APP_ID_MISSING',
  /**
   * The requested artifact type is not supported.
   *
   * @since 0.1.0
   */
  ArtifactTypeNotSupported = 'ARTIFACT_TYPE_NOT_SUPPORTED',
  /**
   * A bundle with the given bundle identifier already exists.
   *
   * @since 0.1.0
   */
  BundleAlreadyExists = 'BUNDLE_ALREADY_EXISTS',
  /**
   * The given bundle identifier is not allowed.
   *
   * @since 0.1.0
   */
  BundleIdInvalid = 'BUNDLE_ID_INVALID',
  /**
   * The `bundleId` option must be provided.
   *
   * @since 0.1.0
   */
  BundleIdMissing = 'BUNDLE_ID_MISSING',
  /**
   * The bundle does not contain an `index.html` file.
   *
   * @since 0.1.0
   */
  BundleIndexHtmlMissing = 'BUNDLE_INDEX_HTML_MISSING',
  /**
   * No bundle with the given bundle identifier exists.
   *
   * @since 0.1.0
   */
  BundleNotFound = 'BUNDLE_NOT_FOUND',
  /**
   * The checksum of the bundle could not be calculated.
   *
   * @since 0.1.0
   */
  ChecksumCalculationFailed = 'CHECKSUM_CALCULATION_FAILED',
  /**
   * The checksum of the bundle does not match the expected checksum.
   *
   * @since 0.1.0
   */
  ChecksumMismatch = 'CHECKSUM_MISMATCH',
  /**
   * The `customId` option must be provided.
   *
   * @since 0.1.0
   */
  CustomIdMissing = 'CUSTOM_ID_MISSING',
  /**
   * The bundle could not be downloaded.
   *
   * @since 0.1.0
   */
  DownloadFailed = 'DOWNLOAD_FAILED',
  /**
   * An HTTP request exceeded the configured `httpTimeout`.
   *
   * @since 0.1.0
   */
  HttpTimeout = 'HTTP_TIMEOUT',
  /**
   * The download URL uses an insecure protocol.
   *
   * Bundles must be downloaded via HTTPS. Plain HTTP is only
   * allowed for localhost during development.
   *
   * @since 0.1.0
   */
  InsecureUrl = 'INSECURE_URL',
  /**
   * The engine has not been initialized yet.
   *
   * @since 0.1.0
   */
  NotInitialized = 'NOT_INITIALIZED',
  /**
   * The configured `publicKey` is not a valid PEM-encoded RSA public key.
   *
   * @since 0.1.0
   */
  PublicKeyInvalid = 'PUBLIC_KEY_INVALID',
  /**
   * A `publicKey` is configured but the bundle does not provide a signature.
   *
   * @since 0.1.0
   */
  SignatureMissing = 'SIGNATURE_MISSING',
  /**
   * The signature of the bundle could not be verified with the
   * configured `publicKey`.
   *
   * @since 0.1.0
   */
  SignatureVerificationFailed = 'SIGNATURE_VERIFICATION_FAILED',
  /**
   * A sync operation is already in progress.
   *
   * @since 0.1.0
   */
  SyncInProgress = 'SYNC_IN_PROGRESS',
  /**
   * An unknown error has occurred.
   *
   * @since 0.1.0
   */
  Unknown = 'UNKNOWN',
  /**
   * The `url` option must be provided.
   *
   * @since 0.1.0
   */
  UrlMissing = 'URL_MISSING',
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
   * @since 0.1.0
   */
  public readonly code: ErrorCode;

  constructor(code: ErrorCode, message: string) {
    super(message);
    this.name = 'LiveUpdateError';
    this.code = code;
  }
}

export function unknownError(error: unknown): LiveUpdateError {
  if (error instanceof LiveUpdateError) {
    return error;
  }
  const message =
    error instanceof Error && error.message
      ? error.message
      : 'An unknown error has occurred.';
  return new LiveUpdateError(ErrorCode.Unknown, message);
}
