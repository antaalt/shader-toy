/**
 * Just enough wasm binary parsing to set up a threads-enabled module.
 *
 * A `wasm32-wasip1-threads` build imports its memory instead of defining one,
 * and the host has to supply a `WebAssembly.Memory` whose limits match the
 * declaration exactly. `WebAssembly.Module.imports()` only reports names and
 * kinds — not limits — so the import section has to be read directly.
 */

export interface MemoryImport {
  module: string
  name: string
  /** In 64 KiB pages. */
  initial: number
  /** In 64 KiB pages; absent when the declaration has no upper bound. */
  maximum?: number
  shared: boolean
}

export interface ModuleRequirements {
  /** Non-null when the module imports its memory rather than defining one. */
  memoryImport: MemoryImport | null
  /** True when the module imports `wasi.thread-spawn` (the wasi-threads ABI). */
  needsThreads: boolean
  /** The entry point the host calls on a spawned thread. */
  hasThreadStart: boolean
  /** A WASI command entry point. */
  hasStart: boolean
}

interface Cursor {
  offset: number
}

const MAGIC = [0x00, 0x61, 0x73, 0x6d]
const IMPORT_SECTION = 2

const IMPORT_FUNC = 0x00
const IMPORT_TABLE = 0x01
const IMPORT_MEMORY = 0x02
const IMPORT_GLOBAL = 0x03

const LIMITS_HAS_MAX = 0x01
const LIMITS_SHARED = 0x02
const LIMITS_MEMORY64 = 0x04

export function inspectModule(bytes: Uint8Array, compiled: WebAssembly.Module): ModuleRequirements {
  const imports = WebAssembly.Module.imports(compiled)
  const exports = WebAssembly.Module.exports(compiled)

  return {
    memoryImport: findMemoryImport(bytes),
    needsThreads: imports.some(
      (entry) => entry.module === 'wasi' && entry.name === 'thread-spawn',
    ),
    hasThreadStart: exports.some((entry) => entry.name === 'wasi_thread_start'),
    hasStart: exports.some((entry) => entry.name === '_start'),
  }
}

/** Returns the first imported memory, or null when the module defines its own. */
export function findMemoryImport(bytes: Uint8Array): MemoryImport | null {
  if (bytes.length < 8 || MAGIC.some((byte, index) => bytes[index] !== byte)) {
    throw new Error('not a WebAssembly binary')
  }

  // Skip magic + version. A component would have a different version word; the
  // caller reports that separately via the failed instantiation.
  const cursor: Cursor = { offset: 8 }

  while (cursor.offset < bytes.length) {
    const id = readByte(bytes, cursor)
    const size = readVarU32(bytes, cursor)
    const sectionEnd = cursor.offset + size

    if (id === IMPORT_SECTION) {
      const count = readVarU32(bytes, cursor)
      for (let i = 0; i < count; i++) {
        const module = readName(bytes, cursor)
        const name = readName(bytes, cursor)
        const kind = readByte(bytes, cursor)

        switch (kind) {
          case IMPORT_FUNC:
            readVarU32(bytes, cursor) // type index
            break
          case IMPORT_TABLE:
            readByte(bytes, cursor) // reference type
            readLimits(bytes, cursor)
            break
          case IMPORT_MEMORY:
            return { module, name, ...readLimits(bytes, cursor) }
          case IMPORT_GLOBAL:
            readByte(bytes, cursor) // value type
            readByte(bytes, cursor) // mutability
            break
          default:
            throw new Error(`unknown import kind 0x${kind.toString(16)}`)
        }
      }
      return null
    }

    cursor.offset = sectionEnd
  }

  return null
}

function readLimits(
  bytes: Uint8Array,
  cursor: Cursor,
): { initial: number; maximum?: number; shared: boolean } {
  const flags = readByte(bytes, cursor)
  if ((flags & LIMITS_MEMORY64) !== 0) {
    throw new Error('memory64 modules are not supported')
  }

  const initial = readVarU32(bytes, cursor)
  const shared = (flags & LIMITS_SHARED) !== 0
  if ((flags & LIMITS_HAS_MAX) === 0) return { initial, shared }
  return { initial, maximum: readVarU32(bytes, cursor), shared }
}

function readName(bytes: Uint8Array, cursor: Cursor): string {
  const length = readVarU32(bytes, cursor)
  const start = cursor.offset
  cursor.offset += length
  return new TextDecoder().decode(bytes.subarray(start, start + length))
}

function readByte(bytes: Uint8Array, cursor: Cursor): number {
  const byte = bytes[cursor.offset]
  if (byte === undefined) throw new Error('unexpected end of wasm binary')
  cursor.offset += 1
  return byte
}

function readVarU32(bytes: Uint8Array, cursor: Cursor): number {
  let result = 0
  let shift = 0
  for (;;) {
    const byte = readByte(bytes, cursor)
    result |= (byte & 0x7f) << shift
    if ((byte & 0x80) === 0) return result >>> 0
    shift += 7
    if (shift > 28) throw new Error('LEB128 value out of range')
  }
}
