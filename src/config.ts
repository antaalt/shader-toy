/** Where the WASI language server lives, and how to launch it. */
export const LANGUAGE_SERVER = {
  /**
   * Served from `public/`, so this resolves to `public/lsp/shader-language-server.wasm`.
   * Drop any `wasm32-wasip1` LSP command module here — see
   * `public/lsp/README.md`.
   */
  wasmUrl: 'lsp/shader-language-server.wasm',

  /**
   * argv for the server. argv[0] is the program name; most servers also want
   * an explicit "talk LSP over stdio" flag.
   */
  args: ['shader-language-server', '--stdio'],

  /** Environment entries, as `KEY=value`. */
  env: ['RUST_BACKTRACE=1'],

  /**
   * The language id sent in `didOpen`. Some shader servers key off `wgsl`,
   * others off `wgsl-shader`; adjust to match your server.
   */
  languageId: 'wgsl',
} as const
