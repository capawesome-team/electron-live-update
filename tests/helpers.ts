import { createHash, createSign, generateKeyPairSync } from 'node:crypto';
import { createWriteStream } from 'node:fs';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import {
  createServer,
  type IncomingMessage,
  type Server,
  type ServerResponse,
} from 'node:http';
import type { Socket } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { crc32 } from 'node:zlib';
import { ZipFile } from 'yazl';

export async function createTemporaryDirectory(): Promise<string> {
  return mkdtemp(join(tmpdir(), 'live-update-test-'));
}

export async function removeDirectory(directory: string): Promise<void> {
  await rm(directory, { recursive: true, force: true });
}

export interface ZipEntry {
  content: string | Buffer;
  mode?: number;
  path: string;
}

/**
 * Build a zip file from the given entries and return its bytes.
 */
export async function buildZip(entries: ZipEntry[]): Promise<Buffer> {
  const zipFile = new ZipFile();
  for (const entry of entries) {
    const buffer =
      typeof entry.content === 'string'
        ? Buffer.from(entry.content, 'utf8')
        : entry.content;
    zipFile.addBuffer(
      buffer,
      entry.path,
      entry.mode === undefined ? undefined : { mode: entry.mode },
    );
  }
  zipFile.end();
  const chunks: Buffer[] = [];
  for await (const chunk of zipFile.outputStream) {
    chunks.push(chunk as Buffer);
  }
  return Buffer.concat(chunks);
}

export async function writeZip(
  filePath: string,
  entries: ZipEntry[],
): Promise<void> {
  const buffer = await buildZip(entries);
  await new Promise<void>((resolve, reject) => {
    const stream = createWriteStream(filePath);
    stream.on('error', reject);
    stream.on('finish', resolve);
    stream.end(buffer);
  });
}

/**
 * Build a zip file with arbitrary (potentially malicious) entry names.
 *
 * yazl refuses to write invalid paths, so attack fixtures for the
 * zip-slip tests are assembled manually: stored (uncompressed) local
 * file headers plus a matching central directory.
 */
export async function writeRawZip(
  filePath: string,
  entries: { content: string; name: string }[],
): Promise<void> {
  const localParts: Buffer[] = [];
  const centralParts: Buffer[] = [];
  let offset = 0;
  for (const entry of entries) {
    const nameBuffer = Buffer.from(entry.name, 'utf8');
    const dataBuffer = Buffer.from(entry.content, 'utf8');
    const checksum = crc32(dataBuffer);
    const localHeader = Buffer.alloc(30);
    localHeader.writeUInt32LE(0x04034b50, 0); // local file header signature
    localHeader.writeUInt16LE(20, 4); // version needed to extract
    localHeader.writeUInt16LE(0, 6); // general purpose bit flag
    localHeader.writeUInt16LE(0, 8); // compression method: stored
    localHeader.writeUInt32LE(0, 10); // mod time/date
    localHeader.writeUInt32LE(checksum, 14);
    localHeader.writeUInt32LE(dataBuffer.length, 18); // compressed size
    localHeader.writeUInt32LE(dataBuffer.length, 22); // uncompressed size
    localHeader.writeUInt16LE(nameBuffer.length, 26);
    localHeader.writeUInt16LE(0, 28); // extra field length
    const centralHeader = Buffer.alloc(46);
    centralHeader.writeUInt32LE(0x02014b50, 0); // central directory signature
    centralHeader.writeUInt16LE(20, 4); // version made by
    centralHeader.writeUInt16LE(20, 6); // version needed
    centralHeader.writeUInt16LE(0, 8); // flags
    centralHeader.writeUInt16LE(0, 10); // method: stored
    centralHeader.writeUInt32LE(0, 12); // mod time/date
    centralHeader.writeUInt32LE(checksum, 16);
    centralHeader.writeUInt32LE(dataBuffer.length, 20);
    centralHeader.writeUInt32LE(dataBuffer.length, 24);
    centralHeader.writeUInt16LE(nameBuffer.length, 28);
    centralHeader.writeUInt16LE(0, 30); // extra length
    centralHeader.writeUInt16LE(0, 32); // comment length
    centralHeader.writeUInt16LE(0, 34); // disk number
    centralHeader.writeUInt16LE(0, 36); // internal attributes
    centralHeader.writeUInt32LE(0, 38); // external attributes
    centralHeader.writeUInt32LE(offset, 42); // local header offset
    localParts.push(localHeader, nameBuffer, dataBuffer);
    centralParts.push(centralHeader, nameBuffer);
    offset += localHeader.length + nameBuffer.length + dataBuffer.length;
  }
  const centralSize = centralParts.reduce(
    (size, part) => size + part.length,
    0,
  );
  const endOfCentralDirectory = Buffer.alloc(22);
  endOfCentralDirectory.writeUInt32LE(0x06054b50, 0);
  endOfCentralDirectory.writeUInt16LE(0, 4); // disk number
  endOfCentralDirectory.writeUInt16LE(0, 6); // central directory disk
  endOfCentralDirectory.writeUInt16LE(entries.length, 8);
  endOfCentralDirectory.writeUInt16LE(entries.length, 10);
  endOfCentralDirectory.writeUInt32LE(centralSize, 12);
  endOfCentralDirectory.writeUInt32LE(offset, 16); // central directory offset
  endOfCentralDirectory.writeUInt16LE(0, 20); // comment length
  await writeFile(
    filePath,
    Buffer.concat([...localParts, ...centralParts, endOfCentralDirectory]),
  );
}

export function createDefaultBundleEntries(marker: string): ZipEntry[] {
  return [
    { path: 'index.html', content: `<html><body>${marker}</body></html>` },
    { path: 'assets/app.js', content: `console.log('${marker}');` },
  ];
}

export interface RsaKeyPair {
  privateKeyPem: string;
  publicKeyPem: string;
}

export function generateRsaKeyPair(): RsaKeyPair {
  const { privateKey, publicKey } = generateKeyPairSync('rsa', {
    modulusLength: 2048,
  });
  return {
    privateKeyPem: privateKey
      .export({ type: 'pkcs8', format: 'pem' })
      .toString(),
    publicKeyPem: publicKey.export({ type: 'spki', format: 'pem' }).toString(),
  };
}

/**
 * Sign file bytes the way the Capawesome Cloud CLI does: RSA PKCS#1
 * v1.5 signature of the SHA-256 digest, base64 encoded.
 */
export function signBytes(bytes: Buffer, privateKeyPem: string): string {
  const signer = createSign('RSA-SHA256');
  signer.update(bytes);
  return signer.sign(privateKeyPem).toString('base64');
}

export interface RecordedRequest {
  headers: IncomingMessage['headers'];
  method: string;
  url: URL;
}

export interface MockServerRoute {
  body: Buffer | string;
  headers?: Record<string, string>;
  status?: number;
}

export class MockServer {
  public readonly requests: RecordedRequest[] = [];
  private readonly routes = new Map<
    string,
    MockServerRoute | ((request: IncomingMessage) => MockServerRoute | null)
  >();
  private server: Server | null = null;
  private readonly sockets = new Set<Socket>();
  private port = 0;

  /**
   * Register a route. A function route may return `null` to leave the
   * request unanswered (for timeout tests).
   */
  public route(
    path: string,
    route:
      MockServerRoute | ((request: IncomingMessage) => MockServerRoute | null),
  ): void {
    this.routes.set(path, route);
  }

  public get origin(): string {
    return `http://127.0.0.1:${this.port}`;
  }

  public async start(): Promise<void> {
    this.server = createServer((request, response) =>
      this.handle(request, response),
    );
    this.server.on('connection', socket => {
      this.sockets.add(socket);
      socket.on('close', () => this.sockets.delete(socket));
    });
    await new Promise<void>(resolve => {
      this.server?.listen(0, '127.0.0.1', resolve);
    });
    const address = this.server?.address();
    if (address && typeof address === 'object') {
      this.port = address.port;
    }
  }

  public async stop(): Promise<void> {
    for (const socket of this.sockets) {
      socket.destroy();
    }
    this.sockets.clear();
    await new Promise<void>((resolve, reject) => {
      this.server?.close(error => (error ? reject(error) : resolve()));
    });
    this.server = null;
  }

  private handle(request: IncomingMessage, response: ServerResponse): void {
    const url = new URL(request.url ?? '/', this.origin);
    this.requests.push({
      headers: request.headers,
      method: request.method ?? 'GET',
      url,
    });
    const route = this.routes.get(url.pathname);
    if (!route) {
      response.statusCode = 404;
      response.end('Not found');
      return;
    }
    const resolved = typeof route === 'function' ? route(request) : route;
    if (resolved === null) {
      return;
    }
    response.statusCode = resolved.status ?? 200;
    for (const [name, value] of Object.entries(resolved.headers ?? {})) {
      response.setHeader(name, value);
    }
    response.end(resolved.body);
  }
}

export async function readTextFile(filePath: string): Promise<string> {
  return readFile(filePath, 'utf8');
}

export function sha256Hex(content: string | Buffer): string {
  return createHash('sha256').update(content).digest('hex');
}
