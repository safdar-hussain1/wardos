import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  test: {
    include: ['tests/**/*.test.ts'],
    // bundle-privacy.test.ts rebuilds docs/ and site-metadata.test.ts reads it.
    // Run both in one forked worker, one file after the other, so no test
    // ever reads a half-written build. Every other file runs in parallel.
    poolMatchGlobs: [['**/tests/{bundle-privacy,site-metadata}.test.ts', 'forks']],
    poolOptions: { forks: { singleFork: true } },
  },
})
