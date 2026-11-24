import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  CloudApiClient,
  type CreateCheckRequest,
} from '../src/engine/api-client';
import { ErrorCode } from '../src/engine/errors';
import { FailureReason } from '../src/engine/state-file';

import { MockServer } from './helpers';

const USER_AGENT = 'capawesome-electron-live-update/0.0.1 (electron)';

describe('CloudApiClient', () => {
  let server: MockServer;
  let client: CloudApiClient;

  const request: CreateCheckRequest = {
    appId: 'app-123',
    appVersionCode: '42',
    appVersionName: '1.2.3',
    bundleId: '1.0.0',
    channelName: 'production',
    customId: 'user-1',
    deviceId: 'device-1',
    failure: null,
    osVersion: '25.5.0',
    pluginVersion: '0.0.1',
    runtime: 'electron',
  };

  function createClient(options: { httpTimeout: number; origin: string }) {
    return new CloudApiClient({
      httpTimeout: options.httpTimeout,
      serverDomain: options.origin.replace('http://', ''),
      userAgent: USER_AGENT,
    });
  }

  beforeEach(async () => {
    server = new MockServer();
    await server.start();
    client = createClient({ httpTimeout: 5000, origin: server.origin });
  });

  afterEach(async () => {
    await server.stop();
  });

  describe('fetchCheck', () => {
    it('posts the check with the user agent and without the device id header', async () => {
      server.route('/v1/live-updates/apps/app-123/checks', {
        body: JSON.stringify({ result: 'up_to_date', bundle: null }),
      });
      await client.fetchCheck({
        ...request,
        failure: {
          appId: 'app-123',
          bundleId: '0.9.0',
          reason: FailureReason.DownloadFailed,
        },
      });
      const recorded = server.requests[0];
      expect(recorded?.method).toBe('POST');
      expect(recorded?.headers['content-type']).toBe('application/json');
      expect(recorded?.headers['user-agent']).toBe(USER_AGENT);
      expect(recorded?.headers['x-capawesome-device-id']).toBeUndefined();
      expect(JSON.parse(recorded?.body ?? '').failure).toEqual({
        bundleId: '0.9.0',
        reason: 'download_failed',
      });
    });

    it('rejects with REQUEST_FAILED and the reason on network errors', async () => {
      const stoppedServer = new MockServer();
      await stoppedServer.start();
      await stoppedServer.stop();
      const unreachableClient = createClient({
        httpTimeout: 5000,
        origin: stoppedServer.origin,
      });
      await expect(unreachableClient.fetchCheck(request)).rejects.toMatchObject(
        {
          code: ErrorCode.RequestFailed,
          message: expect.stringContaining('ECONNREFUSED'),
        },
      );
    });

    it('rejects with REQUEST_FAILED when the request times out', async () => {
      server.route('/v1/live-updates/apps/app-123/checks', () => null);
      const slowClient = createClient({
        httpTimeout: 200,
        origin: server.origin,
      });
      await expect(slowClient.fetchCheck(request)).rejects.toMatchObject({
        code: ErrorCode.RequestFailed,
        message: 'Request timed out.',
      });
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
      expect(recorded?.headers['user-agent']).toBe(USER_AGENT);
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

    it('throws without a code on 401', async () => {
      server.route('/v1/apps/app-123/channels', {
        body: 'unauthorized',
        status: 401,
      });
      await expect(client.getChannels(channelsRequest)).rejects.toMatchObject({
        code: undefined,
        message:
          'Unauthorized. Channel Discovery may not be enabled for this app.',
      });
    });

    it('throws REQUEST_FAILED on other non-2xx responses', async () => {
      server.route('/v1/apps/app-123/channels', {
        body: 'boom',
        status: 500,
      });
      await expect(client.getChannels(channelsRequest)).rejects.toMatchObject({
        code: ErrorCode.RequestFailed,
        message: 'Request failed with status code 500.',
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
