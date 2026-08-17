import { defineConfig } from 'vite'

// The WASI language server runs in a worker and reads stdin through a
// SharedArrayBuffer + Atomics.wait. SharedArrayBuffer is only exposed to
// cross-origin isolated documents, so the dev and preview servers must send
// these headers. Any static host serving `dist/` needs them too.
const crossOriginIsolation = {
  'Cross-Origin-Opener-Policy': 'same-origin',
  'Cross-Origin-Embedder-Policy': 'require-corp',
}

export default defineConfig({
  server: { headers: crossOriginIsolation },
  preview: { headers: crossOriginIsolation },
  worker: { format: 'es' },
  build: { target: 'esnext' },
})
