/**
 * A single-producer / single-consumer byte pipe over a SharedArrayBuffer.
 *
 * This exists because a WASI command module drives its own read loop: once
 * `WASI.start()` is called the worker is parked inside `fd_read` on stdin and
 * will never return to the event loop, so it cannot receive `postMessage`.
 * The main thread therefore writes stdin bytes straight into shared memory and
 * the worker blocks on `Atomics.wait`.
 *
 * Requires the document to be cross-origin isolated (see vite.config.ts).
 *
 * Layout: [ 4 x int32 control | capacity bytes of ring data ]
 *
 * `writePos`/`readPos` are monotonic counters taken modulo `wrap` (a multiple
 * of `capacity`), which keeps "empty" and "full" distinguishable without
 * wasting a slot.
 */

const CTRL_WRITE = 0
const CTRL_READ = 1
const CTRL_CLOSED = 2
/** Guards the read side, which has more than one consumer — see below. */
const CTRL_READ_LOCK = 3
const CTRL_COUNT = 4 // also keeps the data region 16-byte aligned
const HEADER_BYTES = CTRL_COUNT * 4

/** 1 MiB of in-flight stdin is far more than LSP traffic needs. */
export const DEFAULT_CAPACITY = 1 << 20

export function createPipeBuffer(capacity: number = DEFAULT_CAPACITY): SharedArrayBuffer {
  if (typeof SharedArrayBuffer === 'undefined') {
    throw new Error(
      'SharedArrayBuffer is unavailable. The page must be cross-origin isolated ' +
        '(Cross-Origin-Opener-Policy: same-origin, Cross-Origin-Embedder-Policy: require-corp).',
    )
  }
  if (capacity <= 0 || capacity > 0x20000000) {
    throw new Error(`Pipe capacity out of range: ${capacity}`)
  }
  return new SharedArrayBuffer(HEADER_BYTES + capacity)
}

abstract class PipeEnd {
  protected readonly ctrl: Int32Array
  protected readonly data: Uint8Array
  protected readonly capacity: number
  /** Counters wrap here; always a multiple of capacity and below 2^31. */
  protected readonly wrap: number

  constructor(buffer: SharedArrayBuffer) {
    this.capacity = buffer.byteLength - HEADER_BYTES
    this.ctrl = new Int32Array(buffer, 0, CTRL_COUNT)
    this.data = new Uint8Array(buffer, HEADER_BYTES, this.capacity)
    this.wrap = this.capacity * Math.max(1, Math.floor(0x40000000 / this.capacity))
  }

  protected used(writePos: number, readPos: number): number {
    return (writePos - readPos + this.wrap) % this.wrap
  }
}

/** Main-thread end. Never blocks; queues whatever does not fit. */
export class SharedPipeWriter extends PipeEnd {
  private pending: Uint8Array[] = []
  private retryTimer: ReturnType<typeof setTimeout> | null = null

  write(bytes: Uint8Array): void {
    if (bytes.length > 0) this.pending.push(bytes)
    this.flush()
  }

  close(): void {
    Atomics.store(this.ctrl, CTRL_CLOSED, 1)
    Atomics.notify(this.ctrl, CTRL_WRITE)
    if (this.retryTimer !== null) {
      clearTimeout(this.retryTimer)
      this.retryTimer = null
    }
  }

  private flush(): void {
    while (this.pending.length > 0) {
      const chunk = this.pending[0]
      const written = this.tryWrite(chunk)
      if (written < chunk.length) {
        // Ring is full: keep the remainder and wait for the reader to drain.
        this.pending[0] = chunk.subarray(written)
        this.scheduleRetry()
        return
      }
      this.pending.shift()
    }
    if (this.retryTimer !== null) {
      clearTimeout(this.retryTimer)
      this.retryTimer = null
    }
  }

  private scheduleRetry(): void {
    if (this.retryTimer !== null) return
    this.retryTimer = setTimeout(() => {
      this.retryTimer = null
      this.flush()
    }, 2)
  }

  private tryWrite(chunk: Uint8Array): number {
    const writePos = Atomics.load(this.ctrl, CTRL_WRITE)
    const readPos = Atomics.load(this.ctrl, CTRL_READ)
    const free = this.capacity - this.used(writePos, readPos)
    const count = Math.min(free, chunk.length)
    if (count === 0) return 0

    const start = writePos % this.capacity
    const firstRun = Math.min(count, this.capacity - start)
    this.data.set(chunk.subarray(0, firstRun), start)
    if (firstRun < count) this.data.set(chunk.subarray(firstRun, count), 0)

    // Publishing the new write position also releases the data written above.
    Atomics.store(this.ctrl, CTRL_WRITE, (writePos + count) % this.wrap)
    Atomics.notify(this.ctrl, CTRL_WRITE)
    return count
  }
}

/**
 * Worker-thread end. `read` blocks, which is the whole point.
 *
 * More than one thread may hold a reader: the guest's threads share one set of
 * file descriptors, exactly as they would in a real process, so whichever guest
 * thread owns stdin does the reading. In practice only one ever does, but a
 * lock is still needed — without it two concurrent readers could both copy the
 * same bytes before either advanced the read position.
 *
 * The lock is only held across "data is available → copy → advance", never
 * across the blocking wait, so a reader parked waiting for input cannot stall
 * the others.
 */
export class SharedPipeReader extends PipeEnd {
  /**
   * Copies at least one byte into `dest`, blocking until data is available.
   * Returns 0 only once the writer has closed the pipe and it is drained,
   * which the caller should surface to WASI as end-of-file.
   */
  read(dest: Uint8Array): number {
    if (dest.length === 0) return 0

    for (;;) {
      const writePos = Atomics.load(this.ctrl, CTRL_WRITE)
      if (this.used(writePos, Atomics.load(this.ctrl, CTRL_READ)) === 0) {
        if (Atomics.load(this.ctrl, CTRL_CLOSED) === 1) return 0
        // Waits on the exact writePos just observed, so a write racing with
        // this call cannot be missed.
        Atomics.wait(this.ctrl, CTRL_WRITE, writePos)
        continue
      }

      const count = this.consume(dest)
      if (count > 0) return count
      // Another reader beat us to it; look again.
    }
  }

  /** Copies under the read lock. Returns 0 if the pipe emptied first. */
  private consume(dest: Uint8Array): number {
    this.acquireReadLock()
    try {
      const writePos = Atomics.load(this.ctrl, CTRL_WRITE)
      const readPos = Atomics.load(this.ctrl, CTRL_READ)
      const available = this.used(writePos, readPos)
      if (available === 0) return 0

      const count = Math.min(available, dest.length)
      const start = readPos % this.capacity
      const firstRun = Math.min(count, this.capacity - start)
      dest.set(this.data.subarray(start, start + firstRun), 0)
      if (firstRun < count) dest.set(this.data.subarray(0, count - firstRun), firstRun)

      // Published only after the copy, so the writer cannot reuse the bytes
      // while they are still being read.
      Atomics.store(this.ctrl, CTRL_READ, (readPos + count) % this.wrap)
      Atomics.notify(this.ctrl, CTRL_READ)
      return count
    } finally {
      this.releaseReadLock()
    }
  }

  private acquireReadLock(): void {
    for (;;) {
      if (Atomics.compareExchange(this.ctrl, CTRL_READ_LOCK, 0, 1) === 0) return
      // Timed wait: a holder that releases between the exchange and the wait
      // would otherwise leave us parked on a notify that already happened.
      Atomics.wait(this.ctrl, CTRL_READ_LOCK, 1, 50)
    }
  }

  private releaseReadLock(): void {
    Atomics.store(this.ctrl, CTRL_READ_LOCK, 0)
    Atomics.notify(this.ctrl, CTRL_READ_LOCK)
  }
}
