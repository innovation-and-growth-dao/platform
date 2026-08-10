import { defineConfig } from 'vitest/config';

export default defineConfig({
  esbuild: {
    // NestJS sources use legacy (experimental) decorators.
    tsconfigRaw: { compilerOptions: { experimentalDecorators: true } },
  },
  test: {
    include: ['src/**/*.spec.ts'],
    environment: 'node',
  },
});
