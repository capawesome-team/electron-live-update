import { isLocalhost } from './download';
import { ErrorCode, LiveUpdateError, toRequestError } from './errors';
import type { UpdateFailure } from './state-file';
import { CHECKSUM_PLACEHOLDER } from './verify';

/**
 * The platform that this SDK reports to Capawesome Cloud.
 */
export const PLATFORM = 'electron';

const DEFAULT_RETRY_AFTER_MS = 15 * 60 * 1000;
const MAX_RETRY_AFTER_SECONDS = 24 * 60 * 60;

export enum CheckResult {
  Available = 'available',
  Skipped = 'skipped',
  UpToDate = 'up_to_date',
}

export interface CreateCheckRequest {
  appId: string;
  appVersionCode: string;
  appVersionName: string;
  bundleId: string | null;
  channelName: string | null;
  customId: string | null;
  deviceId: string;
  failure: UpdateFailure | null;
  osVersion: string;
  pluginVersion: string;
  runtime: string;
}

/**
 * The answer of a check. `result` is `null` after a 429 and for an
 * answer that this version cannot read.
 */
export interface CreateCheckResponse {
  bundle: CreateCheckResponseBundle | null;
  channelName: string | null;
  /**
   * Why no bundle is offered, as the server sent it. Only set if the check was skipped.
   */
  reason: string | null;
  result: CheckResult | null;
  /**
   * The milliseconds to wait before the next check, only set after a 429.
   */
  retryAfterMs: number | null;
}

export interface CreateCheckResponseBundle {
  artifactType: 'manifest' | 'zip';
  /**
   * The checksum of the zip file, always set if the bundle has a URL template.
   */
  checksum?: string;
  customProperties?: { [key: string]: string };
  id: string;
  signature?: string;
  /**
   * The plain address of the bundle: `url`, or else `legacyUrl`.
   */
  url: string;
  urlTemplate?: string;
}

export interface GetChannelsRequest {
  appId: string;
  deviceId: string;
  limit: number;
  offset: number;
  query: string | null;
}

/**
 * A single channel returned by the Capawesome Cloud channels endpoint.
 */
export interface GetChannelsResponseItem {
  id: string;
  name: string;
}

/**
 * An HTTP response with its body read as text.
 */
interface TextResponse {
  headers: Headers;
  status: number;
  text: string;
}

export interface CloudApiClientOptions {
  httpTimeout: number;
  serverDomain: string;
  userAgent: string;
}

export function createCheckResponseWithoutUpdate(): CreateCheckResponse {
  return {
    bundle: null,
    channelName: null,
    reason: null,
    result: null,
    retryAfterMs: null,
  };
}

/**
 * HTTP client for the Capawesome Cloud Live Update API.
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
    return `${isLocalhost(hostname) ? 'http' : 'https'}://${serverDomain}`;
  }

  /**
   * Ask Capawesome Cloud for an update.
   *
   * Rejects with `REQUEST_FAILED` for every status other than 200 and 429.
   */
  public async fetchCheck(
    request: CreateCheckRequest,
  ): Promise<CreateCheckResponse> {
    const url = new URL(
      `${this.getBaseUrl()}/v1/live-updates/apps/${encodeURIComponent(request.appId)}/checks`,
    );
    // JSON.stringify leaves out every field that is undefined.
    const response = await this.post(url, {
      appVersionCode: request.appVersionCode,
      appVersionName: request.appVersionName,
      bundleId: request.bundleId ?? undefined,
      channelName: request.channelName ?? undefined,
      customId: request.customId ?? undefined,
      deviceId: request.deviceId,
      failure: request.failure
        ? {
            bundleId: request.failure.bundleId,
            reason: request.failure.reason,
          }
        : undefined,
      osVersion: request.osVersion,
      platform: PLATFORM,
      pluginVersion: request.pluginVersion,
      runtime: request.runtime,
    });
    return this.parseCheckResponse(response);
  }

  /**
   * Fetch the available channels for the app.
   *
   * Throws an error without a code on HTTP 401 (public channels not
   * enabled), mirroring the `@capawesome/capacitor-live-update`
   * plugin behavior.
   */
  public async getChannels(
    request: GetChannelsRequest,
  ): Promise<GetChannelsResponseItem[]> {
    const url = new URL(
      `${this.getBaseUrl()}/v1/apps/${encodeURIComponent(request.appId)}/channels`,
    );
    this.appendQueryParameter(url, 'limit', String(request.limit));
    this.appendQueryParameter(url, 'offset', String(request.offset));
    this.appendQueryParameter(url, 'query', request.query);
    const response = await this.request(url, request.deviceId);
    if (response.status === 401) {
      throw new LiveUpdateError(
        'Unauthorized. Channel Discovery may not be enabled for this app.',
      );
    }
    if (!response.ok) {
      throw new LiveUpdateError(
        `Request failed with status code ${response.status}.`,
        ErrorCode.RequestFailed,
      );
    }
    return this.parseChannelsResponse(response.json);
  }

  /**
   * Send a GET request. The JSON body is only parsed for 2xx responses.
   */
  private async request(
    url: URL,
    deviceId: string,
  ): Promise<{ json: unknown; ok: boolean; status: number }> {
    try {
      const response = await fetch(url, {
        headers: {
          'User-Agent': this.options.userAgent,
          'X-Capawesome-Device-Id': deviceId,
        },
        signal: AbortSignal.timeout(this.options.httpTimeout),
      });
      const json: unknown = response.ok ? await response.json() : null;
      return { json, ok: response.ok, status: response.status };
    } catch (error) {
      if (error instanceof SyntaxError) {
        // The server sent an invalid body.
        throw new LiveUpdateError('An unknown error has occurred.');
      }
      throw toRequestError(error);
    }
  }

  /**
   * Send a POST request with a JSON body and read the answer as text.
   */
  private async post(url: URL, body: object): Promise<TextResponse> {
    try {
      const response = await fetch(url, {
        body: JSON.stringify(body),
        headers: {
          'Content-Type': 'application/json',
          'User-Agent': this.options.userAgent,
        },
        method: 'POST',
        signal: AbortSignal.timeout(this.options.httpTimeout),
      });
      const text = await response.text();
      return { headers: response.headers, status: response.status, text };
    } catch (error) {
      throw toRequestError(error);
    }
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

  private parseChannelsResponse(json: unknown): GetChannelsResponseItem[] {
    if (!Array.isArray(json)) {
      return [];
    }
    const channels: GetChannelsResponseItem[] = [];
    for (const entry of json) {
      if (typeof entry !== 'object' || entry === null) {
        continue;
      }
      const record = entry as Record<string, unknown>;
      if (typeof record.id === 'string' && typeof record.name === 'string') {
        channels.push({ id: record.id, name: record.name });
      }
    }
    return channels;
  }

  private parseCheckResponse(response: TextResponse): CreateCheckResponse {
    if (response.status === 429) {
      return {
        ...createCheckResponseWithoutUpdate(),
        retryAfterMs: this.parseRetryAfterMs(
          response.headers.get('retry-after'),
        ),
      };
    }
    if (response.status !== 200) {
      throw new LiveUpdateError(
        `Request failed with status code ${response.status}.`,
        ErrorCode.RequestFailed,
      );
    }
    return this.parseCheckResponseBody(response.text);
  }

  private parseCheckResponseBody(text: string): CreateCheckResponse {
    let json: unknown;
    try {
      json = JSON.parse(text);
    } catch {
      return createCheckResponseWithoutUpdate();
    }
    if (typeof json !== 'object' || json === null) {
      return createCheckResponseWithoutUpdate();
    }
    const record = json as Record<string, unknown>;
    const result = Object.values(CheckResult).find(
      value => value === record.result,
    );
    if (result === undefined) {
      return createCheckResponseWithoutUpdate();
    }
    const bundle =
      result === CheckResult.Skipped
        ? null
        : this.parseCheckResponseBundle(record.bundle);
    if (result === CheckResult.Available && bundle === null) {
      return createCheckResponseWithoutUpdate();
    }
    return {
      bundle,
      channelName: getNonEmptyString(record, 'channelName'),
      reason:
        result === CheckResult.Skipped
          ? getNonEmptyString(record, 'reason')
          : null,
      result,
      retryAfterMs: null,
    };
  }

  /**
   * Returns `null` if a needed field is missing, the URL template
   * cannot be used or the artifact type is unknown.
   */
  private parseCheckResponseBundle(
    json: unknown,
  ): CreateCheckResponseBundle | null {
    if (typeof json !== 'object' || json === null) {
      return null;
    }
    const record = json as Record<string, unknown>;
    const artifactType = getNonEmptyString(record, 'artifactType');
    const checksum = getNonEmptyString(record, 'checksum');
    const id = getNonEmptyString(record, 'id');
    const url =
      getNonEmptyString(record, 'url') ??
      getNonEmptyString(record, 'legacyUrl');
    const urlTemplate = getNonEmptyString(record, 'urlTemplate');
    if (
      (artifactType !== 'manifest' && artifactType !== 'zip') ||
      id === null ||
      url === null
    ) {
      return null;
    }
    if (
      urlTemplate !== null &&
      (checksum === null || !urlTemplate.includes(CHECKSUM_PLACEHOLDER))
    ) {
      return null;
    }
    return {
      artifactType,
      checksum: checksum ?? undefined,
      customProperties: parseCustomProperties(record.customProperties),
      id,
      signature: getNonEmptyString(record, 'signature') ?? undefined,
      url,
      urlTemplate: urlTemplate ?? undefined,
    };
  }

  /**
   * Only a whole number of seconds that is not negative is read.
   * Every other value waits the default time.
   */
  private parseRetryAfterMs(header: string | null): number {
    if (header === null || !/^[0-9]+$/.test(header)) {
      return DEFAULT_RETRY_AFTER_MS;
    }
    return Math.min(Number(header), MAX_RETRY_AFTER_SECONDS) * 1000;
  }
}

function getNonEmptyString(
  record: Record<string, unknown>,
  name: string,
): string | null {
  const value = record[name];
  return typeof value === 'string' && value !== '' ? value : null;
}

function parseCustomProperties(
  json: unknown,
): { [key: string]: string } | undefined {
  if (typeof json !== 'object' || json === null) {
    return undefined;
  }
  const customProperties: { [key: string]: string } = {};
  for (const [key, value] of Object.entries(json)) {
    if (typeof value === 'string') {
      customProperties[key] = value;
    }
  }
  return Object.keys(customProperties).length > 0
    ? customProperties
    : undefined;
}
