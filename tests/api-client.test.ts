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
    pluginVersion: '0.0.1',
    runtime: 'electron' as string | null,
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
    expect(params?.get('runtime')).toBe('electron');
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
      'runtime',
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
      runtime: null,
    });
    const params = server.requests[0]?.url.searchParams;
    expect(params?.has('bundleId')).toBe(false);
    expect(params?.has('channelName')).toBe(false);
    expect(params?.has('customId')).toBe(false);
    expect(params?.has('runtime')).toBe(false);
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

  describe('getChannels', () => {
    const channelsRequest = {
      appId: 'app-123',
      deviceId: 'device-1',
      limit: 50,
      offset: 0,
      query: null as string | null,
    };

    it('requests the channels with the exact protocol query parameters', async () => {
      server.route('/v1/apps/app-123/channels', {
        body: JSON.stringify([{ id: 'c1', name: 'production' }]),
      });
      const channels = await client.getChannels({
        ...channelsRequest,
        limit: 10,
        offset: 5,
        query: 'prod',
      });
      expect(channels).toEqual([{ id: 'c1', name: 'production' }]);
      const recorded = server.requests[0];
      expect(recorded?.url.pathname).toBe('/v1/apps/app-123/channels');
      const params = recorded?.url.searchParams;
      expect(params?.get('limit')).toBe('10');
      expect(params?.get('offset')).toBe('5');
      expect(params?.get('query')).toBe('prod');
      expect(recorded?.headers['x-capawesome-device-id']).toBe('device-1');
    });

    it('omits the query parameter when not provided', async () => {
      server.route('/v1/apps/app-123/channels', { body: '[]' });
      await client.getChannels(channelsRequest);
      const params = server.requests[0]?.url.searchParams;
      expect(params?.has('query')).toBe(false);
      expect(params?.get('limit')).toBe('50');
      expect(params?.get('offset')).toBe('0');
    });

    it('throws CHANNEL_DISCOVERY_NOT_ENABLED on 401', async () => {
      server.route('/v1/apps/app-123/channels', {
        body: 'unauthorized',
        status: 401,
      });
      await expect(client.getChannels(channelsRequest)).rejects.toMatchObject({
        code: ErrorCode.ChannelDiscoveryNotEnabled,
        message:
          'Unauthorized. Channel Discovery may not be enabled for this app.',
      });
    });

    it('throws on other non-2xx responses', async () => {
      server.route('/v1/apps/app-123/channels', {
        body: 'boom',
        status: 500,
      });
      await expect(client.getChannels(channelsRequest)).rejects.toMatchObject({
        code: ErrorCode.Unknown,
      });
    });

    it('ignores malformed channel entries', async () => {
      server.route('/v1/apps/app-123/channels', {
        body: JSON.stringify([
          { id: 'c1', name: 'production' },
          { id: 'c2' },
          'garbage',
          { name: 'no-id' },
        ]),
      });
      expect(await client.getChannels(channelsRequest)).toEqual([
        { id: 'c1', name: 'production' },
      ]);
    });
  });
});
