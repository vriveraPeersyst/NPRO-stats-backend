import { defineConfig } from 'tsup';

export default defineConfig({
  entry: {
    server: 'src/server.ts',
    'bin/run-fast-sync': 'src/bin/run-fast-sync.ts',
    'bin/run-slow-sync': 'src/bin/run-slow-sync.ts',
  },
  format: ['esm'],
  target: 'node20',
  outDir: 'dist',
  clean: true,
  splitting: false,
  sourcemap: true,
  dts: false,
  treeshake: true,
  minify: false,
  external: ['@prisma/client'],
});
