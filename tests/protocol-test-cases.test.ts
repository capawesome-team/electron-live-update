import { readFileSync } from 'node:fs';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
  CloudApiClient,
  type CreateCheckResponse,
} from '../src/engine/api-client';
import type { FailureReason } from '../src/engine/state-file';
import { buildFileUrl } from '../src/engine/verify';

import { MockServer } from './helpers';

// The cases of manifest.json are not run, because this SDK loads zip bundles only.

interface CheckRequestCase {
  expectedBody: Record<string, unknown>;
  input: {
    appVersionCode: string;
    appVersionName: string;
    bundleId: string | null;
    channelName: string | null;
    customId: string | null;
    deviceId: string;
    failure: { bundleId: string; reason: FailureReason } | null;
    osVersion: string;
    pluginVersion: string;
    runtime: string;
  };
  name: string;
}

interface CheckResponseCase {
  body?: unknown;
  expected?: unknown;
  expectedError?: string;
  name: string;
  rawBody?: string;
  retryAfter: string | null;
  statusCode: number;
}

interface UrlTemplateCase {
  checksum: string;
  expectedUrl: string;
  name: string;
  urlTemplate: string;
}

const APP_ID = 'app-1';
const CHECK_PATH = `/v1/live-updates/apps/${APP_ID}/checks`;

function readCases<T>(fileName: string): T[] {
  const url = new URL(`../protocol-test-cases/${fileName}`, import.meta.url);
  return JSON.parse(readFileSync(url, 'utf8')) as T[];
}

/**
 * The case files write a missing value as `null`.
 */
function toCaseShape(response: CreateCheckResponse): unknown {
  const bundle = response.bundle;
  return {
    ...response,
    bundle: bundle && {
      artifactType: bundle.artifactType,
      checksum: bundle.checksum ?? null,
      customProperties: bundle.customProperties ?? null,
      id: bundle.id,
      signature: bundle.signature ?? null,
      url: bundle.url,
      urlTemplate: bundle.urlTemplate ?? null,
    },
  };
}

describe('protocol test cases', () => {
  let server: MockServer;
  let client: CloudApiClient;

  beforeAll(async () => {
    server = new MockServer();
    await server.start();
    client = new CloudApiClient({
      httpTimeout: 5000,
      serverDomain: server.origin.replace('http://', ''),
      userAgent: 'capawesome-electron-live-update/0.0.1 (electron)',
    });
  });

  afterAll(async () => {
    await server.stop();
  });

  describe('check-request.json', () => {
    for (const testCase of readCases<CheckRequestCase>('check-request.json')) {
      it(testCase.name, async () => {
        server.route(CHECK_PATH, {
          body: JSON.stringify({ result: 'up_to_date', bundle: null }),
        });
        const { failure, ...input } = testCase.input;
        await client.fetchCheck({
          ...input,
          appId: APP_ID,
          failure: failure && { ...failure, appId: APP_ID },
        });
        const body: unknown = JSON.parse(server.requests.at(-1)?.body ?? '');
        // This SDK always sends the platform electron.
        expect(body).toEqual({
          ...testCase.expectedBody,
          platform: 'electron',
        });
      });
    }
  });

  describe('check-response.json', () => {
    for (const testCase of readCases<CheckResponseCase>(
      'check-response.json',
    )) {
      it(testCase.name, async () => {
        server.route(CHECK_PATH, {
          body: testCase.rawBody ?? JSON.stringify(testCase.body),
          headers:
            testCase.retryAfter === null
              ? {}
              : { 'Retry-After': testCase.retryAfter },
          status: testCase.statusCode,
        });
        const check = client.fetchCheck({
          appId: APP_ID,
          appVersionCode: '1',
          appVersionName: '1.0.0',
          bundleId: null,
          channelName: null,
          customId: null,
          deviceId: 'device-1',
          failure: null,
          osVersion: '25.0.0',
          pluginVersion: '0.0.1',
          runtime: 'electron',
        });
        if (testCase.expectedError !== undefined) {
          await expect(check).rejects.toMatchObject({
            code: testCase.expectedError,
          });
          return;
        }
        expect(toCaseShape(await check)).toEqual(testCase.expected);
      });
    }
  });

  describe('url-template.json', () => {
    for (const testCase of readCases<UrlTemplateCase>('url-template.json')) {
      it(testCase.name, () => {
        expect(
          buildFileUrl({
            checksum: testCase.checksum,
            urlTemplate: testCase.urlTemplate,
          }),
        ).toBe(testCase.expectedUrl);
      });
    }
  });
});
