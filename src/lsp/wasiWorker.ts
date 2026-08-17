/**
 * Browser adapter around {@link runWasiCommand}: receives one `start` message,
 * then bridges the server's stdio to the page over `postMessage`.
 *
 * After `start` this worker never returns to its event loop — the server is
 * parked in a blocking read on stdin — so it will not see any further
 * messages. stdin arrives through shared memory instead, thread spawns are
 * pushed out to the page, and shutting the server down means
 * `worker.terminate()`.
 */
import { runWasiCommand } from './wasiHost'
import type { StartMessage, WorkerToHost } from './workerProtocol'

interface WorkerScope {
  postMessage(message: WorkerToHost, transfer?: Transferable[]): void
  addEventListener(type: 'message', listener: (event: MessageEvent) => void): void
}

const host = globalThis as unknown as WorkerScope

host.addEventListener('message', (event: MessageEvent) => {
  const message = event.data as StartMessage
  if (message?.type !== 'start') return

  const threadControl = message.threadControl
  try {
    const code = runWasiCommand({
      module: message.module,
      memory: message.memory,
      threads: threadControl
        ? {
            control: threadControl,
            requestSpawn: ({ slot, tid, startArg }) =>
              host.postMessage({ type: 'spawn', slot, tid, startArg }),
          }
        : null,
      stdin: message.stdin,
      args: message.args,
      env: message.env,
      files: message.files,
      onStdout: (bytes) => host.postMessage({ type: 'stdout', bytes }, [bytes.buffer]),
      onStderrLine: (line) => host.postMessage({ type: 'log', line }),
      onReady: () => host.postMessage({ type: 'ready' }),
    })
    host.postMessage({ type: 'exit', code })
  } catch (error) {
    host.postMessage({
      type: 'error',
      message: error instanceof Error ? error.message : String(error),
    })
  }
})
