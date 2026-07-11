import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { CloudApiClient } from '../src/engine/api-client';
import { ErrorCode } from '../src/engine/errors';

import { MockServer } from './helpers';

describe('CloudApiClient', () => {
  let server: MockServer;
  let client: CloudApiClient;

  const request = {
    appId: 'app-123',
    appVersionCode: '42',
    appVersionName: '1.2.3',
    bundleId: '1.0.0' as string | null,
    channelName: 'production' as string | null,
    customId: 'user-1' as string | null,
    deviceId: 'device-1',
    osVersion: '25.5.0',
    platform: '2',
    sdkVersion: '0.0.1',
  };

  beforeEach(async () => {
    server = new MockServer();
    await server.start();
    client = new CloudApiClient({
      httpTimeout: 5000,
      serverDomain: server.origin.replace('http://', ''),
    });
  });

  afterEach(async () => {
    await server.stop();
  });

  it('requests the latest bundle with the exact protocol query parameters', async () => {
    server.route('/v1/apps/app-123/bundles/latest', {
      body: JSON.stringify({
        bundleId: '1.1.0',
        url: 'https://example.com/bundle.zip',
      }),
      headers: { 'Content-Type': 'application/json' },
    });
    await client.getLatestBundle(request);
    expect(server.requests).toHaveLength(1);
    const recorded = server.requests[0];
    expect(recorded?.url.pathname).toBe('/v1/apps/app-123/bundles/latest');
    const params = recorded?.url.searchParams;
    expect(params?.get('appVersionCode')).toBe('42');
    expect(params?.get('appVersionName')).toBe('1.2.3');
    expect(params?.get('bundleId')).toBe('1.0.0');
    expect(params?.get('channelName')).toBe('production');
    expect(params?.get('customId')).toBe('user-1');
    expect(params?.get('deviceId')).toBe('device-1');
    expect(params?.get('osVersion')).toBe('25.5.0');
    expect(params?.get('platform')).toBe('2');
    expect(params?.get('pluginVersion')).toBe('0.0.1');
    expect([...(params?.keys() ?? [])].sort()).toEqual([
      'appVersionCode',
      'appVersionName',
      'bundleId',
      'channelName',
      'customId',
      'deviceId',
      'osVersion',
      'platform',
      'pluginVersion',
    ]);
    expect(recorded?.headers['x-capawesome-device-id']).toBe('device-1');
  });

  it('omits null query parameters', async () => {
    server.route('/v1/apps/app-123/bundles/latest', {
      body: JSON.stringify({
        bundleId: '1.1.0',
        url: 'https://example.com/bundle.zip',
      }),
    });
    await client.getLatestBundle({
      ...request,
      bundleId: null,
      channelName: null,
      customId: null,
    });
    const params = server.requests[0]?.url.searchParams;
    expect(params?.has('bundleId')).toBe(false);
    expect(params?.has('channelName')).toBe(false);
    expect(params?.has('customId')).toBe(false);
  });

  it('parses the full response', async () => {
    server.route('/v1/apps/app-123/bundles/latest', {
      body: JSON.stringify({
        artifactType: 'zip',
        bundleId: '1.1.0',
        channelName: 'beta',
        checksum: 'abc',
        customProperties: { key: 'value' },
        signature: 'sig',
        url: 'https://example.com/bundle.zip',
      }),
    });
    const response = await client.getLatestBundle(request);
    expect(response).toEqual({
      artifactType: 'zip',
      bundleId: '1.1.0',
      channelName: 'beta',
      checksum: 'abc',
      customProperties: { key: 'value' },
      signature: 'sig',
      url: 'https://example.com/bundle.zip',
    });
  });

  it('treats unknown artifact types as zip', async () => {
    server.route('/v1/apps/app-123/bundles/latest', {
      body: JSON.stringify({
        bundleId: '1.1.0',
        url: 'https://example.com/b.zip',
        artifactType: 'something',
      }),
    });
    const response = await client.getLatestBundle(request);
    expect(response?.artifactType).toBe('zip');
  });

  it('returns null on 404', async () => {
    server.route('/v1/apps/app-123/bundles/latest', {
      body: 'not found',
      status: 404,
    });
    expect(await client.getLatestBundle(request)).toBeNull();
  });

  it('returns null on server errors', async () => {
    server.route('/v1/apps/app-123/bundles/latest', {
      body: 'boom',
      status: 500,
    });
    expect(await client.getLatestBundle(request)).toBeNull();
  });

  it('returns null on network errors', async () => {
    await server.stop();
    const unreachableClient = new CloudApiClient({
      httpTimeout: 5000,
      serverDomain: '127.0.0.1:1',
    });
    expect(await unreachableClient.getLatestBundle(request)).toBeNull();
    await server.start();
  });

  it('throws HTTP_TIMEOUT when the request times out', async () => {
    server.route('/v1/apps/app-123/bundles/latest', () => null);
    const slowClient = new CloudApiClient({
      httpTimeout: 200,
      serverDomain: server.origin.replace('http://', ''),
    });
    await expect(slowClient.getLatestBundle(request)).rejects.toMatchObject({
      code: ErrorCode.HttpTimeout,
      message: 'Request timed out.',
    });
  });

  it('throws on a malformed JSON body', async () => {
    server.route('/v1/apps/app-123/bundles/latest', { body: 'not json' });
    await expect(client.getLatestBundle(request)).rejects.toMatchObject({
      code: ErrorCode.Unknown,
    });
  });
});
