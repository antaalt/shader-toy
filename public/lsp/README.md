# Dropping in a WASI language server

Put a `wasm32-wasip1` **command** module here as `shader-language-server.wasm`:

```
public/lsp/shader-language-server.wasm
```

Reload the page. The badge in the editor header switches from `lsp: built-in`
to the server's own name, and diagnostics/hover/completion start coming from
it. If the file is absent the app falls back to a local WGSL word list, so it
always runs.

To point at a different filename, different argv, or a different `didOpen`
language id, edit [`src/config.ts`](../../src/config.ts).

## What the server has to be

| Requirement | Why |
| --- | --- |
| Built for `wasm32-wasip1` (formerly `wasm32-wasi`) | The host implements WASI preview 1 via `@bjorn3/browser_wasi_shim`. |
| A **command**, exporting `_start` | The host calls `_start` and lets the server drive its own read loop. Reactors (`_initialize`) and Components (WASI 0.2, `.wasm` with a component header) are not supported. |
| Speaks LSP over **stdio** with `Content-Length` framing | That is the only channel wired up. Most servers need a flag such as `--stdio`; set it in `src/config.ts`. |
| Imports only `wasi_snapshot_preview1` | Sockets, threads, `wasi-nn`, etc. are not provided. A missing import fails instantiation with a message in the console. |

Building one from Rust, for example:

```sh
rustup target add wasm32-wasip1
cargo build --release --target wasm32-wasip1
cp target/wasm32-wasip1/release/my-shader-language-server.wasm public/lsp/shader-language-server.wasm
```

## The environment it gets

- **argv / env** — from `LANGUAGE_SERVER.args` / `.env` in `src/config.ts`.
- **Preopened `/`** — an in-memory directory containing `shader.wgsl`,
  snapshotted at startup. Absolute paths under `/` resolve normally.
- **stdin** — a blocking pipe. Reads park the worker until the host writes.
- **stdout** — LSP messages back to the client.
- **stderr** — line-buffered into the browser console, prefixed `[lsp]`.

### Two limits worth knowing

**The filesystem snapshot does not update.** A WASI command owns its thread:
once `_start` is entered the worker never returns to its event loop, so the
host cannot mutate the preopen afterwards. Live buffer content reaches the
server through `textDocument/didChange` (full-text sync) only. A server that
re-reads open documents from disk instead of trusting the client's text will
see the document as it was at page load. Servers that honour `didChange` — the
spec requires it — are unaffected.

**The page must be cross-origin isolated.** stdin blocking uses
`SharedArrayBuffer` + `Atomics.wait`, which browsers only expose to isolated
documents. The dev and preview servers set the headers already; a production
host must send them too:

```
Cross-Origin-Opener-Policy: same-origin
Cross-Origin-Embedder-Policy: require-corp
```

Without them `probeWasiServer` reports the reason and the app uses the
fallback provider.

Hosts that cannot set headers at all — GitHub Pages, for one — are covered by
`public/coi-serviceworker.js`, a service worker that re-serves every response
with those two headers. `src/coiServiceWorker.ts` registers it and reloads the
page once so the document itself comes through the worker.

## Debugging

- Server crashed or exited: `[lsp] language server exited with code N` in the
  console. Its stderr is right above.
- Nothing happens after `initialize`: the server is probably waiting on a
  request the client answers with `MethodNotFound`. Add a handler in
  `LanguageClient`'s constructor (`src/lsp/languageClient.ts`).
- Diagnostics land on the wrong lines: check the server's position encoding.
  This client advertises `utf-16`, matching Monaco.
