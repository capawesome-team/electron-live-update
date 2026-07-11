import { readFileSync } from 'node:fs';
import { defineConfig } from 'tsup';

const { version } = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8')) as {
  version: string;
};

export default defineConfig([
  {
    entry: {
      'index': 'src/index.ts',
      'preload/index': 'src/preload/index.ts',
      'engine/index': 'src/engine/index.ts',
    },
    format: ['cjs', 'esm'],
    dts: true,
    sourcemap: true,
    platform: 'node',
    target: 'node20',
    external: ['electron'],
    define: {
      __SDK_VERSION__: JSON.stringify(version),
    },
  },
  {
    entry: {
      'renderer/index': 'src/renderer/index.ts',
    },
    format: ['cjs', 'esm'],
    dts: true,
    sourcemap: true,
    platform: 'browser',
    target: 'es2022',
  },
]);
