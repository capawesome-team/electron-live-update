import { stat } from 'node:fs/promises';
import { join, normalize, resolve, sep } from 'node:path';

/**
 * Resolve a request pathname to a file inside the bundle root.
 *
 * Returns `null` when the path would escape the root (path
 * traversal) or is otherwise invalid.
 */
export function resolveRequestFilePath(
  rootDirectory: string,
  pathname: string,
): string | null {
  let decoded: string;
  try {
    decoded = decodeURIComponent(pathname);
  } catch {
    return null;
  }
  if (decoded.includes('\0')) {
    return null;
  }
  const root = resolve(rootDirectory);
  const resolved = resolve(root, normalize(decoded).replace(/^([/\\])+/, ''));
  if (resolved !== root && !resolved.startsWith(root + sep)) {
    return null;
  }
  return resolved;
}

/**
 * Resolve the file to serve for a request, applying the SPA fallback:
 * requests without a file extension that do not match a file are
 * served the root `index.html`.
 */
export async function resolveServedFile(
  rootDirectory: string,
  pathname: string,
): Promise<string | null> {
  const filePath = resolveRequestFilePath(
    rootDirectory,
    pathname === '/' ? '/index.html' : pathname,
  );
  if (!filePath) {
    return null;
  }
  try {
    const stats = await stat(filePath);
    if (stats.isFile()) {
      return filePath;
    }
    if (stats.isDirectory()) {
      const indexPath = join(filePath, 'index.html');
      const indexStats = await stat(indexPath).catch(() => null);
      if (indexStats?.isFile()) {
        return indexPath;
      }
    }
  } catch {
    // Fall through to the SPA fallback.
  }
  const lastSegment = pathname.split('/').pop() ?? '';
  if (!lastSegment.includes('.')) {
    const indexPath = resolveRequestFilePath(rootDirectory, '/index.html');
    if (indexPath) {
      const indexStats = await stat(indexPath).catch(() => null);
      if (indexStats?.isFile()) {
        return indexPath;
      }
    }
  }
  return null;
}
