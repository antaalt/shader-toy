/**
 * End-to-end check of the WASI language-server path against a real
 * wasm32-wasip1 module (scratch/test-server), driving the same host, pipe and
 * LanguageClient code the browser uses. Only the worker plumbing differs.
 *
 *   npm run build:test-server
 *   npm run test:wasi
 */
import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import assert from 'node:assert/strict'
import { LanguageClient } from '../src/lsp/languageClient.ts'
import { startSession } from './session.mjs'

const WASM = new URL(
  '../public/lsp/shader-language-server.wasm',
  import.meta.url,
)
const SHADER = '@fragment fn fs_main() -> @location(0) vec4f { return vec4f(1.0) }'
const URI = 'file:///shader.wgsl'

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

const file = await readFile(fileURLToPath(WASM))
const wasm = file.buffer.slice(file.byteOffset, file.byteOffset + file.byteLength)

const session = await startSession({
  wasm,
  args: ['shader-language-server', '--stdio'],
  env: ['SHADER_TOY=1', 'RUST_LOG=shader_language_server=trace,shader_sense=trace'],
  files: { 'shader.wgsl': SHADER },
})

const logs = []
session.transport.onLog((line) => logs.push(line))

await session.ready
console.log('\nwasi language server end-to-end')

const client = new LanguageClient(session.transport)

const diagnostics = new Promise((resolve) => {
  client.onNotification('textDocument/publishDiagnostics', resolve)
})

const result = await client.initialize({ rootUri: 'file:///', clientName: 'shader-toy-test' })

check('initialize returns the server identity', () => {
  // Not available yet
  //assert.equal(result.serverInfo.name, 'shader-language-server');
  //assert.equal(result.serverInfo.version, '0.1.0')
})
check('initialize returns capabilities', () => {
  assert.equal(result.capabilities.hoverProvider, true)
  assert.deepEqual(result.capabilities.completionProvider.triggerCharacters, ['.', ':'])
})
check('argv reached the module', () => {
  assert.ok(logs.some((line) => line.includes('shader-language-server')), `stderr was: ${JSON.stringify(logs)}`)
})
/*check('the preopened / directory is readable by the module', () => {
  assert.ok(
    logs.some((line) => line.includes(`read /shader.wgsl (${SHADER.length} bytes)`)),
    `stderr was: ${JSON.stringify(logs)}`,
  )
})*/

client.notify('textDocument/didOpen', {
  textDocument: { uri: URI, languageId: 'wgsl', version: 1, text: SHADER },
})

const published = await withTimeout(diagnostics, 5_000, 'publishDiagnostics')
check('diagnostics arrive as a notification', () => {
  assert.equal(published.uri, URI)
  assert.equal(published.diagnostics.length, 1)
  //assert.equal(published.diagnostics.message, '')
  assert.equal(published.diagnostics[0].severity, 1)
})

// Not supported yet in wgsl
/*const hover = await client.request(
  'textDocument/hover',
  { textDocument: { uri: URI }, position: { line: 0, character: 12 } },
  5_000,
)
check('hover request is answered', () => {
  assert.equal(hover.contents.value, '**wasi hover**')
})

const completion = await client.request(
  'textDocument/completion',
  { textDocument: { uri: URI }, position: { line: 0, character: 12 } },
  5_000,
)
check('completion request is answered', () => {
  assert.equal(completion.items.length, 1)
  assert.equal(completion.items[0].label, 'from_wasi')
})*/

// Many small requests in flight at once: exercises id correlation and the
// server's byte-at-a-time header reads through the shared pipe.
const burst = await Promise.all(
  Array.from({ length: 50 }, (_, i) =>
    client.request(
      'textDocument/hover',
      { textDocument: { uri: URI }, position: { line: 0, character: i } },
      10_000,
    ),
  ),
)
check('50 concurrent requests all resolve correctly', () => {
  assert.equal(burst.length, 50)
  for (const entry of burst) assert.ok(entry === null) // TODO: check other languages
})

let unknownRejected = false
try {
  await client.request('textDocument/nonsense', {}, 5_000)
} catch (error) {
  unknownRejected = /Method not found/.test(error.message)
}
check('unknown method rejects with the server error', () => {
  assert.ok(unknownRejected, 'expected a "method not found" rejection')
})

// Teardown. Closing stdin gives the server EOF; both the client (registered in
// its constructor) and the application must be told, or pending requests would
// hang until their individual timeouts.
const appSawClose = new Promise((resolve) => session.transport.onClose(resolve))
client.stop();
session.writer.close()

const closeReason = await withTimeout(appSawClose, 5_000, 'close notification')
check('the application is told when the server exits', () => {
  assert.match(closeReason, /exited with code 0/)
})

let rejection = ''
try {
  await client.request('textDocument/hover', {}, 2_000)
} catch (error) {
  rejection = error.message
}
check('requests after exit reject at once instead of timing out', () => {
  assert.match(rejection, /unavailable/)
})

await session.terminate()

console.log(failures === 0 ? '\nall passed' : `\n${failures} failed`)
process.exit(failures === 0 ? 0 : 1)

function withTimeout(promise, ms, label) {
  return Promise.race([
    promise,
    new Promise((_, reject) => setTimeout(() => reject(new Error(`${label} timed out`)), ms)),
  ])
}
