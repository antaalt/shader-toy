/**
 * Host-side handle on the WASI language server: compiles the module, provisions
 * shared memory and the guest thread pool, then turns the server's raw stdio
 * into a JSON-RPC message transport.
 */
import WasiWorker from './wasiWorker?worker'
import ThreadWorker from './threadWorker?worker'
import { encodeMessage, MessageDecoder } from './framing'
import { createPipeBuffer, SharedPipeWriter } from './sharedPipe'
import { createThreadControl, poolSizeOf, threadControlView } from './threadPool'
import { inspectModule } from './wasmModuleInfo'
import type {
  SpawnMessage,
  StartMessage,
  ThreadInitMessage,
  ThreadRunMessage,
  ThreadToHost,
  WorkerToHost,
} from './workerProtocol'

export interface Transport {
  send(message: unknown): void
  /**
   * Subscribes to incoming messages / stderr lines / termination. All three
   * support multiple listeners: the LanguageClient registers its own, and the
   * application usually adds more.
   */
  onMessage(handler: (message: unknown) => void): void
  onLog(handler: (line: string) => void): void
  onClose(handler: (reason: string) => void): void
  dispose(): void
}

export interface WasiServerOptions {
  /** argv passed to the server. Most servers need a `--stdio` style flag. */
  args?: string[]
  env?: string[]
  /** Files to snapshot into the preopened `/` directory. */
  files?: Record<string, string>
  /**
   * Maximum concurrent guest threads, for `wasm32-wasip1-threads` modules. One
   * worker is pre-spawned per slot, so this is also a fixed worker cost.
   */
  maxThreads?: number
}

/**
 * Checks whether a WASI server can run at all: the binary must be present and
 * the page must be cross-origin isolated so SharedArrayBuffer exists.
 * Returns the fetched module bytes, or a reason it is unavailable.
 */
export async function probeWasiServer(
  wasmUrl: string,
): Promise<{ ok: true; wasm: ArrayBuffer } | { ok: false; reason: string }> {
  if (typeof SharedArrayBuffer === 'undefined' || !globalThis.crossOriginIsolated) {
    return {
      ok: false,
      reason:
        'page is not cross-origin isolated, so SharedArrayBuffer (needed for blocking stdin) is unavailable',
    }
  }

  let response: Response
  try {
    response = await fetch(wasmUrl)
  } catch (error) {
    return { ok: false, reason: `could not fetch ${wasmUrl}: ${String(error)}` }
  }
  if (!response.ok) {
    return { ok: false, reason: `no server binary at ${wasmUrl} (HTTP ${response.status})` }
  }

  const wasm = await response.arrayBuffer()
  if (wasm.byteLength === 0) {
    return { ok: false, reason: `${wasmUrl} is empty` }
  }
  return { ok: true, wasm }
}

/** Pool size when the caller does not pick one. */
function defaultPoolSize(): number {
  const cores = globalThis.navigator?.hardwareConcurrency ?? 4
  return Math.min(8, Math.max(2, cores - 1))
}

/**
 * Spawns the workers and resolves once the module is instantiated and running.
 * `wasm` should come from {@link probeWasiServer}.
 */
export async function startWasiServer(
  wasm: ArrayBuffer,
  options: WasiServerOptions,
): Promise<Transport> {
  const module = await WebAssembly.compile(wasm)
  const info = inspectModule(new Uint8Array(wasm), module)

  if (!info.hasStart) {
    throw new Error(
      'the module does not export `_start`; a language server must be a WASI command ' +
        '(wasm32-wasip1), not a reactor or a component',
    )
  }

  const memory = createGuestMemory(info)
  const args = options.args ?? ['language-server']
  const env = options.env ?? []
  const files = options.files ?? {}

  // Pre-spawn the thread pool. Doing it up front is required, not just tidy:
  // `thread-spawn` runs on a thread already parked inside guest code, which
  // cannot drive a new worker's script load.
  const threadWorkers: Worker[] = []
  let threadControl: SharedArrayBuffer | null = null

  if (info.needsThreads) {
    if (!info.hasThreadStart) {
      throw new Error(
        'the module imports `wasi.thread-spawn` but does not export `wasi_thread_start`, ' +
          'so its threads cannot be started',
      )
    }
    threadControl = createThreadControl(options.maxThreads ?? defaultPoolSize())
  }

  return new Promise((resolve, reject) => {
    const worker = new WasiWorker({ name: 'wasi-language-server' })
    const stdin = createPipeBuffer()
    const writer = new SharedPipeWriter(stdin)
    const decoder = new MessageDecoder()

    const messageHandlers: Array<(message: unknown) => void> = []
    const logHandlers: Array<(line: string) => void> = []
    const closeHandlers: Array<(reason: string) => void> = []
    let settled = false
    let disposed = false
    let closed = false

    const emit = <T>(handlers: Array<(value: T) => void>, value: T) => {
      for (const handler of handlers) {
        try {
          handler(value)
        } catch (error) {
          console.error('[lsp] transport listener threw', error)
        }
      }
    }

    const transport: Transport = {
      send(message) {
        if (disposed) return
        writer.write(encodeMessage(message))
      },
      onMessage(handler) {
        messageHandlers.push(handler)
      },
      onLog(handler) {
        logHandlers.push(handler)
      },
      onClose(handler) {
        closeHandlers.push(handler)
      },
      dispose() {
        if (disposed) return
        disposed = true
        writer.close()
        worker.terminate()
        for (const threadWorker of threadWorkers) threadWorker.terminate()
      },
    }

    const fail = (reason: string) => {
      if (settled) {
        // Already running: this is the server going away, not a startup failure.
        if (closed) return
        closed = true
        emit(closeHandlers, reason)
        transport.dispose()
        return
      }
      settled = true
      transport.dispose()
      reject(new Error(reason))
    }

    /** Feeds stdout from any guest thread into the one message stream. */
    const acceptStdout = (bytes: Uint8Array) => {
      decoder.append(bytes)
      for (const parsed of decoder.drain()) emit(messageHandlers, parsed)
    }

    /**
     * Relays a spawn request to the pooled worker that owns the slot. The page
     * does this because the requesting guest thread is parked inside wasm.
     */
    const relaySpawn = (request: SpawnMessage) => {
      const target = threadWorkers[request.slot]
      if (!target) {
        emit(logHandlers, `[wasi] spawn for unknown thread slot ${request.slot}`)
        return
      }
      const run: ThreadRunMessage = {
        type: 'thread-run',
        tid: request.tid,
        startArg: request.startArg,
      }
      target.postMessage(run)
    }

    if (threadControl) {
      const poolSize = poolSizeOf(threadControlView(threadControl))
      for (let slot = 0; slot < poolSize; slot++) {
        const threadWorker = new ThreadWorker({ name: `wasi-thread-${slot}` })

        threadWorker.addEventListener('message', (event: MessageEvent<ThreadToHost>) => {
          const message = event.data
          switch (message.type) {
            case 'stdout':
              acceptStdout(message.bytes)
              break
            case 'log':
              emit(logHandlers, message.line)
              break
            case 'spawn':
              relaySpawn(message)
              break
            case 'thread-exit':
              // Normal: guest threads come and go over a server's lifetime.
              break
            case 'thread-error':
              emit(logHandlers, `[thread ${message.tid}] failed: ${message.message}`)
              break
          }
        })
        threadWorker.addEventListener('error', (event: ErrorEvent) => {
          emit(logHandlers, `[thread slot ${slot}] worker error: ${event.message}`)
        })

        const init: ThreadInitMessage = {
          type: 'thread-init',
          module,
          memory,
          stdin,
          threadControl,
          slot,
          args,
          env,
          files,
        }
        threadWorker.postMessage(init)
        threadWorkers.push(threadWorker)
      }
    }

    worker.addEventListener('message', (event: MessageEvent<WorkerToHost>) => {
      const message = event.data
      switch (message.type) {
        case 'ready':
          settled = true
          resolve(transport)
          break
        case 'stdout':
          acceptStdout(message.bytes)
          break
        case 'log':
          emit(logHandlers, message.line)
          break
        case 'spawn':
          relaySpawn(message)
          break
        case 'exit':
          fail(`language server exited with code ${message.code}`)
          break
        case 'error':
          fail(message.message)
          break
      }
    })

    worker.addEventListener('error', (event: ErrorEvent) => {
      fail(event.message || 'language server worker failed to load')
    })

    const start: StartMessage = {
      type: 'start',
      module,
      memory,
      stdin,
      threadControl,
      args,
      env,
      files,
    }
    worker.postMessage(start)
  })
}

/**
 * A `wasm32-wasip1-threads` build imports its memory rather than defining one,
 * and the limits have to match the declaration exactly.
 */
function createGuestMemory(info: {
  memoryImport: { initial: number; maximum?: number; shared: boolean } | null
}): WebAssembly.Memory | null {
  const declared = info.memoryImport
  if (!declared) return null

  if (declared.shared && declared.maximum === undefined) {
    throw new Error('the module imports a shared memory with no maximum, which cannot be created')
  }

  return new WebAssembly.Memory(
    declared.maximum === undefined
      ? { initial: declared.initial }
      : { initial: declared.initial, maximum: declared.maximum, shared: declared.shared },
  )
}
