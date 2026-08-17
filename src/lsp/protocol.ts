/**
 * The subset of the Language Server Protocol this client speaks. Hand-written
 * rather than pulled from `vscode-languageserver-protocol` to keep the
 * dependency surface (and the version matrix against monaco-editor) empty.
 */

export interface Position {
  line: number // 0-based
  character: number // 0-based, UTF-16 code units
}

export interface Range {
  start: Position
  end: Position
}

export interface Location {
  uri: string
  range: Range
}

export interface LocationLink {
  targetUri: string
  targetRange: Range
  targetSelectionRange: Range
  originSelectionRange?: Range
}

export interface MarkupContent {
  kind: 'plaintext' | 'markdown'
  value: string
}

export type MarkedString = string | { language: string; value: string }

export interface TextEdit {
  range: Range
  newText: string
}

export const DiagnosticSeverity = {
  Error: 1,
  Warning: 2,
  Information: 3,
  Hint: 4,
} as const
export type DiagnosticSeverity = (typeof DiagnosticSeverity)[keyof typeof DiagnosticSeverity]

export interface DiagnosticRelatedInformation {
  location: Location
  message: string
}

export interface Diagnostic {
  range: Range
  severity?: DiagnosticSeverity
  code?: number | string
  source?: string
  message: string
  tags?: number[]
  relatedInformation?: DiagnosticRelatedInformation[]
}

export interface PublishDiagnosticsParams {
  uri: string
  version?: number
  diagnostics: Diagnostic[]
}

export interface Hover {
  contents: MarkupContent | MarkedString | MarkedString[]
  range?: Range
}

export const InsertTextFormat = {
  PlainText: 1,
  Snippet: 2,
} as const
export type InsertTextFormat = (typeof InsertTextFormat)[keyof typeof InsertTextFormat]

export interface CompletionItem {
  label: string
  kind?: number
  detail?: string
  documentation?: string | MarkupContent
  deprecated?: boolean
  preselect?: boolean
  sortText?: string
  filterText?: string
  insertText?: string
  insertTextFormat?: InsertTextFormat
  textEdit?: TextEdit | { range: Range; newText: string }
  additionalTextEdits?: TextEdit[]
  commitCharacters?: string[]
}

export interface CompletionList {
  isIncomplete: boolean
  items: CompletionItem[]
}

export interface ParameterInformation {
  label: string | [number, number]
  documentation?: string | MarkupContent
}

export interface SignatureInformation {
  label: string
  documentation?: string | MarkupContent
  parameters?: ParameterInformation[]
  activeParameter?: number
}

export interface SignatureHelp {
  signatures: SignatureInformation[]
  activeSignature?: number
  activeParameter?: number
}

export interface DocumentSymbol {
  name: string
  detail?: string
  kind: number
  range: Range
  selectionRange: Range
  children?: DocumentSymbol[]
}

export interface SymbolInformation {
  name: string
  kind: number
  location: Location
  containerName?: string
}

export interface CompletionOptions {
  triggerCharacters?: string[]
  resolveProvider?: boolean
}

export interface SignatureHelpOptions {
  triggerCharacters?: string[]
  retriggerCharacters?: string[]
}

export interface ServerCapabilities {
  textDocumentSync?: number | { openClose?: boolean; change?: number }
  hoverProvider?: boolean | object
  completionProvider?: CompletionOptions
  signatureHelpProvider?: SignatureHelpOptions
  definitionProvider?: boolean | object
  documentSymbolProvider?: boolean | object
  documentFormattingProvider?: boolean | object
  [key: string]: unknown
}

export interface InitializeResult {
  capabilities: ServerCapabilities
  serverInfo?: { name: string; version?: string }
}
