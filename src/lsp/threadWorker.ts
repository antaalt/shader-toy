/**
 * One pooled guest thread. Idles until the page hands it a thread id, then runs
 * `wasi_thread_start` to completion — which blocks this worker, so a thread
 * parked on a futex holds its slot until it wakes.
 *
 * Workers are created up front, never on demand: `thread-spawn` is called from
 * a thread already parked inside guest code, which could not drive a new
 * worker's script load.
 *
 * A guest thread shares stdio with the rest of the process, so its stdout goes
 * into the same LSP stream — servers built on `lsp-server` do all their reading
 * and writing from threads, not from `main`.
 */
import { runWasiThread } from './wasiHost'
import { releaseSlot, threadControlView } from './threadPool'
import type { HostToThreadWorker, ThreadInitMessage, ThreadToHost } from './workerProtocol'

interface WorkerScope {
  postMessage(message: ThreadToHost, transfer?: Transferable[]): void
  addEventListener(type: 'message', listener: (event: MessageEvent) => void): void
}

const host = globalThis as unknown as WorkerScope
let setup: ThreadInitMessage | null = null

host.addEventListener('message', (event: MessageEvent) => {
  const message = event.data as HostToThreadWorker

  if (message?.type === 'thread-init') {
    setup = message
    return
  }
  if (message?.type !== 'thread-run') return

  const init = setup
  if (!init) {
    host.postMessage({
      type: 'thread-error',
      tid: message.tid,
      message: 'received thread-run before thread-init',
    })
    return
  }

  const { tid, startArg } = message
  const control = threadControlView(init.threadControl!)

  try {
    const code = runWasiThread({
      module: init.module,
      memory: init.memory,
      threads: {
        control: init.threadControl!,
        // A guest thread may spawn further threads; route those through the
        // page as well.
        requestSpawn: (request) => host.postMessage({ type: 'spawn', ...request }),
      },
      stdin: init.stdin,
      args: init.args,
      env: init.env,
      files: init.files,
      tid,
      startArg,
      onStdout: (bytes) => host.postMessage({ type: 'stdout', bytes }, [bytes.buffer]),
      onStderrLine: (line) => host.postMessage({ type: 'log', line }),
    })
    host.postMessage({ type: 'thread-exit', tid, code })
  } catch (error) {
    host.postMessage({
      type: 'thread-error',
      tid,
      message: error instanceof Error ? error.message : String(error),
    })
  } finally {
    releaseSlot(control, init.slot)
  }
})
