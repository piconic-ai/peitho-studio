// Turns a click on the preview canvas into a comment target, with no mode
// to switch into first (todo/archive/review-comment-ui.md): the slide list already
// moves between slides, so a click on the preview is free to mean "comment
// here". What it doesn't take for a comment:
//
// - a drag (the mouse moved between press and release) or a click that
//   leaves text selected — both are selecting text, which keeps working;
// - a click on a native control a layout's script drew (a button, a form
//   field, a `<summary>`, a media element's controls) — those are the
//   layout's own interaction;
// - anything outside the slide itself, such as the pins, which sit in the
//   host's light DOM and reach the shadow root through its overlay slot.
//
// Pure reading of what was hit happens in `domain/reviewComment.ts`; not
// unit-tested (a real DOM), covered by `e2e/review-comments.e2e.ts`.

import { fractionInRect, pinInSlide, type Point } from '../domain/geometry'
import { parseSourceSpan, targetKindOf, type PreviewClick, type PreviewHit, type PreviewPin } from '../domain/reviewComment'

export type { PreviewClick }

/** How far (CSS px) the mouse may move between press and release for it to
 * still be a click rather than a drag. */
const CLICK_SLOP = 4

const LAYOUT_CONTROLS = 'button, input, select, textarea, summary, label, video, audio, [contenteditable], [role="button"]'

const watched = new WeakMap<ShadowRoot, { onClick: (click: PreviewClick) => void; onMenu: (click: PreviewClick) => void }>()

/** Calls `onClick` for each click on `host`'s mounted slide that is meant
 * as a comment, and `onMenu` for each right-click on it — the app's own
 * menu, whose comment is on what a left-click there would be on. Safe to
 * call again for the same host (it re-mounts on every selection change);
 * the latest callbacks are the ones called. */
export function watchCommentClicks(host: HTMLElement, onClick: (click: PreviewClick) => void, onMenu: (click: PreviewClick) => void = () => {}): void {
  const root = host.shadowRoot
  if (!root) return
  const alreadyWatched = watched.has(root)
  watched.set(root, { onClick, onMenu })
  if (alreadyWatched) return
  let pressedAt: Point | null = null
  root.addEventListener('mousedown', event => {
    pressedAt = event instanceof MouseEvent && event.button === 0 ? { x: event.clientX, y: event.clientY } : null
  })
  root.addEventListener('click', event => {
    const from = pressedAt
    pressedAt = null
    if (!(event instanceof MouseEvent) || event.button !== 0) return
    if (from !== null && Math.hypot(event.clientX - from.x, event.clientY - from.y) > CLICK_SLOP) return
    if (!(document.getSelection()?.isCollapsed ?? true)) return
    const click = clickOf(event)
    if (click !== null) watched.get(root)?.onClick(click)
  })
  // A right-click: no drag or selection to tell apart. One outside the
  // slide, or on a layout's own control, keeps the webview's menu.
  root.addEventListener('contextmenu', event => {
    if (!(event instanceof MouseEvent)) return
    const click = clickOf(event)
    if (click === null) return
    event.preventDefault()
    watched.get(root)?.onMenu(click)
  })
}

/** What a click (or right-click) on the slide is on, as a comment target —
 * `null` outside the slide, or on a native control a layout's script
 * drew. */
function clickOf(event: MouseEvent): PreviewClick | null {
  const target = event.target instanceof Element ? event.target : null
  const slide = target?.closest<HTMLElement>('.peitho-slide') ?? null
  if (target === null || slide === null) return null
  if (target.closest(LAYOUT_CONTROLS)) return null
  const at = { x: event.clientX, y: event.clientY }
  const onSlide = fractionInRect(at, slide.getBoundingClientRect())
  const annotated = annotatedOf(target)
  const quote = annotated?.getAttribute('data-peitho-md') ?? ''
  const inElement = annotated === null || quote === '' ? null : fractionInRect(at, annotated.getBoundingClientRect())
  const pin = onSlide === null ? null : { ...onSlide, anchor: inElement === null ? null : { quote, ...inElement } }
  return { hit: hitOf(target), pin, at }
}

// peitho-core annotates a heading through a `<span>` around its text, so a
// click on the heading's empty width lands on the heading itself.
const HEADINGS = 'h1, h2, h3, h4, h5, h6'

function annotatedOf(target: Element): Element | null {
  return target.closest('[data-peitho-src]') ?? target.closest(HEADINGS)?.querySelector(':scope > [data-peitho-src]') ?? null
}

function hitOf(target: Element): PreviewHit | null {
  const annotated = annotatedOf(target)
  if (annotated === null) return null
  const kind = targetKindOf(annotated.tagName, annotated.parentElement?.tagName ?? null)
  if (kind === 'slide') return null
  const text = (kind === 'heading' && annotated.tagName === 'SPAN' ? annotated.parentElement : annotated)?.textContent ?? ''
  return {
    kind,
    text,
    byteSpan: parseSourceSpan(annotated.getAttribute('data-peitho-src')),
    quote: annotated.getAttribute('data-peitho-md') ?? '',
  }
}

/** Puts the caret in the comment box (`CommentBox.tsx`) once it shows. */
export function focusCommentBox(): void {
  requestAnimationFrame(() => document.querySelector<HTMLTextAreaElement>('[data-comment-box] textarea')?.focus())
}

/** `pins` with each anchored one moved to where its element now sits on the
 * preview's slide (`pinInSlide`) — a phone-shaped preview reflows the slide,
 * so the spot a pin was put on as a fraction of the slide no longer holds.
 * A pin whose element isn't there (edited away, or not rendered yet) keeps
 * its own `x`/`y`. */
export function placePreviewPins(pins: readonly PreviewPin[]): PreviewPin[] {
  const root = document.querySelector('[data-preview-host]')?.shadowRoot ?? null
  const slide = root?.querySelector('.peitho-slide') ?? null
  if (root === null || slide === null || pins.every(pin => pin.anchor === null)) return [...pins]
  const slideRect = slide.getBoundingClientRect()
  const annotated = Array.from(root.querySelectorAll('[data-peitho-md]'))
  return pins.map(pin => {
    const anchor = pin.anchor
    if (anchor === null) return pin
    const element = annotated.find(candidate => candidate.getAttribute('data-peitho-md') === anchor.quote)
    const placed = element === undefined ? null : pinInSlide(anchor, element.getBoundingClientRect(), slideRect)
    return placed === null ? pin : { ...pin, ...placed }
  })
}

/** Calls `onChange` whenever the preview's slide lays out anew on its own
 * — a web font or an image arriving after the slide mounted reflows its
 * text, most of all on a narrow phone-shaped canvas — until the returned
 * function stops it. Watches the slide as it is now; a new slide or render
 * needs a new watch. */
export function watchPreviewLayout(onChange: () => void): () => void {
  const root = document.querySelector('[data-preview-host]')?.shadowRoot ?? null
  const slide = root?.querySelector('.peitho-slide') ?? null
  if (root === null || slide === null) return () => {}
  let frame = 0
  const schedule = () => {
    cancelAnimationFrame(frame)
    frame = requestAnimationFrame(onChange)
  }
  const resized = new ResizeObserver(schedule)
  for (const element of [slide, ...Array.from(slide.querySelectorAll('*'))]) resized.observe(element, { box: 'border-box' })
  root.addEventListener('load', schedule, true)
  document.fonts.addEventListener('loadingdone', schedule)
  return () => {
    cancelAnimationFrame(frame)
    resized.disconnect()
    root.removeEventListener('load', schedule, true)
    document.fonts.removeEventListener('loadingdone', schedule)
  }
}

/** Scrolls the comments column to `threadKey`'s card
 * (`data-review-thread`), for a pin clicked on the preview. */
/** Puts the caret at the end of the unsent comment or reply being
 * rewritten, once its editor shows. Leaves a field that already has focus
 * alone: whoever focused it first may have already selected its text to
 * replace, and collapsing that selection would append instead. */
export function focusUnsentEdit(): void {
  requestAnimationFrame(() => {
    const field = document.querySelector<HTMLTextAreaElement>('[data-review-editing="true"] [data-review-edit-box] textarea')
    if (field === null || field === document.activeElement) return
    field.focus()
    field.setSelectionRange(field.value.length, field.value.length)
  })
}

export function revealReviewThread(threadKey: string): void {
  requestAnimationFrame(() => {
    document.querySelector(`[data-review-thread="${CSS.escape(threadKey)}"]`)?.scrollIntoView({ block: 'nearest', behavior: 'smooth' })
  })
}
