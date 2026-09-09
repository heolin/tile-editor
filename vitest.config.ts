import { defineConfig } from 'vitest/config'
export default defineConfig({
  test: { include: ['packages/*/test/**/*.test.ts'], testTimeout: 30_000 },
  resolve: { alias: { '@tile-editor/core': new URL('./packages/core/src/index.ts', import.meta.url).pathname } },
})
