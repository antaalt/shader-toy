/**
 * Boots the real language server in public/lsp/ through the production host
 * code, and reports what it actually supports.
 *
 *   node --experimental-strip-types --import ./scratch/register.mjs scratch/testRealServer.mjs
 */
import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { LanguageClient } from '../src/lsp/languageClient.ts'
import { startSession } from './session.mjs'
import { LANGUAGE_SERVER } from '../src/config.ts'

const WASM = new URL('../public/lsp/shader-language-server.wasm', import.meta.url)
const SHADER = `@fragment fn fs_main() -> @location(0) vec4f { return vec4f(1.0); }`
const URI = 'file:///shader.wgsl'

const file = await readFile(fileURLToPath(WASM))
const wasm = file.buffer.slice(file.byteOffset, file.byteOffset + file.byteLength)

const session = await startSession({
  wasm,
  args: [...LANGUAGE_SERVER.args],
  env: [...LANGUAGE_SERVER.env],
  files: { 'shader.wgsl': SHADER },
})

console.log('module requirements:', JSON.stringify(session.info))

const logs = []
session.transport.onLog((line) => {
  logs.push(line)
  console.log('  stderr:', line)
})

await session.ready
console.log('instantiated and running\n')

const client = new LanguageClient(session.transport)

const diagnostics = new Promise((resolve) => {
  client.onNotification('textDocument/publishDiagnostics', resolve)
})
client.onNotification('window/logMessage', (p) => console.log('  logMessage:', p?.message))

const result = await client.initialize({ rootUri: 'file:///', clientName: 'shader-toy' })

console.log('serverInfo:', JSON.stringify(result.serverInfo))
console.log('capabilities:')
for (const [key, value] of Object.entries(result.capabilities)) {
  console.log(`  ${key}: ${JSON.stringify(value)}`)
}

client.notify('textDocument/didOpen', {
  textDocument: { uri: URI, languageId: LANGUAGE_SERVER.languageId, version: 1, text: SHADER },
})

const published = await Promise.race([
  diagnostics,
  new Promise((resolve) => setTimeout(() => resolve(null), 8_000)),
])
console.log('\ndiagnostics:', published ? JSON.stringify(published) : '(none within 8s)')

if (result.capabilities.hoverProvider) {
  const hover = await client
    .request('textDocument/hover', { textDocument: { uri: URI }, position: { line: 0, character: 14 } }, 8_000)
    .catch((error) => ({ error: error.message }))
  console.log('hover:', JSON.stringify(hover))
}

if (result.capabilities.completionProvider) {
  const completion = await client
    .request('textDocument/completion', { textDocument: { uri: URI }, position: { line: 0, character: 60 } }, 8_000)
    .catch((error) => ({ error: error.message }))
  const items = Array.isArray(completion) ? completion : completion?.items
  console.log('completion items:', Array.isArray(items) ? items.length : JSON.stringify(completion))
  if (Array.isArray(items)) console.log('  first few:', items.slice(0, 5).map((i) => i.label).join(', '))
}

await session.terminate()
console.log('\ndone')
process.exit(0)
