import * as monaco from 'monaco-editor'
import editorWorker from 'monaco-editor/esm/vs/editor/editor.worker?worker'
import { WGSL_LANGUAGE_ID } from './wgslVocabulary'
import { MONOKAI_THEME_ID, defineMonokaiTheme } from './monokaiTheme'

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

  defineMonokaiTheme()

  const editor = monaco.editor.create(container, {
    model,
    theme: MONOKAI_THEME_ID,
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

  let handle = { editor, model };
  onlyAllowEditingBetweenRanges(handle, collectEditableRanges(initialValue));
  return handle;
}

const EDITABLE_SECTION_START = 'EDITABLE-SECTION-START'
const EDITABLE_SECTION_END = 'EDITABLE-SECTION-END'

/**
 * Finds every `EDITABLE-SECTION-START` / `EDITABLE-SECTION-END` marker pair and
 * returns the 1-based line range *between* them (marker lines excluded).
 * Pairs with no line in between, and unterminated starts, are skipped.
 */
function collectEditableRanges(input: string): { startLine: number; endLine: number }[] {
  const ranges: { startLine: number; endLine: number }[] = []
  const lines = input.split(/\r?\n/)
  let openMarkerLine = -1

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    if (line.includes(EDITABLE_SECTION_START)) {
      openMarkerLine = i + 1
    } else if (line.includes(EDITABLE_SECTION_END) && openMarkerLine !== -1) {
      const startLine = openMarkerLine + 1
      const endLine = i // line before the end marker (i is 0-based, so i === lineNumber - 1)
      if (startLine <= endLine) ranges.push({ startLine, endLine })
      openMarkerLine = -1
    }
  }

  return ranges
}


function onlyAllowEditingBetweenRanges(editor: EditorHandle, editableLineRanges: { startLine: number; endLine: number }[]) {
		if (!editor.model) return;

		const decorations: monaco.editor.IModelDeltaDecoration[] = editableLineRanges.map(
			({ startLine, endLine }) => ({
				range: new monaco.Range(startLine, 1, endLine, editor.model.getLineMaxColumn(endLine)),
				options: {
					isWholeLine: true,
					className: 'editable-line',
					stickiness: monaco.editor.TrackedRangeStickiness.AlwaysGrowsWhenTypingAtEdges
				}
			})
		);

		const decorationCollection = editor.editor.createDecorationsCollection(decorations);

		editor.editor.onDidChangeCursorSelection((_event) => {
			const selection = editor.editor.getSelection();
			if (!selection) return;

			const selectionRange = new monaco.Range(
				selection.startLineNumber,
				selection.startColumn,
				selection.endLineNumber,
				selection.endColumn
			);

			const trackedRanges = decorationCollection.getRanges();

			const isInsideEditableRange = trackedRanges.some((range) => {
				return range.containsRange(selectionRange);
			});

			editor.editor.updateOptions({
				readOnly: !isInsideEditableRange
			});
		});
	}