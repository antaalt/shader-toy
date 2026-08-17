# scratch/

Test harness. Nothing here ships in the bundle.

The sources under `src/` are deliberately kept type-erasable
(`erasableSyntaxOnly` in tsconfig), so Node can run them directly with
`--experimental-strip-types` — no build step to test against. `tsResolve.mjs`
is a resolver hook that lets Node follow the extensionless relative imports
Vite expects.

## `npm test` — pipe and framing

Runs `test.mjs`: the `SharedArrayBuffer` pipe (blocking read, ring wraparound,
writer backpressure, EOF) and `Content-Length` framing (split chunks, several
messages per chunk, multi-byte UTF-8, bad headers).

The pipe case deliberately uses a 64-byte ring for a 20 KB payload, so every
wraparound and backpressure path runs a few hundred times.

## `npm run test:wasi` — the real thing

Runs `testWasi.mjs`, which drives an actual `wasm32-wasip1` module through the
same `runWasiCommand` + `SharedPipeWriter` + `LanguageClient` code the browser
uses; only the `postMessage` glue differs. It covers argv/env delivery, the
preopened `/` directory, blocking stdin, stdout framing, JSON-RPC id
correlation under 50 concurrent requests, notifications, and error replies.

Needs the fixture server built first:

```sh
npm run test:wasi
```

## Not covered here

`src/lsp/convert.ts`, `src/lsp/monacoBridge.ts` and `src/renderer/` all need a
real DOM, a Monaco instance or a GPU adapter, so they are only exercised by
running the app.
