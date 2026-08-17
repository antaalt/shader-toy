// Node stand-in for src/lsp/threadWorker.ts: same runWasiThread call, driven by
// parentPort instead of the browser's message events.
import { parentPort, workerData } from 'node:worker_threads'
import { runWasiThread } from '../src/lsp/wasiHost.ts'
import { releaseSlot, threadControlView } from '../src/lsp/threadPool.ts'

const { module, memory, stdin, control, slot, args, env, files } = workerData
const view = threadControlView(control)

parentPort.on('message', (message) => {
  if (message?.type !== 'thread-run') return
  const { tid, startArg } = message

  try {
    const code = runWasiThread({
      module,
      memory: memory ?? null,
      threads: {
        control,
        requestSpawn: (request) => parentPort.postMessage({ type: 'spawn', ...request }),
      },
      stdin,
      args,
      env,
      files,
      tid,
      startArg,
      onStdout: (bytes) => parentPort.postMessage({ type: 'stdout', bytes }, [bytes.buffer]),
      onStderrLine: (line) => parentPort.postMessage({ type: 'log', line }),
    })
    parentPort.postMessage({ type: 'thread-exit', tid, code })
  } catch (error) {
    parentPort.postMessage({ type: 'thread-error', tid, message: String(error?.stack ?? error) })
  } finally {
    releaseSlot(view, slot)
  }
})
