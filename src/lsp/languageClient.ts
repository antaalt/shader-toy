/**
 * A small JSON-RPC 2.0 / LSP client over a {@link Transport}.
 *
 * Deliberately narrow: it handles the initialize handshake, requests,
 * notifications, and the handful of server-to-client requests that servers
 * block on if nobody answers them.
 */
import type { Transport } from './wasiTransport'
import type { InitializeResult } from './protocol'

interface ResponseMessage {
  jsonrpc: '2.0'
  id: number | string
  result?: unknown
  error?: { code: number; message: string; data?: unknown }
}

interface RequestMessage {
  jsonrpc: '2.0'
  id?: number | string
  method: string
  params?: unknown
}

const METHOD_NOT_FOUND = -32601

export interface ClientOptions {
  rootUri: string
  clientName?: string
  initializationOptions?: unknown
  /** How long to wait for the `initialize` response before giving up. */
  initializeTimeoutMs?: number
}

export class LanguageClient {
  private nextId = 1
  private readonly pending = new Map<
    number,
    { resolve: (value: unknown) => void; reject: (error: Error) => void }
  >()
  private readonly notificationHandlers = new Map<string, Set<(params: unknown) => void>>()
  private readonly requestHandlers = new Map<string, (params: unknown) => unknown>()
  private closedReason: string | null = null
  private readonly transport: Transport

  constructor(transport: Transport) {
    this.transport = transport
    transport.onMessage((message) => this.handleMessage(message))
    transport.onClose((reason) => this.handleClose(reason))

    // Servers commonly wait on these; a plain acknowledgement is enough for a
    // client with no dynamic registration and no settings to report.
    this.onRequest('client/registerCapability', () => null)
    this.onRequest('client/unregisterCapability', () => null)
    this.onRequest('window/workDoneProgress/create', () => null)
    this.onRequest('window/showMessageRequest', () => null)
    this.onRequest('workspace/applyEdit', () => ({ applied: false }))
    this.onRequest('workspace/configuration', (params) => {
      const items = (params as { items?: unknown[] } | undefined)?.items ?? []
      return items.map(() => null)
    })
  }

  async initialize(options: ClientOptions): Promise<InitializeResult> {
    const result = (await this.request(
      'initialize',
      {
        processId: null,
        clientInfo: { name: options.clientName ?? 'shader-toy', version: '1.0.0' },
        locale: 'en',
        rootUri: options.rootUri,
        workspaceFolders: [{ uri: options.rootUri, name: 'workspace' }],
        initializationOptions: options.initializationOptions ?? null,
        capabilities: {
          general: { positionEncodings: ['utf-16'] },
          workspace: {
            workspaceFolders: true,
            configuration: true,
            didChangeConfiguration: { dynamicRegistration: false },
          },
          textDocument: {
            synchronization: {
              dynamicRegistration: false,
              willSave: false,
              didSave: false,
            },
            publishDiagnostics: { relatedInformation: true, versionSupport: true },
            hover: { contentFormat: ['markdown', 'plaintext'] },
            completion: {
              completionItem: {
                snippetSupport: true,
                documentationFormat: ['markdown', 'plaintext'],
                commitCharactersSupport: false,
                deprecatedSupport: true,
                preselectSupport: true,
              },
              contextSupport: true,
            },
            signatureHelp: {
              signatureInformation: {
                documentationFormat: ['markdown', 'plaintext'],
                parameterInformation: { labelOffsetSupport: true },
              },
            },
            definition: { linkSupport: true },
            documentSymbol: { hierarchicalDocumentSymbolSupport: true },
          },
        },
      },
      options.initializeTimeoutMs ?? 15_000,
    )) as InitializeResult
    this.notify('initialized', {})
    return result
  }

  request(method: string, params?: unknown, timeoutMs?: number): Promise<unknown> {
    if (this.closedReason !== null) {
      return Promise.reject(new Error(`language server unavailable: ${this.closedReason}`))
    }

    const id = this.nextId++
    return new Promise<unknown>((resolve, reject) => {
      let timer: ReturnType<typeof setTimeout> | undefined
      if (timeoutMs !== undefined) {
        timer = setTimeout(() => {
          this.pending.delete(id)
          reject(new Error(`${method} timed out after ${timeoutMs}ms`))
        }, timeoutMs)
      }

      this.pending.set(id, {
        resolve: (value) => {
          if (timer !== undefined) clearTimeout(timer)
          resolve(value)
        },
        reject: (error) => {
          if (timer !== undefined) clearTimeout(timer)
          reject(error)
        },
      })

      this.transport.send({ jsonrpc: '2.0', id, method, params })
    })
  }

  notify(method: string, params?: unknown): void {
    if (this.closedReason !== null) return
    this.transport.send({ jsonrpc: '2.0', method, params })
  }

  onNotification(method: string, handler: (params: unknown) => void): () => void {
    let handlers = this.notificationHandlers.get(method)
    if (!handlers) {
      handlers = new Set()
      this.notificationHandlers.set(method, handlers)
    }
    handlers.add(handler)
    return () => handlers?.delete(handler)
  }

  onRequest(method: string, handler: (params: unknown) => unknown): void {
    this.requestHandlers.set(method, handler)
  }

  /** Best-effort graceful shutdown; the transport is torn down regardless. */
  async stop(): Promise<void> {
    if (this.closedReason === null) {
      try {
        await this.request('shutdown', null, 1_000)
        this.notify('exit')
      } catch {
        // The server is going away either way.
      }
    }
    this.closedReason ??= 'client stopped'
    this.transport.dispose()
  }

  private handleMessage(message: unknown): void {
    if (typeof message !== 'object' || message === null) return

    if ('method' in message) {
      this.handleIncoming(message as RequestMessage)
      return
    }

    const response = message as ResponseMessage
    const id = typeof response.id === 'number' ? response.id : Number(response.id)
    const pending = this.pending.get(id)
    if (!pending) return
    this.pending.delete(id)

    if (response.error) {
      pending.reject(new Error(`${response.error.message} (code ${response.error.code})`))
    } else {
      pending.resolve(response.result)
    }
  }

  private handleIncoming(message: RequestMessage): void {
    // Notification: no id, no reply.
    if (message.id === undefined) {
      const handlers = this.notificationHandlers.get(message.method)
      if (!handlers || handlers.size === 0) return
      for (const handler of handlers) {
        try {
          handler(message.params)
        } catch (error) {
          console.error(`[lsp] handler for ${message.method} threw`, error)
        }
      }
      return
    }

    const handler = this.requestHandlers.get(message.method)
    if (!handler) {
      this.transport.send({
        jsonrpc: '2.0',
        id: message.id,
        error: { code: METHOD_NOT_FOUND, message: `Unhandled method ${message.method}` },
      })
      return
    }

    try {
      this.transport.send({ jsonrpc: '2.0', id: message.id, result: handler(message.params) })
    } catch (error) {
      this.transport.send({
        jsonrpc: '2.0',
        id: message.id,
        error: {
          code: METHOD_NOT_FOUND,
          message: error instanceof Error ? error.message : String(error),
        },
      })
    }
  }

  private handleClose(reason: string): void {
    if (this.closedReason !== null) return
    this.closedReason = reason
    const error = new Error(`language server unavailable: ${reason}`)
    for (const pending of this.pending.values()) pending.reject(error)
    this.pending.clear()
  }
}
