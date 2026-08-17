/** Conversions between LSP payloads and Monaco's editor model types. */
import * as monaco from 'monaco-editor'
import {
  DiagnosticSeverity,
  InsertTextFormat,
  type CompletionItem,
  type Diagnostic,
  type DocumentSymbol,
  type Hover,
  type MarkedString,
  type MarkupContent,
  type Position,
  type Range,
  type SignatureHelp,
} from './protocol'

export function toLspPosition(position: monaco.IPosition): Position {
  return { line: position.lineNumber - 1, character: position.column - 1 }
}

export function toMonacoRange(range: Range): monaco.IRange {
  return {
    startLineNumber: range.start.line + 1,
    startColumn: range.start.character + 1,
    endLineNumber: range.end.line + 1,
    endColumn: range.end.character + 1,
  }
}

export function toMonacoSeverity(severity: DiagnosticSeverity | undefined): monaco.MarkerSeverity {
  switch (severity) {
    case DiagnosticSeverity.Error:
      return monaco.MarkerSeverity.Error
    case DiagnosticSeverity.Warning:
      return monaco.MarkerSeverity.Warning
    case DiagnosticSeverity.Information:
      return monaco.MarkerSeverity.Info
    case DiagnosticSeverity.Hint:
      return monaco.MarkerSeverity.Hint
    default:
      // Servers may omit severity; the spec leaves interpretation to the
      // client and an error is the safer default for a shader compiler.
      return monaco.MarkerSeverity.Error
  }
}

export function toMonacoMarker(diagnostic: Diagnostic): monaco.editor.IMarkerData {
  const range = toMonacoRange(diagnostic.range)
  return {
    ...range,
    message: diagnostic.message,
    severity: toMonacoSeverity(diagnostic.severity),
    source: diagnostic.source,
    code: diagnostic.code === undefined ? undefined : String(diagnostic.code),
    relatedInformation: diagnostic.relatedInformation?.map((related) => ({
      resource: monaco.Uri.parse(related.location.uri),
      message: related.message,
      ...toMonacoRange(related.location.range),
    })),
  }
}

function markedStringToMarkdown(value: MarkedString): string {
  if (typeof value === 'string') return value
  return ['```' + value.language, value.value, '```'].join('\n')
}

export function toMarkdown(
  content: MarkupContent | MarkedString | MarkedString[] | string | undefined,
): monaco.IMarkdownString | undefined {
  if (content === undefined || content === null) return undefined

  if (typeof content === 'string') {
    return content.length > 0 ? { value: content } : undefined
  }
  if (Array.isArray(content)) {
    const value = content.map(markedStringToMarkdown).filter(Boolean).join('\n\n')
    return value.length > 0 ? { value } : undefined
  }
  if ('kind' in content) {
    if (content.value.length === 0) return undefined
    // Plaintext still goes through the markdown renderer, so escape it.
    return content.kind === 'markdown'
      ? { value: content.value }
      : { value: content.value.replace(/([\\`*_{}[\]()#+\-.!])/g, '\\$1') }
  }
  return { value: markedStringToMarkdown(content) }
}

export function toMonacoHover(hover: Hover | null, fallback: monaco.IRange): monaco.languages.Hover | null {
  if (!hover) return null
  const markdown = toMarkdown(hover.contents)
  if (!markdown) return null
  return {
    contents: [markdown],
    range: hover.range ? toMonacoRange(hover.range) : fallback,
  }
}

/** LSP CompletionItemKind (1-based) to Monaco's differently-ordered enum. */
const COMPLETION_KINDS: monaco.languages.CompletionItemKind[] = [
  monaco.languages.CompletionItemKind.Text, // 1  Text
  monaco.languages.CompletionItemKind.Method, // 2  Method
  monaco.languages.CompletionItemKind.Function, // 3  Function
  monaco.languages.CompletionItemKind.Constructor, // 4  Constructor
  monaco.languages.CompletionItemKind.Field, // 5  Field
  monaco.languages.CompletionItemKind.Variable, // 6  Variable
  monaco.languages.CompletionItemKind.Class, // 7  Class
  monaco.languages.CompletionItemKind.Interface, // 8  Interface
  monaco.languages.CompletionItemKind.Module, // 9  Module
  monaco.languages.CompletionItemKind.Property, // 10 Property
  monaco.languages.CompletionItemKind.Unit, // 11 Unit
  monaco.languages.CompletionItemKind.Value, // 12 Value
  monaco.languages.CompletionItemKind.Enum, // 13 Enum
  monaco.languages.CompletionItemKind.Keyword, // 14 Keyword
  monaco.languages.CompletionItemKind.Snippet, // 15 Snippet
  monaco.languages.CompletionItemKind.Color, // 16 Color
  monaco.languages.CompletionItemKind.File, // 17 File
  monaco.languages.CompletionItemKind.Reference, // 18 Reference
  monaco.languages.CompletionItemKind.Folder, // 19 Folder
  monaco.languages.CompletionItemKind.EnumMember, // 20 EnumMember
  monaco.languages.CompletionItemKind.Constant, // 21 Constant
  monaco.languages.CompletionItemKind.Struct, // 22 Struct
  monaco.languages.CompletionItemKind.Event, // 23 Event
  monaco.languages.CompletionItemKind.Operator, // 24 Operator
  monaco.languages.CompletionItemKind.TypeParameter, // 25 TypeParameter
]

export function toMonacoCompletionKind(kind: number | undefined): monaco.languages.CompletionItemKind {
  if (kind === undefined) return monaco.languages.CompletionItemKind.Text
  return COMPLETION_KINDS[kind - 1] ?? monaco.languages.CompletionItemKind.Text
}

export function toMonacoCompletionItem(
  item: CompletionItem,
  defaultRange: monaco.IRange,
): monaco.languages.CompletionItem {
  const edit = item.textEdit
  const range = edit ? toMonacoRange(edit.range) : defaultRange
  const insertText = edit?.newText ?? item.insertText ?? item.label

  const converted: monaco.languages.CompletionItem = {
    label: item.label,
    kind: toMonacoCompletionKind(item.kind),
    insertText,
    range,
    detail: item.detail,
    documentation: toMarkdown(item.documentation),
    sortText: item.sortText,
    filterText: item.filterText,
    preselect: item.preselect,
    additionalTextEdits: item.additionalTextEdits?.map((textEdit) => ({
      range: toMonacoRange(textEdit.range),
      text: textEdit.newText,
    })),
  }

  if (item.insertTextFormat === InsertTextFormat.Snippet) {
    converted.insertTextRules = monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet
  }
  if (item.deprecated) {
    converted.tags = [monaco.languages.CompletionItemTag.Deprecated]
  }
  return converted
}

export function toMonacoSignatureHelp(help: SignatureHelp | null): monaco.languages.SignatureHelp | null {
  if (!help || help.signatures.length === 0) return null
  return {
    signatures: help.signatures.map((signature) => ({
      label: signature.label,
      documentation: toMarkdown(signature.documentation),
      parameters: (signature.parameters ?? []).map((parameter) => ({
        label: parameter.label,
        documentation: toMarkdown(parameter.documentation),
      })),
      activeParameter: signature.activeParameter,
    })),
    activeSignature: help.activeSignature ?? 0,
    activeParameter: help.activeParameter ?? 0,
  }
}

/**
 * LSP SymbolKind is 1-based over the same ordering as Monaco's 0-based
 * SymbolKind, so the mapping is a shift.
 */
export function toMonacoSymbolKind(kind: number): monaco.languages.SymbolKind {
  return (kind - 1) as monaco.languages.SymbolKind
}

export function toMonacoDocumentSymbols(
  symbols: DocumentSymbol[],
): monaco.languages.DocumentSymbol[] {
  return symbols.map((symbol) => ({
    name: symbol.name,
    detail: symbol.detail ?? '',
    kind: toMonacoSymbolKind(symbol.kind),
    tags: [],
    range: toMonacoRange(symbol.range),
    selectionRange: toMonacoRange(symbol.selectionRange),
    children: symbol.children ? toMonacoDocumentSymbols(symbol.children) : undefined,
  }))
}
