// Blocking reader half of the sharedPipe test, run under node:worker_threads.
import { parentPort, workerData } from 'node:worker_threads'
import { SharedPipeReader } from '../src/lsp/sharedPipe.ts'

const reader = new SharedPipeReader(workerData.buffer)
const chunks = []
const scratch = new Uint8Array(workerData.readSize)

for (;;) {
  const n = reader.read(scratch)
  if (n === 0) break // writer closed and drained
  chunks.push(scratch.slice(0, n))
}

const total = chunks.reduce((sum, c) => sum + c.length, 0)
const joined = new Uint8Array(total)
let offset = 0
for (const chunk of chunks) {
  joined.set(chunk, offset)
  offset += chunk.length
}

parentPort.postMessage({ total, bytes: joined }, [joined.buffer])
