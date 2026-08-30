import { defineConfig } from 'vitest/config'
import { resolve } from 'node:path'

// Unit tests for pure logic. The renderer modules run under jsdom (they touch
// document/localStorage); main-process modules mock 'electron' per test.
export default defineConfig({
  resolve: {
    alias: {
      '@': resolve(__dirname, 'src/renderer/src'),
      '@shared': resolve(__dirname, 'src/shared')
    }
  },
  test: {
    environment: 'jsdom',
    include: ['src/**/*.test.ts'],
    globals: true
  }
})
