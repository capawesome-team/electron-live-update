import type { ArtifactType } from './definitions';
import { isTimeoutError } from './download';
import { ErrorCode, LiveUpdateError } from './errors';

/**
 * Response of the Capawesome Cloud latest-bundle endpoint.
 */
export interface GetLatestBundleResponse {
  artifactType: ArtifactType;
  bundleId: string;
  channelName?: string;
  checksum?: string;
  customProperties?: { [key: string]: string };
  signature?: string;
  url: string;
}

export interface FetchLatestBundleRequest {
  appId: string;
  appVersionCode: string;
  appVersionName: string;
  bundleId: string | null;
  channelName: string | null;
  customId: string | null;
  deviceId: string;
  osVersion: string;
  platform: string;
  runtime: string | null;
  sdkVersion: string;
}

export interface CloudApiClientOptions {
  httpTimeout: number;
  serverDomain: string;
}

/**
 * HTTP client for the Capawesome Cloud Live Update API.
 *
 * Speaks the exact protocol of the `@capawesome/capacitor-live-update`
 * plugin: same endpoint, same query parameters, same headers.
 */
export class CloudApiClient {
  private readonly options: CloudApiClientOptions;

  constructor(options: CloudApiClientOptions) {
    this.options = options;
  }

  /**
   * The base URL of the API server. Always `https`, except for
   * localhost server domains, which are allowed to use plain `http`
   * for development against a local server.
   */
  private getBaseUrl(): string {
    const serverDomain = this.options.serverDomain;
    let hostname: string;
    try {
      hostname = new URL(`https://${serverDomain}`).hostname;
    } catch {
      hostname = serverDomain;
    }
    const isLocalhost =
      hostname === 'localhost' ||
      hostname === '127.0.0.1' ||
      hostname === '[::1]' ||
      hostname.endsWith('.localhost');
    return `${isLocalhost ? 'http' : 'https'}://${serverDomain}`;
  }

  /**
   * Fetch the latest bundle for the app.
   *
   * Returns `null` if no bundle is available. Any non-2xx response is
   * treated as "no bundle available", matching the plugin behavior.
   * Timeouts are surfaced as errors.
   */
  public async getLatestBundle(
    request: FetchLatestBundleRequest,
  ): Promise<GetLatestBundleResponse | null> {
    const url = new URL(
      `${this.getBaseUrl()}/v1/apps/${encodeURIComponent(request.appId)}/bundles/latest`,
    );
    this.appendQueryParameter(url, 'appVersionCode', request.appVersionCode);
    this.appendQueryParameter(url, 'appVersionName', request.appVersionName);
    this.appendQueryParameter(url, 'bundleId', request.bundleId);
    this.appendQueryParameter(url, 'channelName', request.channelName);
    this.appendQueryParameter(url, 'customId', request.customId);
    this.appendQueryParameter(url, 'deviceId', request.deviceId);
    this.appendQueryParameter(url, 'osVersion', request.osVersion);
    this.appendQueryParameter(url, 'platform', request.platform);
    this.appendQueryParameter(url, 'pluginVersion', request.sdkVersion);
    this.appendQueryParameter(url, 'runtime', request.runtime);
    let response: Response;
    try {
      response = await fetch(url, {
        headers: {
          'X-Capawesome-Device-Id': request.deviceId,
        },
        signal: AbortSignal.timeout(this.options.httpTimeout),
      });
    } catch (error) {
      if (isTimeoutError(error)) {
        throw new LiveUpdateError(ErrorCode.HttpTimeout, 'Request timed out.');
      }
      // Network errors mean no update is available right now.
      return null;
    }
    if (!response.ok) {
      return null;
    }
    let json: unknown;
    try {
      json = await response.json();
    } catch {
      throw new LiveUpdateError(
        ErrorCode.Unknown,
        'An unknown error has occurred.',
      );
    }
    return this.parseLatestBundleResponse(json);
  }

  private appendQueryParameter(
    url: URL,
    name: string,
    value: string | null,
  ): void {
    if (value !== null && value !== undefined) {
      url.searchParams.append(name, value);
    }
  }

  private parseLatestBundleResponse(
    json: unknown,
  ): GetLatestBundleResponse | null {
    if (typeof json !== 'object' || json === null) {
      return null;
    }
    const record = json as Record<string, unknown>;
    if (typeof record.bundleId !== 'string' || typeof record.url !== 'string') {
      return null;
    }
    const customProperties: { [key: string]: string } = {};
    if (
      typeof record.customProperties === 'object' &&
      record.customProperties !== null
    ) {
      for (const [key, value] of Object.entries(
        record.customProperties as Record<string, unknown>,
      )) {
        if (typeof value === 'string') {
          customProperties[key] = value;
        }
      }
    }
    return {
      artifactType: record.artifactType === 'manifest' ? 'manifest' : 'zip',
      bundleId: record.bundleId,
      channelName:
        typeof record.channelName === 'string' ? record.channelName : undefined,
      checksum:
        typeof record.checksum === 'string' ? record.checksum : undefined,
      customProperties:
        Object.keys(customProperties).length > 0 ? customProperties : undefined,
      signature:
        typeof record.signature === 'string' ? record.signature : undefined,
      url: record.url,
    };
  }
}
