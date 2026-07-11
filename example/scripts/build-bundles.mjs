/**
 * Build the live update bundles used by the example app and the e2e
 * suite:
 *
 * - `2.0.0`         a good bundle (the renderer built with a new marker)
 * - `3.0.0-broken`  a deliberately broken bundle that never calls ready()
 * - `2.0.0-evil`    a valid zip served with the signature of `2.0.0`
 *                   (tampered content, must be rejected)
 *
 * Each zip is signed with a locally generated RSA test key.
 */
import { spawnSync } from 'node:child_process';
import { createHash, createSign, generateKeyPairSync } from 'node:crypto';
import { existsSync } from 'node:fs';
import { mkdir, readFile, readdir, stat, writeFile } from 'node:fs/promises';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ZipFile } from 'yazl';

const exampleDirectory = dirname(dirname(fileURLToPath(import.meta.url)));
const outputDirectory = join(exampleDirectory, 'dist', 'bundles');
const keysDirectory = join(exampleDirectory, 'dist', 'keys');

async function zipDirectory(directory) {
  const zipFile = new ZipFile();
  const walk = async current => {
    for (const entry of await readdir(current, { withFileTypes: true })) {
      const entryPath = join(current, entry.name);
      if (entry.isDirectory()) {
        await walk(entryPath);
      } else if (entry.isFile()) {
        zipFile.addFile(
          entryPath,
          relative(directory, entryPath).split('\\').join('/'),
        );
      }
    }
  };
  await walk(directory);
  zipFile.end();
  const chunks = [];
  for await (const chunk of zipFile.outputStream) {
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

async function zipEntries(entries) {
  const zipFile = new ZipFile();
  for (const [path, content] of Object.entries(entries)) {
    zipFile.addBuffer(Buffer.from(content, 'utf8'), path);
  }
  zipFile.end();
  const chunks = [];
  for await (const chunk of zipFile.outputStream) {
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

async function getOrCreateKeyPair() {
  const privateKeyPath = join(keysDirectory, 'private.pem');
  const publicKeyPath = join(keysDirectory, 'public.pem');
  if (existsSync(privateKeyPath) && existsSync(publicKeyPath)) {
    return {
      privateKeyPem: await readFile(privateKeyPath, 'utf8'),
      publicKeyPem: await readFile(publicKeyPath, 'utf8'),
    };
  }
  const { privateKey, publicKey } = generateKeyPairSync('rsa', {
    modulusLength: 2048,
  });
  const privateKeyPem = privateKey
    .export({ type: 'pkcs8', format: 'pem' })
    .toString();
  const publicKeyPem = publicKey
    .export({ type: 'spki', format: 'pem' })
    .toString();
  await mkdir(keysDirectory, { recursive: true });
  await writeFile(privateKeyPath, privateKeyPem);
  await writeFile(publicKeyPath, publicKeyPem);
  return { privateKeyPem, publicKeyPem };
}

function sign(bytes, privateKeyPem) {
  const signer = createSign('RSA-SHA256');
  signer.update(bytes);
  return signer.sign(privateKeyPem).toString('base64');
}

function checksum(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

async function main() {
  await mkdir(outputDirectory, { recursive: true });
  const { privateKeyPem } = await getOrCreateKeyPair();

  // Good bundle: the example renderer rebuilt with a new marker.
  const goodBuildDirectory = join(exampleDirectory, 'dist', 'bundle-2.0.0');
  const viteResult = spawnSync(
    'npx',
    ['vite', 'build', '--outDir', goodBuildDirectory, '--emptyOutDir'],
    {
      cwd: exampleDirectory,
      env: { ...process.env, VITE_BUNDLE_MARKER: '2.0.0' },
      shell: process.platform === 'win32',
      stdio: 'inherit',
    },
  );
  if (viteResult.status !== 0) {
    throw new Error('Building the 2.0.0 bundle failed.');
  }
  const goodZip = await zipDirectory(goodBuildDirectory);

  // Broken bundle: renders, but never calls ready(), so the rollback
  // protection must kick in.
  const brokenZip = await zipEntries({
    'index.html': [
      '<!doctype html>',
      '<html><body>',
      '<main><h1>Live Update Example</h1>',
      '<p>Bundle: <strong id="marker" data-testid="marker">3.0.0-broken</strong></p>',
      '<p>This bundle is deliberately broken and never signals readiness.</p>',
      '</main></body></html>',
    ].join('\n'),
  });

  // Evil bundle: valid zip, but served with the signature of 2.0.0.
  const evilZip = await zipEntries({
    'index.html': '<!doctype html><html><body><h1>evil</h1></body></html>',
  });

  const bundles = {
    '2.0.0': {
      checksum: checksum(goodZip),
      file: '2.0.0.zip',
      signature: sign(goodZip, privateKeyPem),
    },
    '3.0.0-broken': {
      checksum: checksum(brokenZip),
      file: '3.0.0-broken.zip',
      signature: sign(brokenZip, privateKeyPem),
    },
    // Tampered: content of the evil zip, verification data of 2.0.0.
    '2.0.0-evil': {
      checksum: checksum(goodZip),
      file: '2.0.0-evil.zip',
      signature: sign(goodZip, privateKeyPem),
    },
  };
  await writeFile(join(outputDirectory, '2.0.0.zip'), goodZip);
  await writeFile(join(outputDirectory, '3.0.0-broken.zip'), brokenZip);
  await writeFile(join(outputDirectory, '2.0.0-evil.zip'), evilZip);
  await writeFile(
    join(outputDirectory, 'index.json'),
    JSON.stringify(bundles, null, 2),
  );
  for (const [bundleId, bundle] of Object.entries(bundles)) {
    const size = (await stat(join(outputDirectory, bundle.file))).size;
    console.log(`Built bundle ${bundleId} (${size} bytes)`);
  }
}

await main();
