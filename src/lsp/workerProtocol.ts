/** Messages exchanged with the WASI language-server workers. */

/** Everything a worker needs to instantiate and run guest code. */
interface GuestSetup {
  /** Compiled once on the page and shared with every worker. */
  module: WebAssembly.Module
  /** The shared memory a `wasm32-wasip1-threads` build imports, else null. */
  memory: WebAssembly.Memory | null
  /**
   * Shared ring buffer carrying stdin. Shared by every guest thread, because
   * file descriptors belong to the process rather than the thread.
   */
  stdin: SharedArrayBuffer
  /** Thread slot bookkeeping; null when the module is single-threaded. */
  threadControl: SharedArrayBuffer | null
  /** argv, including argv[0]. */
  args: string[]
  /** Environment entries as `KEY=value`. */
  env: string[]
  /**
   * Files placed in the preopened `/` directory before the server starts.
   *
   * This is a snapshot: workers are parked inside guest code and cannot service
   * later updates. Live document content reaches the server through
   * `textDocument/didChange`, not through this filesystem.
   */
  files: Record<string, string>
}

/** Sent once to the worker that runs the server's `_start`. */
export interface StartMessage extends GuestSetup {
  type: 'start'
}

/** Sent once to each pooled thread worker, before any thread is spawned. */
export interface ThreadInitMessage extends GuestSetup {
  type: 'thread-init'
  /** Which slot of the control block this worker owns. */
  slot: number
}

/** Sent to a pooled thread worker to actually start a guest thread. */
export interface ThreadRunMessage {
  type: 'thread-run'
  tid: number
  startArg: number
}

export type HostToThreadWorker = ThreadInitMessage | ThreadRunMessage

/**
 * A guest thread asked to spawn another. The page relays it to the pooled
 * worker owning `slot`; the requesting thread is parked inside wasm and cannot
 * do this itself.
 */
export interface SpawnMessage {
  type: 'spawn'
  slot: number
  tid: number
  startArg: number
}

export type WorkerToHost =
  /**
   * Raw stdout bytes, still LSP-framed. Sent by the main worker and by thread
   * workers alike — they share one stdout, so all of it belongs to the same
   * message stream.
   */
  | { type: 'stdout'; bytes: Uint8Array }
  /** A line written to stderr. */
  | { type: 'log'; line: string }
  /** The module has been instantiated and is about to enter `_start`. */
  | { type: 'ready' }
  /** The server process exited. */
  | { type: 'exit'; code: number }
  /** Startup or runtime failure; the server is not usable. */
  | { type: 'error'; message: string }
  | SpawnMessage

export type ThreadToHost =
  | { type: 'stdout'; bytes: Uint8Array }
  | { type: 'log'; line: string }
  | { type: 'thread-exit'; tid: number; code: number }
  | { type: 'thread-error'; tid: number; message: string }
  | SpawnMessage
