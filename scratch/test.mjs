/**
 * Verifies the two pure-logic pieces of the LSP transport that can be tested
 * outside a browser: the SharedArrayBuffer pipe (blocking read, ring
 * wraparound, backpressure, EOF) and Content-Length framing.
 *
 *   node --experimental-strip-types scratch/test.mjs
 */
import { Worker } from 'node:worker_threads'
import assert from 'node:assert/strict'
import { fileURLToPath } from 'node:url'
import { createPipeBuffer, SharedPipeWriter } from '../src/lsp/sharedPipe.ts'
import { encodeMessage, MessageDecoder } from '../src/lsp/framing.ts'

let failures = 0
function check(name, fn) {
  try {
    fn()
    console.log(`  ok   ${name}`)
  } catch (error) {
    failures++
    console.log(`  FAIL ${name}\n       ${error.message}`)
  }
}

/* -- pipe --------------------------------------------------------------- */

async function testPipe({ capacity, payloadSize, chunkSize, readSize, label }) {
  // A capacity far smaller than the payload forces wraparound and forces the
  // writer's backpressure path (pending queue + retry timer).
  const buffer = createPipeBuffer(capacity)
  const writer = new SharedPipeWriter(buffer)

  const payload = new Uint8Array(payloadSize)
  for (let i = 0; i < payloadSize; i++) payload[i] = (i * 31 + (i >> 8)) & 0xff

  const worker = new Worker(fileURLToPath(new URL('./pipeReader.worker.mjs', import.meta.url)), {
    workerData: { buffer, readSize },
    execArgv: ['--experimental-strip-types'],
  })

  const received = new Promise((resolve, reject) => {
    worker.on('message', resolve)
    worker.on('error', reject)
  })

  for (let offset = 0; offset < payloadSize; offset += chunkSize) {
    writer.write(payload.subarray(offset, Math.min(offset + chunkSize, payloadSize)))
    // Yield so the retry timer can drain a full ring.
    await new Promise((resolve) => setTimeout(resolve, 0))
  }

  // Wait for the writer to hand everything over before signalling EOF.
  while (writer.pending.length > 0) await new Promise((resolve) => setTimeout(resolve, 2))
  writer.close()

  const result = await received
  await worker.terminate()

  console.log(`\n  ${label}`)
  check('all bytes arrive', () => assert.equal(result.total, payloadSize))
  check('bytes arrive in order and intact', () => {
    assert.equal(result.bytes.length, payload.length)
    for (let i = 0; i < payload.length; i++) {
      if (result.bytes[i] !== payload[i]) {
        throw new Error(`byte ${i}: expected ${payload[i]}, got ${result.bytes[i]}`)
      }
    }
  })
}

/* -- framing ------------------------------------------------------------ */

function testFraming() {
  console.log('\n  framing')

  check('round-trips a message', () => {
    const decoder = new MessageDecoder()
    decoder.append(encodeMessage({ jsonrpc: '2.0', id: 1, method: 'initialize' }))
    const messages = [...decoder.drain()]
    assert.equal(messages.length, 1)
    assert.equal(messages[0].method, 'initialize')
  })

  check('reassembles a message split across chunks', () => {
    const decoder = new MessageDecoder()
    const frame = encodeMessage({ id: 7, result: { hello: 'world' } })
    for (let i = 0; i < frame.length; i++) {
      decoder.append(frame.subarray(i, i + 1))
      const messages = [...decoder.drain()]
      if (i < frame.length - 1) {
        assert.equal(messages.length, 0, `emitted early at byte ${i}`)
      } else {
        assert.equal(messages.length, 1)
        assert.equal(messages[0].result.hello, 'world')
      }
    }
  })

  check('splits two messages in one chunk', () => {
    const decoder = new MessageDecoder()
    const a = encodeMessage({ id: 1 })
    const b = encodeMessage({ id: 2 })
    const both = new Uint8Array(a.length + b.length)
    both.set(a, 0)
    both.set(b, a.length)
    decoder.append(both)
    const messages = [...decoder.drain()]
    assert.equal(messages.length, 2)
    assert.deepEqual(
      messages.map((m) => m.id),
      [1, 2],
    )
  })

  check('counts bytes, not characters, for multi-byte UTF-8', () => {
    // "é" and "→" are 2 and 3 bytes: a character-based length would desync.
    const decoder = new MessageDecoder()
    const message = { message: 'café → naïve ✨ 蛍' }
    decoder.append(encodeMessage(message))
    const messages = [...decoder.drain()]
    assert.equal(messages.length, 1)
    assert.equal(messages[0].message, message.message)
  })

  check('recovers after a header with no Content-Length', () => {
    const decoder = new MessageDecoder()
    decoder.append(new TextEncoder().encode('X-Nonsense: 1\r\n\r\n'))
    decoder.append(encodeMessage({ id: 42 }))
    const messages = [...decoder.drain()]
    assert.equal(messages.length, 1)
    assert.equal(messages[0].id, 42)
  })
}

/* -- run ---------------------------------------------------------------- */

console.log('sharedPipe + framing')

// Tiny ring, large payload: every wraparound and backpressure path is hit.
await testPipe({
  capacity: 64,
  payloadSize: 20_000,
  chunkSize: 300,
  readSize: 37,
  label: 'pipe: 64-byte ring, 20 KB payload, odd read size',
})

// Realistic sizes.
await testPipe({
  capacity: 1 << 20,
  payloadSize: 500_000,
  chunkSize: 8_192,
  readSize: 65_536,
  label: 'pipe: 1 MiB ring, 500 KB payload',
})

testFraming()

console.log(failures === 0 ? '\nall passed' : `\n${failures} failed`)
process.exit(failures === 0 ? 0 : 1)
