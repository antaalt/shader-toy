import './style.css'
import * as monaco from 'monaco-editor'
import { LANGUAGE_SERVER } from './config'
import { createEditor, WORKSPACE_URI } from './editor/setupEditor'
import { WGSL_LANGUAGE_ID } from './editor/wgslVocabulary'
import { registerFallbackProviders } from './lsp/fallbackProvider'
import { LanguageClient } from './lsp/languageClient'
import { attachToMonaco } from './lsp/monacoBridge'
import { probeWasiServer, startWasiServer } from './lsp/wasiTransport'
import { ShaderRenderer, type CompileMessage } from './renderer/renderer'
import { DEFAULT_SHADER } from './shader/defaultShader'
import { setupSplitter } from './ui/splitter'

const RENDERER_MARKER_OWNER = 'webgpu'
const RECOMPILE_DEBOUNCE_MS = 300

const app = requireElement('app')
const editorContainer = requireElement('editor')
const splitter = requireElement('splitter')
const canvas = requireElement('gpu-canvas') as HTMLCanvasElement
const overlay = requireElement('gpu-overlay')
const renderStatus = requireElement('render-status')
const lspStatus = requireElement('lsp-status')

setupSplitter(splitter, app)

const { editor, model } = await createEditor(editorContainer, DEFAULT_SHADER)

void startRenderer()
void startLanguageServer()

/* -- WebGPU ------------------------------------------------------------- */

async function startRenderer(): Promise<void> {
  let renderer: ShaderRenderer
  try {
    renderer = await ShaderRenderer.create(canvas)
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    overlay.textContent = message
    overlay.hidden = false
    setStatus(renderStatus, 'unavailable', 'error')
    return
  }

  const compile = async () => {
    const result = await renderer.setShader(model.getValue())
    monaco.editor.setModelMarkers(
      model,
      RENDERER_MARKER_OWNER,
      result.messages.map(toMarker),
    )

    const errors = result.messages.filter((m) => m.severity === 'error').length
    const warnings = result.messages.filter((m) => m.severity === 'warning').length

    if (errors > 0) {
      setStatus(renderStatus, `${errors} error${errors === 1 ? '' : 's'}`, 'error')
    } else if (warnings > 0) {
      setStatus(renderStatus, `${warnings} warning${warnings === 1 ? '' : 's'}`, 'warn')
    } else {
      setStatus(renderStatus, 'compiled', 'ok')
    }
  }

  await compile()
  renderer.start()

  let timer: ReturnType<typeof setTimeout> | undefined
  model.onDidChangeContent(() => {
    if (timer !== undefined) clearTimeout(timer)
    timer = setTimeout(() => void compile(), RECOMPILE_DEBOUNCE_MS)
  })

  window.addEventListener('beforeunload', () => renderer.dispose())
}

/** WebGPU reports line 0 when it cannot attribute a message to a location. */
function toMarker(message: CompileMessage): monaco.editor.IMarkerData {
  const line = message.line > 0 ? message.line : 1
  const column = message.column > 0 ? message.column : 1
  return {
    message: message.message,
    severity:
      message.severity === 'error'
        ? monaco.MarkerSeverity.Error
        : message.severity === 'warning'
          ? monaco.MarkerSeverity.Warning
          : monaco.MarkerSeverity.Info,
    source: 'webgpu',
    startLineNumber: line,
    startColumn: column,
    endLineNumber: line,
    endColumn: column + Math.max(message.length, 1),
  }
}

/* -- Language server ---------------------------------------------------- */

async function startLanguageServer(): Promise<void> {
  const probe = await probeWasiServer(LANGUAGE_SERVER.wasmUrl)
  if (!probe.ok) {
    useFallback(probe.reason)
    return
  }

  try {
    const transport = await startWasiServer(probe.wasm, {
      args: [...LANGUAGE_SERVER.args],
      env: [...LANGUAGE_SERVER.env],
      // Snapshot of the workspace as the server sees it on disk. Live edits
      // are delivered via textDocument/didChange, not through this.
      files: { 'shader.wgsl': model.getValue() },
    })

    transport.onLog((line) => console.info('[lsp]', line))

    const client = new LanguageClient(transport)
    client.onNotification('window/logMessage', (params) => {
      console.info('[lsp]', (params as { message?: string }).message ?? params)
    })
    client.onNotification('window/showMessage', (params) => {
      console.warn('[lsp]', (params as { message?: string }).message ?? params)
    })

    const result = await client.initialize({
      rootUri: WORKSPACE_URI,
      clientName: 'shader-toy',
    })

    attachToMonaco({
      client,
      model,
      languageId: WGSL_LANGUAGE_ID,
      languageIdForServer: LANGUAGE_SERVER.languageId,
      capabilities: result.capabilities,
    })

    transport.onClose((reason) => {
      console.error('[lsp]', reason)
      setStatus(lspStatus, 'lsp: stopped', 'error')
      monaco.editor.setModelMarkers(model, 'lsp', [])
    })

    const name = result.serverInfo?.name ?? 'wasi server'
    const version = result.serverInfo?.version ? ` ${result.serverInfo.version}` : ''
    setStatus(lspStatus, `lsp: ${name}${version}`, 'ok')
    window.addEventListener('beforeunload', () => void client.stop())
  } catch (error) {
    useFallback(error instanceof Error ? error.message : String(error))
  }
}

function useFallback(reason: string): void {
  console.warn(
    `[lsp] no WASI language server (${reason}); using the built-in WGSL word list instead. ` +
      `See public/lsp/README.md to add one.`,
  )
  registerFallbackProviders(WGSL_LANGUAGE_ID)
  setStatus(lspStatus, 'lsp: built-in', 'warn')
  lspStatus.title = `No WASI language server: ${reason}`
}

/* -- Helpers ------------------------------------------------------------ */

function setStatus(element: HTMLElement, text: string, state: 'ok' | 'warn' | 'error'): void {
  element.textContent = text
  element.dataset.state = state
}

function requireElement(id: string): HTMLElement {
  const element = document.getElementById(id)
  if (!element) throw new Error(`Missing #${id} in index.html`)
  return element
}

// Focus the editor so the page is immediately usable.
editor.focus()
