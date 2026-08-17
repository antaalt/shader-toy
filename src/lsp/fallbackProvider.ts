/**
 * Local completion and hover for WGSL, registered only when no WASI language
 * server is available. Keeps the editor useful before a `.wasm` server is
 * dropped in, and makes it obvious which of the two is answering (every item
 * is labelled `wgsl (built-in)`).
 */
import * as monaco from 'monaco-editor'
import {
  WGSL_ATTRIBUTES,
  WGSL_BUILTINS,
  WGSL_KEYWORDS,
  WGSL_TYPES,
} from '../editor/wgslVocabulary'

const DETAIL = 'wgsl (built-in)'

interface Entry {
  label: string
  kind: monaco.languages.CompletionItemKind
  description: string
}

const ENTRIES: Entry[] = [
  ...WGSL_KEYWORDS.map((label) => ({
    label,
    kind: monaco.languages.CompletionItemKind.Keyword,
    description: 'WGSL keyword',
  })),
  ...WGSL_TYPES.map((label) => ({
    label,
    kind: monaco.languages.CompletionItemKind.Struct,
    description: 'WGSL predeclared type',
  })),
  ...WGSL_BUILTINS.map((label) => ({
    label,
    kind: monaco.languages.CompletionItemKind.Function,
    description: 'WGSL built-in function',
  })),
]

const BY_LABEL = new Map(ENTRIES.map((entry) => [entry.label, entry]))

export function registerFallbackProviders(languageId: string): monaco.IDisposable {
  const disposables = [
    monaco.languages.registerCompletionItemProvider(languageId, {
      provideCompletionItems: (model, position) => {
        const word = model.getWordUntilPosition(position)
        const range: monaco.IRange = {
          startLineNumber: position.lineNumber,
          endLineNumber: position.lineNumber,
          startColumn: word.startColumn,
          endColumn: word.endColumn,
        }

        // `@` starts an attribute, so offer those instead of identifiers.
        const linePrefix = model.getValueInRange({
          startLineNumber: position.lineNumber,
          startColumn: 1,
          endLineNumber: position.lineNumber,
          endColumn: position.column,
        })
        if (/@\w*$/.test(linePrefix)) {
          return {
            suggestions: WGSL_ATTRIBUTES.map((label) => ({
              label,
              kind: monaco.languages.CompletionItemKind.Property,
              insertText: label,
              detail: DETAIL,
              range,
            })),
          }
        }

        return {
          suggestions: ENTRIES.map((entry) => ({
            label: entry.label,
            kind: entry.kind,
            insertText: entry.label,
            detail: DETAIL,
            documentation: { value: entry.description },
            range,
          })),
        }
      },
    }),

    monaco.languages.registerHoverProvider(languageId, {
      provideHover: (model, position) => {
        const word = model.getWordAtPosition(position)
        if (!word) return null
        const entry = BY_LABEL.get(word.word)
        if (!entry) return null
        return {
          contents: [{ value: `**${entry.label}**` }, { value: `${entry.description} — ${DETAIL}` }],
          range: {
            startLineNumber: position.lineNumber,
            endLineNumber: position.lineNumber,
            startColumn: word.startColumn,
            endColumn: word.endColumn,
          },
        }
      },
    }),
  ]

  return {
    dispose() {
      for (const disposable of disposables) disposable.dispose()
    },
  }
}
