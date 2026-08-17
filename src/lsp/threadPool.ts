/**
 * Slot bookkeeping for guest threads, held in shared memory.
 *
 * `wasi.thread-spawn` has to return a thread id synchronously, from a worker
 * that is parked inside the guest's own code and cannot run its event loop. So
 * it can neither create a worker on demand (script loading would stall) nor
 * wait for a reply. Instead the host pre-spawns a pool of idle thread workers
 * and hands the spawning thread a `MessagePort` to each; claiming a slot and
 * minting a thread id are plain atomics on this control block.
 *
 * Layout, as Int32: [ nextThreadId | slot0 | slot1 | … ]
 */

const NEXT_TID = 0
const SLOT_BASE = 1

export const THREAD_IDLE = 0
export const THREAD_BUSY = 1

export function createThreadControl(poolSize: number): SharedArrayBuffer {
  if (poolSize < 1) throw new Error(`thread pool size must be at least 1, got ${poolSize}`)
  return new SharedArrayBuffer((SLOT_BASE + poolSize) * 4)
}

export function threadControlView(control: SharedArrayBuffer): Int32Array {
  return new Int32Array(control)
}

export function poolSizeOf(view: Int32Array): number {
  return view.length - SLOT_BASE
}

/**
 * Atomically takes an idle slot, or returns -1 when every thread is busy. The
 * caller reports that to the guest as a failed spawn (EAGAIN), which is a
 * legitimate outcome the guest's threading library already handles.
 */
export function claimSlot(view: Int32Array): number {
  const size = poolSizeOf(view)
  for (let slot = 0; slot < size; slot++) {
    if (Atomics.compareExchange(view, SLOT_BASE + slot, THREAD_IDLE, THREAD_BUSY) === THREAD_IDLE) {
      return slot
    }
  }
  return -1
}

/** Returns a slot to the pool once its guest thread has finished. */
export function releaseSlot(view: Int32Array, slot: number): void {
  Atomics.store(view, SLOT_BASE + slot, THREAD_IDLE)
  Atomics.notify(view, SLOT_BASE + slot)
}

/** Thread ids must be positive: the guest reads 0 or negative as failure. */
export function nextThreadId(view: Int32Array): number {
  return Atomics.add(view, NEXT_TID, 1) + 1
}
