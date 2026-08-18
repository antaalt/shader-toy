import { defineConfig } from 'vite'

// The WASI language server runs in a worker and reads stdin through a
// SharedArrayBuffer + Atomics.wait. SharedArrayBuffer is only exposed to
// cross-origin isolated documents, so the dev and preview servers must send
// these headers. Any static host serving `dist/` needs them too.
const crossOriginIsolation = {
  'Cross-Origin-Opener-Policy': 'same-origin',
  'Cross-Origin-Embedder-Policy': 'require-corp',
}

// GitHub Pages serves this project from https://antaalt.github.io/shader-toy/,
// so built asset URLs need the repository name as a prefix. Update this if the
// repository is renamed or moved behind a custom domain.
const PAGES_BASE = '/shader-toy/'

export default defineConfig(({ command }) => ({
  base: command === 'build' ? PAGES_BASE : '/',
  server: { headers: crossOriginIsolation },
  preview: { headers: crossOriginIsolation },
  worker: { format: 'es' },
  build: { target: 'esnext' },
}))
