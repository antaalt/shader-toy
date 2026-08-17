/**
 * LSP base protocol framing: `Content-Length: N\r\n\r\n<N bytes of JSON>`.
 */

const encoder = new TextEncoder()
const decoder = new TextDecoder('utf-8')

export function encodeMessage(message: unknown): Uint8Array {
  const body = encoder.encode(JSON.stringify(message))
  const header = encoder.encode(`Content-Length: ${body.length}\r\n\r\n`)
  const frame = new Uint8Array(header.length + body.length)
  frame.set(header, 0)
  frame.set(body, header.length)
  return frame
}

/**
 * Accumulates raw stdout bytes and yields whole messages as they complete.
 * Content-Length counts bytes, not characters, so the split has to happen on
 * the byte buffer before decoding.
 */
export class MessageDecoder {
  private buffer = new Uint8Array(0)

  append(chunk: Uint8Array): void {
    const next = new Uint8Array(this.buffer.length + chunk.length)
    next.set(this.buffer, 0)
    next.set(chunk, this.buffer.length)
    this.buffer = next
  }

  /** Yields every complete message currently buffered. */
  *drain(): Generator<unknown> {
    for (;;) {
      const headerEnd = indexOfDoubleCrlf(this.buffer)
      if (headerEnd < 0) return

      const header = decoder.decode(this.buffer.subarray(0, headerEnd))
      const contentLength = parseContentLength(header)
      if (contentLength === null) {
        // Unrecoverable: without a length there is no way to find the next
        // frame boundary. Drop the bad header and resynchronise.
        this.buffer = this.buffer.subarray(headerEnd + 4)
        continue
      }

      const bodyStart = headerEnd + 4
      if (this.buffer.length < bodyStart + contentLength) return

      const body = this.buffer.subarray(bodyStart, bodyStart + contentLength)
      this.buffer = this.buffer.subarray(bodyStart + contentLength)

      try {
        yield JSON.parse(decoder.decode(body)) as unknown
      } catch (error) {
        console.error('[lsp] dropped unparseable message', error)
      }
    }
  }
}

function indexOfDoubleCrlf(bytes: Uint8Array): number {
  for (let i = 0; i + 3 < bytes.length; i++) {
    if (bytes[i] === 13 && bytes[i + 1] === 10 && bytes[i + 2] === 13 && bytes[i + 3] === 10) {
      return i
    }
  }
  return -1
}

function parseContentLength(header: string): number | null {
  for (const line of header.split('\r\n')) {
    const separator = line.indexOf(':')
    if (separator < 0) continue
    if (line.slice(0, separator).trim().toLowerCase() !== 'content-length') continue
    const value = Number.parseInt(line.slice(separator + 1).trim(), 10)
    return Number.isFinite(value) && value >= 0 ? value : null
  }
  return null
}
