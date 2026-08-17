// Node stand-in for src/lsp/wasiWorker.ts: same runWasiCommand call, with
// parentPort in place of the browser's postMessage.
import { parentPort, workerData } from 'node:worker_threads'
import { runWasiCommand } from '../src/lsp/wasiHost.ts'

const { module, memory, stdin, threadControl, args, env, files } = workerData

try {
  const code = runWasiCommand({
    module,
    memory: memory ?? null,
    threads: threadControl
      ? {
          control: threadControl,
          requestSpawn: (request) => parentPort.postMessage({ type: 'spawn', ...request }),
        }
      : null,
    stdin,
    args,
    env,
    files,
    onStdout: (bytes) => parentPort.postMessage({ type: 'stdout', bytes }, [bytes.buffer]),
    onStderrLine: (line) => parentPort.postMessage({ type: 'log', line }),
    onReady: () => parentPort.postMessage({ type: 'ready' }),
  })
  parentPort.postMessage({ type: 'exit', code })
} catch (error) {
  parentPort.postMessage({ type: 'error', message: String(error?.stack ?? error) })
}
