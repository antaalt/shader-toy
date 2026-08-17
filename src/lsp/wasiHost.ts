/**
 * Runs a WASI language server (`wasm32-wasip1`, with or without threads) and
 * bridges its stdio to callbacks.
 *
 * Kept free of any worker/DOM API so the same code paths can be exercised
 * outside a browser (see `scratch/`). The browser adapters are `wasiWorker.ts`
 * for the main thread and `threadWorker.ts` for pooled guest threads.
 *
 * Neither entry point returns until its guest code finishes: a WASI command
 * drives its own read loop, so the calling thread is parked inside `fd_read` on
 * stdin for the server's whole life. That is why stdin is a SharedArrayBuffer
 * pipe rather than message passing, and why the only way to stop a server is to
 * terminate its worker.
 */
import {
  ConsoleStdout,
  Fd,
  File,
  PreopenDirectory,
  WASI,
  WASIProcExit,
  wasi as wasiDefs,
  type Inode,
} from '@bjorn3/browser_wasi_shim'
import { SharedPipeReader } from './sharedPipe'
import { claimSlot, nextThreadId } from './threadPool'

export interface SpawnRequest {
  /** Pool slot already claimed by the caller. */
  slot: number
  tid: number
  startArg: number
}

export interface WasiThreadSupport {
  /** Control block from `createThreadControl`. */
  control: SharedArrayBuffer
  /**
   * Asks the host to run a guest thread on `slot`. Must not block and must not
   * expect a reply: the caller is a guest thread parked inside wasm.
   *
   * Adapters implement this as a `postMessage` to the page, which is the one
   * context always able to route work to a pooled worker.
   */
  requestSpawn(request: SpawnRequest): void
}

interface CommonOptions {
  /** Compiled once by the caller and shared across workers. */
  module: WebAssembly.Module
  /** Required when the module imports its memory; otherwise null. */
  memory: WebAssembly.Memory | null
  /** Present only for modules importing `wasi.thread-spawn`. */
  threads: WasiThreadSupport | null
  /**
   * Shared ring buffer carrying stdin. Every guest thread gets a reader on it:
   * file descriptors belong to the process, not the thread, and some servers
   * (anything built on `lsp-server`) read stdin from a thread rather than from
   * `main`.
   */
  stdin: SharedArrayBuffer
  args: string[]
  env: string[]
  files: Record<string, string>
  /**
   * Raw stdout bytes. Threads share stdout with the main thread, so these must
   * all reach the same LSP message decoder.
   */
  onStdout: (bytes: Uint8Array) => void
  onStderrLine: (line: string) => void
}

export interface WasiCommandOptions extends CommonOptions {
  /** Called after instantiation, immediately before `_start`. */
  onReady?: () => void
}

export interface WasiThreadOptions extends CommonOptions {
  /** Thread id minted by whichever thread called `thread-spawn`. */
  tid: number
  /** Opaque pointer the guest passed to `thread-spawn`. */
  startArg: number
}

/** stdin backed by the shared ring buffer. `fd_read` blocks. */
export class BlockingStdin extends Fd {
  private readonly reader: SharedPipeReader

  constructor(reader: SharedPipeReader) {
    super()
    this.reader = reader
  }

  override fd_fdstat_get(): { ret: number; fdstat: wasiDefs.Fdstat | null } {
    const fdstat = new wasiDefs.Fdstat(wasiDefs.FILETYPE_CHARACTER_DEVICE, 0)
    fdstat.fs_rights_base = BigInt(wasiDefs.RIGHTS_FD_READ)
    return { ret: wasiDefs.ERRNO_SUCCESS, fdstat }
  }

  override fd_filestat_get(): { ret: number; filestat: wasiDefs.Filestat | null } {
    return {
      ret: wasiDefs.ERRNO_SUCCESS,
      filestat: new wasiDefs.Filestat(0n, wasiDefs.FILETYPE_CHARACTER_DEVICE, 0n),
    }
  }

  override fd_read(size: number): { ret: number; data: Uint8Array } {
    const buffer = new Uint8Array(size)
    const read = this.reader.read(buffer)
    // A zero-length read is end-of-file, which is how the server learns to quit.
    return { ret: wasiDefs.ERRNO_SUCCESS, data: buffer.subarray(0, read) }
  }

  override fd_close(): number {
    return wasiDefs.ERRNO_SUCCESS
  }
}

/**
 * Instantiates and runs the server. Resolves with the exit code once it exits;
 * rejects if it cannot be started.
 */
export function runWasiCommand(options: WasiCommandOptions): number {
  assertCanBlock()

  const wasi = buildWasi(options)
  const instance = new WebAssembly.Instance(options.module, buildImports(wasi, options))

  if (typeof instance.exports._start !== 'function') {
    throw new Error(
      'The module does not export `_start`. A language server must be built as a ' +
        'WASI command (wasm32-wasip1), not as a reactor or a component.',
    )
  }

  options.onReady?.()

  try {
    // Blocks until the server exits.
    return wasi.start(asStartable(instance, options.memory))
  } catch (error) {
    if (error instanceof WASIProcExit) return error.code
    throw error
  }
}

/**
 * Runs one guest thread to completion by calling the module's
 * `wasi_thread_start`. Blocks the calling thread, exactly like the main entry.
 */
export function runWasiThread(options: WasiThreadOptions): number {
  assertCanBlock()

  const wasi = buildWasi(options)
  const instance = new WebAssembly.Instance(options.module, buildImports(wasi, options))

  const threadStart = instance.exports.wasi_thread_start
  if (typeof threadStart !== 'function') {
    throw new Error('The module does not export `wasi_thread_start`; cannot run a guest thread.')
  }

  // Syscalls read memory through `wasi.inst`, so it must be set even though we
  // are not going through `wasi.start`.
  wasi.inst = asStartable(instance, options.memory)

  try {
    ;(threadStart as (tid: number, startArg: number) => void)(options.tid, options.startArg)
    return 0
  } catch (error) {
    if (error instanceof WASIProcExit) return error.code
    throw error
  }
}

function buildWasi(options: CommonOptions): WASI {
  const encoder = new TextEncoder()
  const files = new Map<string, Inode>()
  for (const [path, contents] of Object.entries(options.files)) {
    files.set(path, new File(encoder.encode(contents)))
  }

  return new WASI(
    options.args,
    options.env,
    [
      new BlockingStdin(new SharedPipeReader(options.stdin)),
      // `buffer` is a view into wasm memory: copy before handing it out.
      new ConsoleStdout((buffer) => options.onStdout(buffer.slice())),
      ConsoleStdout.lineBuffered(options.onStderrLine),
      new PreopenDirectory('/', files),
    ],
    { debug: false },
  )
}

function buildImports(wasi: WASI, options: CommonOptions): WebAssembly.Imports {
  const imports: WebAssembly.Imports = {
    // Older toolchains emit `wasi_unstable`; offering both namespaces is
    // harmless when only one is imported.
    wasi_snapshot_preview1: wasi.wasiImport,
    wasi_unstable: wasi.wasiImport,
  }

  if (options.memory) {
    imports.env = { memory: options.memory }
  }

  const threads = options.threads
  if (threads) {
    const view = new Int32Array(threads.control)
    imports.wasi = {
      'thread-spawn': (startArg: number): number => {
        const slot = claimSlot(view)
        if (slot < 0) {
          // Reported to the guest as a failed spawn, which its threading
          // library treats as EAGAIN.
          console.warn('[wasi] thread pool exhausted; refusing thread-spawn')
          return -1
        }
        const tid = nextThreadId(view)
        threads.requestSpawn({ slot, tid, startArg })
        return tid
      },
    }
  }

  return imports
}

/**
 * The shim reads linear memory via `inst.exports.memory`. A threads build
 * usually re-exports the memory it imports, but nothing requires that, so fall
 * back to the memory we supplied.
 */
function asStartable(
  instance: WebAssembly.Instance,
  memory: WebAssembly.Memory | null,
): { exports: { memory: WebAssembly.Memory; _start: () => unknown } } {
  const exports = instance.exports as unknown as { memory?: WebAssembly.Memory }
  if (exports.memory) {
    return instance as unknown as {
      exports: { memory: WebAssembly.Memory; _start: () => unknown }
    }
  }
  if (!memory) {
    throw new Error('the module neither exports nor imports a memory')
  }
  return { ...instance, exports: { ...instance.exports, memory } } as unknown as {
    exports: { memory: WebAssembly.Memory; _start: () => unknown }
  }
}

function assertCanBlock(): void {
  if (typeof Atomics.wait !== 'function') {
    throw new Error('Atomics.wait is unavailable on this thread; cannot block on stdin.')
  }
}
