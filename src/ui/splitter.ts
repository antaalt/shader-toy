/** Drag (or arrow-key) resize of the editor / renderer split. */

const MIN_PERCENT = 15
const MAX_PERCENT = 85
const KEYBOARD_STEP = 2

export function setupSplitter(splitter: HTMLElement, container: HTMLElement): void {
  let percent = 50

  const apply = (value: number) => {
    percent = Math.min(Math.max(value, MIN_PERCENT), MAX_PERCENT)
    container.style.setProperty('--split', `${percent}%`)
    splitter.setAttribute('aria-valuenow', String(Math.round(percent)))
  }

  splitter.addEventListener('pointerdown', (event: PointerEvent) => {
    event.preventDefault()
    splitter.setPointerCapture(event.pointerId)
    splitter.dataset.dragging = 'true'
    document.body.dataset.dragging = 'true'
  })

  splitter.addEventListener('pointermove', (event: PointerEvent) => {
    if (splitter.dataset.dragging !== 'true') return
    const bounds = container.getBoundingClientRect()
    apply(((event.clientX - bounds.left) / bounds.width) * 100)
  })

  const endDrag = (event: PointerEvent) => {
    if (splitter.dataset.dragging !== 'true') return
    delete splitter.dataset.dragging
    delete document.body.dataset.dragging
    if (splitter.hasPointerCapture(event.pointerId)) {
      splitter.releasePointerCapture(event.pointerId)
    }
  }
  splitter.addEventListener('pointerup', endDrag)
  splitter.addEventListener('pointercancel', endDrag)

  splitter.addEventListener('keydown', (event: KeyboardEvent) => {
    if (event.key === 'ArrowLeft') apply(percent - KEYBOARD_STEP)
    else if (event.key === 'ArrowRight') apply(percent + KEYBOARD_STEP)
    else if (event.key === 'Home') apply(50)
    else return
    event.preventDefault()
  })

  apply(percent)
}
