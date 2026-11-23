import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { fileURLToPath } from 'node:url'

const here = (p: string) => fileURLToPath(new URL(p, import.meta.url))

export default defineConfig({
  // Absolute paths, so the server works whatever directory it is started from.
  root: here('./src/ui'),
  plugins: [react()],
  build: { outDir: here('./dist'), emptyOutDir: true },
  test: { root: here('.'), include: ['tests/**/*.test.ts'] },
} as any)
