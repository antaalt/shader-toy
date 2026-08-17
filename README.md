# shader-toy

Shader toy prototype for shaders. One page, split down the middle: a Monaco
editor on the left, a live WebGPU render of what you type on the right.
Language intelligence comes from a language server compiled to WASI, running in
a worker inside the browser.

```
┌──────────────────────────┬──────────────────────────┐
│  Monaco (wgsl)           │  WebGPU                  │
│                          │                          │
│  ← LSP diagnostics,      │  fullscreen triangle,     │
│    hover, completion     │  recompiled as you type   │
└──────────────────────────┴──────────────────────────┘
        │                              │
   wasi worker                   GPUDevice
   (shader-language-server.wasm)
```

## Running it

```sh
npm install
npm run dev
```

Needs a WebGPU-capable browser (Chrome/Edge 113+, or Safari 26+). The editor
works regardless; only the right pane needs a GPU adapter.

| Script | Does |
| --- | --- |
| `npm run dev` | Vite dev server with the cross-origin isolation headers. |
| `npm run build` | Typecheck, then bundle to `dist/`. |
| `npm run preview` | Serve `dist/` with the same headers. |
| `npm run typecheck` | `tsc --noEmit`. |
| `npm test` | Shared-memory pipe and LSP framing. No toolchain needed. |
| `npm run test:wasi` | Full server path against a real `.wasm`. Needs Rust — see [`scratch/`](scratch/README.md). |

`src/` is kept type-erasable (`erasableSyntaxOnly`), so the tests run the real
sources directly under `node --experimental-strip-types` with no build step.

## The shader

The editor holds a **complete** WGSL module, handed to `createShaderModule`
verbatim — nothing is prepended, so compiler and language-server line numbers
match the editor exactly. The renderer expects:

- `@vertex fn vs_main(@builtin(vertex_index) u32) -> @builtin(position) vec4f`,
  drawing 3 vertices as a fullscreen triangle;
- `@fragment fn fs_main(...) -> @location(0) vec4f`;
- a `Uniforms` block at `@group(0) @binding(0)` with `resolution`, `mouse`
  (both physical pixels), `time` (seconds) and `frame`.

Edits recompile after 300 ms idle. Compilation messages become editor markers
under the `webgpu` owner; if the new shader fails, the last good one keeps
rendering.

## The language server

Drop a `wasm32-wasip1` LSP command module at `public/lsp/shader-language-server.wasm` and
reload — see [`public/lsp/README.md`](public/lsp/README.md) for the contract,
the environment it gets, and two limits worth reading (the filesystem snapshot
is startup-only; the page must be cross-origin isolated). Without a binary the
editor falls back to a built-in WGSL word list, and the header badge says which
one is live.

Diagnostics, hover, completion, signature help, go-to-definition and document
symbols are wired up, each gated on the capability the server advertises in its
`initialize` response.

### How it is put together

Rather than `monaco-languageclient` + `@codingame/monaco-vscode-api`, this is a
direct bridge from LSP JSON-RPC to Monaco's provider APIs: no `vscode` shim, no
version pinning against `monaco-editor`, and the whole path is readable.

```
src/lsp/
  wasiWorker.ts      runs the .wasm; bridges WASI stdio
  sharedPipe.ts      SharedArrayBuffer ring buffer for blocking stdin
  wasiTransport.ts   host side of the worker; raw stdio → messages
  framing.ts         Content-Length framing
  languageClient.ts  JSON-RPC + the initialize handshake
  protocol.ts        the slice of LSP that is actually used
  convert.ts         LSP types ↔ Monaco types
  monacoBridge.ts    registers providers, publishes markers
  fallbackProvider.ts  built-in WGSL completions when there is no server
```

The one subtle piece is `sharedPipe.ts`. A WASI command drives its own read
loop, so `_start` never returns and the worker cannot receive `postMessage`.
The main thread therefore writes stdin bytes straight into shared memory and
the worker blocks on `Atomics.wait` — which is why the page needs
`Cross-Origin-Opener-Policy` / `Cross-Origin-Embedder-Policy` headers.

### Note on the monaco-editor version

`monaco-editor` is pinned to `0.54.0` rather than floating. Both `0.55.1` and
`0.56.0` publish an ESM entry point that imports
`external/monaco-lsp-client/out/index.js`, a directory absent from the npm
tarball, so bundling them fails outright. 0.54.0 is the newest release whose
ESM build resolves. It also contributes the `wgsl` language itself, which is
why this project defines no Monarch tokenizer of its own — only the word lists
the fallback provider needs.
