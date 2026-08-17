import * as monaco from 'monaco-editor'
import editorWorker from 'monaco-editor/esm/vs/editor/editor.worker?worker'
import { WGSL_LANGUAGE_ID } from './wgslVocabulary'

// Only the base editor worker is needed: the document is WGSL, and none of
// Monaco's bundled language services (ts/json/css/html) are used.
window.MonacoEnvironment = {
  getWorker: () => new editorWorker(),
}

/** URI the language server sees for the edited document. */
export const DOCUMENT_URI = 'file:///shader.wgsl'

/** Workspace root advertised to the language server. */
export const WORKSPACE_URI = 'file:///'

export interface EditorHandle {
  editor: monaco.editor.IStandaloneCodeEditor
  model: monaco.editor.ITextModel
}

export function createEditor(container: HTMLElement, initialValue: string): EditorHandle {
  // `wgsl` is contributed by monaco-editor's basic-languages bundle; creating a
  // model with that language id triggers its lazy tokenizer load.
  const model = monaco.editor.createModel(
    initialValue,
    WGSL_LANGUAGE_ID,
    monaco.Uri.parse(DOCUMENT_URI),
  )

  const editor = monaco.editor.create(container, {
    model,
    theme: 'vs-dark',
    automaticLayout: true,
    fontSize: 13,
    fontLigatures: true,
    lineNumbersMinChars: 3,
    minimap: { enabled: false },
    scrollBeyondLastLine: false,
    smoothScrolling: true,
    renderWhitespace: 'selection',
    tabSize: 2,
    // Suppress Monaco's word-based suggestions so the suggest widget shows
    // only what the language server (or the fallback provider) offers.
    suggest: { showWords: false },
    quickSuggestions: { other: true, comments: false, strings: false },
  })

  return { editor, model }
}
