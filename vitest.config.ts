import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

const source = (path: string): string => fileURLToPath(new URL(path, import.meta.url));

export default defineConfig({
  resolve: {
    alias: {
      '@agentdeck/protocol': source('./packages/protocol/src/index.ts'),
      '@agentdeck/shared': source('./packages/shared/src/index.ts'),
      '@agentdeck/server': source('./packages/server/src/index.ts'),
      '@agentdeck/client': source('./packages/client/src/index.ts'),
    },
  },
  test: {
    restoreMocks: true,
  },
});
