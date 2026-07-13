/**
 * Mock Capawesome Cloud server for the example app and the e2e suite.
 *
 * Speaks the Live Update protocol:
 * - GET  /v1/apps/{appId}/bundles/latest  -> latest bundle JSON or 404
 * - GET  /v1/apps/{appId}/channels        -> list of channels (or 401 when
 *                                            CHANNELS_DISABLED is set)
 * - GET  /download/{file}                 -> zip bytes with X-Checksum
 *                                            and X-Signature headers
 * - GET  /manifest/{bundleId}?href=<href> -> the manifest JSON (delta)
 *                                            or a single file with its
 *                                            X-Checksum / X-Signature headers
 * - POST /__control                       -> {"latest": "<bundleId>" | null}
 *                                            switches the offered bundle
 *
 * The offered bundle can also be set via the LATEST env variable.
 */
import { createHash, createSign } from 'node:crypto';
import { existsSync } from 'node:fs';
import { readFile, readdir } from 'node:fs/promises';
import { createServer } from 'node:http';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const exampleDirectory = dirname(dirname(fileURLToPath(import.meta.url)));
const bundlesDirectory = join(exampleDirectory, 'dist', 'bundles');
const keysDirectory = join(exampleDirectory, 'dist', 'keys');
const port = Number(process.env.MOCK_SERVER_PORT ?? 4100);

const MANIFEST_FILE_NAME = 'capawesome-live-update-manifest.json';

const bundles = JSON.parse(
  await readFile(join(bundlesDirectory, 'index.json'), 'utf8'),
);
let latestBundleId = process.env.LATEST ?? null;

const privateKeyPath = join(keysDirectory, 'private.pem');
const privateKeyPem = existsSync(privateKeyPath)
  ? await readFile(privateKeyPath, 'utf8')
  : null;

// Manifest (delta) bundles are served directly from a source directory
// of web assets; the manifest itself is generated on the fly.
const manifestBundles = {
  '4.0.0-manifest': join(exampleDirectory, 'dist', 'bundle-2.0.0'),
};

const channels = [
  { id: 'a1b2c3d4-0000-0000-0000-000000000001', name: 'production' },
  { id: 'a1b2c3d4-0000-0000-0000-000000000002', name: 'beta' },
  { id: 'a1b2c3d4-0000-0000-0000-000000000003', name: 'canary' },
];

function checksum(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

function sign(bytes) {
  if (!privateKeyPem) {
    return null;
  }
  const signer = createSign('RSA-SHA256');
  signer.update(bytes);
  return signer.sign(privateKeyPem).toString('base64');
}

async function listFiles(directory) {
  const files = [];
  const walk = async current => {
    for (const entry of await readdir(current, { withFileTypes: true })) {
      const entryPath = join(current, entry.name);
      if (entry.isDirectory()) {
        await walk(entryPath);
      } else if (entry.isFile()) {
        files.push({
          absolutePath: entryPath,
          href: relative(directory, entryPath).split('\\').join('/'),
        });
      }
    }
  };
  await walk(directory);
  return files;
}

async function buildManifest(directory) {
  const files = await listFiles(directory);
  return Promise.all(
    files.map(async file => {
      const bytes = await readFile(file.absolutePath);
      return {
        checksum: checksum(bytes),
        href: file.href,
        sizeInBytes: bytes.length,
      };
    }),
  );
}

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
    if (latestBundleId && manifestBundles[latestBundleId]) {
      sendJson(response, 200, {
        artifactType: 'manifest',
        bundleId: latestBundleId,
        url: `http://localhost:${port}/manifest/${latestBundleId}`,
      });
      return;
    }
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
  if (request.method === 'GET' && url.pathname.startsWith('/manifest/')) {
    const bundleId = decodeURIComponent(
      url.pathname.slice('/manifest/'.length),
    );
    const sourceDirectory = manifestBundles[bundleId];
    if (!sourceDirectory || !existsSync(sourceDirectory)) {
      response.statusCode = 404;
      response.end('Not found');
      return;
    }
    const href = url.searchParams.get('href');
    if (href === MANIFEST_FILE_NAME) {
      sendJson(response, 200, await buildManifest(sourceDirectory));
      return;
    }
    const files = await listFiles(sourceDirectory);
    const file = files.find(entry => entry.href === href);
    if (!file) {
      response.statusCode = 404;
      response.end('Not found');
      return;
    }
    const bytes = await readFile(file.absolutePath);
    response.setHeader('X-Checksum', checksum(bytes));
    const signature = sign(bytes);
    if (signature) {
      response.setHeader('X-Signature', signature);
    }
    response.end(bytes);
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
