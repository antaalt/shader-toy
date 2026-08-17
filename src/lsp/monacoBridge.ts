/**
 * Wires a {@link LanguageClient} to a Monaco model: document synchronisation,
 * diagnostics as markers, and one provider per capability the server
 * advertises.
 */
import * as monaco from 'monaco-editor'
import type { LanguageClient } from './languageClient'
import type {
  CompletionItem,
  CompletionList,
  DocumentSymbol,
  Hover,
  Location,
  LocationLink,
  PublishDiagnosticsParams,
  ServerCapabilities,
  SignatureHelp,
  SymbolInformation,
} from './protocol'
import {
  toLspPosition,
  toMonacoCompletionItem,
  toMonacoDocumentSymbols,
  toMonacoHover,
  toMonacoMarker,
  toMonacoRange,
  toMonacoSignatureHelp,
} from './convert'

export interface BridgeOptions {
  client: LanguageClient
  model: monaco.editor.ITextModel
  languageId: string
  /** LSP language id sent in `didOpen`; often the same as the Monaco one. */
  languageIdForServer?: string
  capabilities: ServerCapabilities
  /** Marker owner, kept separate from the renderer's own markers. */
  markerOwner?: string
}

export interface Bridge {
  dispose(): void
}

/** How long a hover/completion request may take before it is abandoned. */
const REQUEST_TIMEOUT_MS = 5_000

export function attachToMonaco(options: BridgeOptions): Bridge {
  const { client, model, languageId, capabilities } = options
  const markerOwner = options.markerOwner ?? 'lsp'
  const uri = model.uri.toString()
  const disposables: monaco.IDisposable[] = []

  let version = 1

  client.notify('textDocument/didOpen', {
    textDocument: {
      uri,
      languageId: options.languageIdForServer ?? languageId,
      version,
      text: model.getValue(),
    },
  })

  // Full-text sync on every change. Shader documents are small, and syncing
  // eagerly (rather than debounced) guarantees a hover or completion never
  // races ahead of the server's view of the buffer.
  disposables.push(
    model.onDidChangeContent(() => {
      version += 1
      client.notify('textDocument/didChange', {
        textDocument: { uri, version },
        contentChanges: [{ text: model.getValue() }],
      })
    }),
  )

  disposables.push(
    { dispose: client.onNotification('textDocument/publishDiagnostics', (params) => {
        const diagnostics = params as PublishDiagnosticsParams
        if (diagnostics.uri !== uri) return
        monaco.editor.setModelMarkers(
          model,
          markerOwner,
          diagnostics.diagnostics.map(toMonacoMarker),
        )
      }) },
  )

  const request = async <T>(method: string, params: unknown): Promise<T | null> => {
    try {
      return (await client.request(method, params, REQUEST_TIMEOUT_MS)) as T | null
    } catch (error) {
      console.warn(`[lsp] ${method} failed`, error)
      return null
    }
  }

  const documentPosition = (position: monaco.Position) => ({
    textDocument: { uri },
    position: toLspPosition(position),
  })

  if (capabilities.hoverProvider) {
    disposables.push(
      monaco.languages.registerHoverProvider(languageId, {
        provideHover: async (target, position) => {
          if (target !== model) return null
          const hover = await request<Hover>('textDocument/hover', documentPosition(position))
          const word = model.getWordAtPosition(position)
          const fallback: monaco.IRange = {
            startLineNumber: position.lineNumber,
            endLineNumber: position.lineNumber,
            startColumn: word?.startColumn ?? position.column,
            endColumn: word?.endColumn ?? position.column,
          }
          return toMonacoHover(hover, fallback)
        },
      }),
    )
  }

  if (capabilities.completionProvider) {
    disposables.push(
      monaco.languages.registerCompletionItemProvider(languageId, {
        triggerCharacters: capabilities.completionProvider.triggerCharacters ?? ['.'],
        provideCompletionItems: async (target, position, context) => {
          if (target !== model) return { suggestions: [] }

          const result = await request<CompletionList | CompletionItem[]>(
            'textDocument/completion',
            {
              ...documentPosition(position),
              context: {
                triggerKind: context.triggerKind === 1 ? 1 : 2,
                triggerCharacter: context.triggerCharacter,
              },
            },
          )
          if (!result) return { suggestions: [] }

          const items = Array.isArray(result) ? result : result.items
          const incomplete = Array.isArray(result) ? false : result.isIncomplete

          // Monaco needs an explicit replacement range per item; default to the
          // word being typed.
          const word = model.getWordUntilPosition(position)
          const defaultRange: monaco.IRange = {
            startLineNumber: position.lineNumber,
            endLineNumber: position.lineNumber,
            startColumn: word.startColumn,
            endColumn: word.endColumn,
          }

          return {
            incomplete,
            suggestions: items.map((item) => toMonacoCompletionItem(item, defaultRange)),
          }
        },
      }),
    )
  }

  if (capabilities.signatureHelpProvider) {
    disposables.push(
      monaco.languages.registerSignatureHelpProvider(languageId, {
        signatureHelpTriggerCharacters:
          capabilities.signatureHelpProvider.triggerCharacters ?? ['(', ','],
        signatureHelpRetriggerCharacters:
          capabilities.signatureHelpProvider.retriggerCharacters ?? [')'],
        provideSignatureHelp: async (target, position) => {
          if (target !== model) return null
          const help = await request<SignatureHelp>(
            'textDocument/signatureHelp',
            documentPosition(position),
          )
          const converted = toMonacoSignatureHelp(help)
          return converted ? { value: converted, dispose: () => {} } : null
        },
      }),
    )
  }

  if (capabilities.definitionProvider) {
    disposables.push(
      monaco.languages.registerDefinitionProvider(languageId, {
        provideDefinition: async (target, position) => {
          if (target !== model) return null
          const result = await request<Location | Location[] | LocationLink[]>(
            'textDocument/definition',
            documentPosition(position),
          )
          if (!result) return null

          const entries = Array.isArray(result) ? result : [result]
          return entries.map((entry) =>
            'targetUri' in entry
              ? {
                  uri: monaco.Uri.parse(entry.targetUri),
                  range: toMonacoRange(entry.targetSelectionRange ?? entry.targetRange),
                }
              : { uri: monaco.Uri.parse(entry.uri), range: toMonacoRange(entry.range) },
          )
        },
      }),
    )
  }

  if (capabilities.documentSymbolProvider) {
    disposables.push(
      monaco.languages.registerDocumentSymbolProvider(languageId, {
        provideDocumentSymbols: async (target) => {
          if (target !== model) return []
          const result = await request<DocumentSymbol[] | SymbolInformation[]>(
            'textDocument/documentSymbol',
            { textDocument: { uri } },
          )
          if (!result || result.length === 0) return []

          // The response is either the hierarchical or the flat shape.
          if ('location' in result[0]) {
            return (result as SymbolInformation[]).map((symbol) => ({
              name: symbol.name,
              detail: '',
              kind: (symbol.kind - 1) as monaco.languages.SymbolKind,
              tags: [],
              range: toMonacoRange(symbol.location.range),
              selectionRange: toMonacoRange(symbol.location.range),
            }))
          }
          return toMonacoDocumentSymbols(result as DocumentSymbol[])
        },
      }),
    )
  }

  return {
    dispose() {
      for (const disposable of disposables) disposable.dispose()
      monaco.editor.setModelMarkers(model, markerOwner, [])
    },
  }
}
