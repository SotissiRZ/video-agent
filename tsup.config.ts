import { defineConfig } from 'tsup';

// Only the Node side is compiled. The Remotion compositions (src/remotion) are bundled
// at render time by @remotion/bundler, directly from the TypeScript sources.
export default defineConfig({
  entry: { cli: 'src/cli/index.ts', index: 'src/index.ts' },
  format: ['esm'],
  platform: 'node',
  target: 'node20',
  outDir: 'dist',
  clean: true,
  sourcemap: true,
  dts: false,
  splitting: true,
});
