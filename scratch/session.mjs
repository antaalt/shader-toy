/**
 * Node mirror of the page-side orchestration in src/lsp/wasiTransport.ts:
 * compile once, provision shared memory, pre-spawn the thread pool, relay
 * spawn requests, wire the transport. Only the worker plumbing differs
 * (node:worker_threads instead of browser Workers), so the src/lsp code under
 * test is the real thing.
 */
import { Worker } from 'node:worker_threads'
import { fileURLToPath } from 'node:url'
import { encodeMessage, MessageDecoder } from '../src/lsp/framing.ts'
import { createPipeBuffer, SharedPipeWriter } from '../src/lsp/sharedPipe.ts'
import { createThreadControl } from '../src/lsp/threadPool.ts'
import { inspectModule } from '../src/lsp/wasmModuleInfo.ts'

const EXEC_ARGV = [
  '--experimental-strip-types',
  '--import',
  new URL('./register.mjs', import.meta.url).href,
]

export async function startSession({ wasm, args, env, files, maxThreads = 4 }) {
  const module = await WebAssembly.compile(wasm)
  const info = inspectModule(new Uint8Array(wasm), module)

  const declared = info.memoryImport
  const memory = declared
    ? new WebAssembly.Memory(
        declared.maximum === undefined
          ? { initial: declared.initial }
          : { initial: declared.initial, maximum: declared.maximum, shared: declared.shared },
      )
    : null

  const threadControl = info.needsThreads ? createThreadControl(maxThreads) : null
  const stdin = createPipeBuffer()
  const writer = new SharedPipeWriter(stdin)
  const decoder = new MessageDecoder()

  const messageHandlers = []
  const logHandlers = []
  const closeHandlers = []
  const emit = (handlers, value) => handlers.forEach((handler) => handler(value))

  const acceptStdout = (bytes) => {
    decoder.append(bytes)
    for (const parsed of decoder.drain()) emit(messageHandlers, parsed)
  }

  const threadWorkers = []
  const relaySpawn = ({ slot, tid, startArg }) => {
    const target = threadWorkers[slot]
    if (!target) {
      emit(logHandlers, `[wasi] spawn for unknown thread slot ${slot}`)
      return
    }
    target.postMessage({ type: 'thread-run', tid, startArg })
  }

  const guestSetup = { module, memory, stdin, args, env, files }

  if (threadControl) {
    for (let slot = 0; slot < maxThreads; slot++) {
      const threadWorker = new Worker(fileURLToPath(new URL('./threadWorker.mjs', import.meta.url)), {
        workerData: { ...guestSetup, control: threadControl, slot },
        execArgv: EXEC_ARGV,
      })
      threadWorker.on('message', (message) => {
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
          case 'thread-error':
            emit(logHandlers, `[thread ${message.tid}] failed: ${message.message}`)
            break
        }
      })
      threadWorker.on('error', (error) => emit(logHandlers, `[thread slot ${slot}] ${error.message}`))
      threadWorkers.push(threadWorker)
    }
  }

  const worker = new Worker(fileURLToPath(new URL('./wasiHost.worker.mjs', import.meta.url)), {
    workerData: { ...guestSetup, threadControl },
    execArgv: EXEC_ARGV,
  })

  const transport = {
    send: (message) => writer.write(encodeMessage(message)),
    onMessage: (handler) => messageHandlers.push(handler),
    onLog: (handler) => logHandlers.push(handler),
    onClose: (handler) => closeHandlers.push(handler),
    dispose: () => writer.close(),
  }

  const ready = new Promise((resolve, reject) => {
    worker.on('message', (message) => {
      switch (message.type) {
        case 'ready':
          resolve()
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
          emit(closeHandlers, `exited with code ${message.code}`)
          break
        case 'error':
          reject(new Error(message.message))
          emit(closeHandlers, message.message)
          break
      }
    })
    worker.on('error', reject)
  })

  return {
    info,
    transport,
    ready,
    writer,
    async terminate() {
      await Promise.all([worker.terminate(), ...threadWorkers.map((w) => w.terminate())])
    },
  }
}
