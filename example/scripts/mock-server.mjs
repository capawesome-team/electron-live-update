/**
 * Mock Capawesome Cloud server for the example app and the e2e suite.
 *
 * Speaks the Live Update protocol:
 * - GET  /v1/apps/{appId}/bundles/latest  -> latest bundle JSON or 404
 * - GET  /v1/apps/{appId}/channels        -> list of channels (or 401 when
 *                                            CHANNELS_DISABLED is set)
 * - GET  /download/{file}                 -> zip bytes with X-Checksum
 *                                            and X-Signature headers
 * - POST /__control                       -> {"latest": "<bundleId>" | null}
 *                                            switches the offered bundle
 *
 * The offered bundle can also be set via the LATEST env variable.
 */
import { readFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const exampleDirectory = dirname(dirname(fileURLToPath(import.meta.url)));
const bundlesDirectory = join(exampleDirectory, 'dist', 'bundles');
const port = Number(process.env.MOCK_SERVER_PORT ?? 4100);

const bundles = JSON.parse(
  await readFile(join(bundlesDirectory, 'index.json'), 'utf8'),
);
let latestBundleId = process.env.LATEST ?? null;

const channels = [
  { id: 'a1b2c3d4-0000-0000-0000-000000000001', name: 'production' },
  { id: 'a1b2c3d4-0000-0000-0000-000000000002', name: 'beta' },
  { id: 'a1b2c3d4-0000-0000-0000-000000000003', name: 'canary' },
];

function sendJson(response, status, payload) {
  response.statusCode = status;
  response.setHeader('Content-Type', 'application/json');
  response.end(JSON.stringify(payload));
}

const server = createServer(async (request, response) => {
  const url = new URL(request.url ?? '/', `http://localhost:${port}`);
  console.log(`[mock-server] ${request.method} ${url.pathname}${url.search}`);
  if (request.method === 'POST' && url.pathname === '/__control') {
    let body = '';
    for await (const chunk of request) {
      body += chunk;
    }
    latestBundleId = JSON.parse(body).latest ?? null;
    response.end(JSON.stringify({ latest: latestBundleId }));
    return;
  }
  if (
    request.method === 'GET' &&
    /^\/v1\/apps\/[^/]+\/channels$/.test(url.pathname)
  ) {
    if (process.env.CHANNELS_DISABLED) {
      response.statusCode = 401;
      response.end(
        JSON.stringify({
          message:
            'Unauthorized. Channel Discovery may not be enabled for this app.',
        }),
      );
      return;
    }
    const limit = Number(url.searchParams.get('limit') ?? 50);
    const offset = Number(url.searchParams.get('offset') ?? 0);
    const query = url.searchParams.get('query');
    const filtered = channels.filter(channel =>
      query ? channel.name.includes(query) : true,
    );
    sendJson(response, 200, filtered.slice(offset, offset + limit));
    return;
  }
  if (
    request.method === 'GET' &&
    /^\/v1\/apps\/[^/]+\/bundles\/latest$/.test(url.pathname)
  ) {
    const bundle =
      latestBundleId === null ? undefined : bundles[latestBundleId];
    if (!bundle) {
      sendJson(response, 404, { message: 'No bundle available.' });
      return;
    }
    sendJson(response, 200, {
      artifactType: 'zip',
      bundleId: latestBundleId,
      url: `http://localhost:${port}/download/${bundle.file}`,
    });
    return;
  }
  if (request.method === 'GET' && url.pathname.startsWith('/download/')) {
    const file = url.pathname.slice('/download/'.length);
    const entry = Object.values(bundles).find(bundle => bundle.file === file);
    if (!entry) {
      response.statusCode = 404;
      response.end('Not found');
      return;
    }
    response.setHeader('Content-Type', 'application/zip');
    response.setHeader('X-Checksum', entry.checksum);
    response.setHeader('X-Signature', entry.signature);
    response.end(await readFile(join(bundlesDirectory, file)));
    return;
  }
  response.statusCode = 404;
  response.end('Not found');
});

server.listen(port, () => {
  console.log(
    `[mock-server] listening on http://localhost:${port} (latest: ${latestBundleId ?? 'none'})`,
  );
});
