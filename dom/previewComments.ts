// Turns a click on the preview canvas into a comment target, with no mode
// to switch into first (todo/review-comment-ui.md): the slide list already
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

import { fractionInRect, type Point } from '../domain/geometry'
import { parseSourceSpan, targetKindOf, type PreviewHit } from '../domain/reviewComment'

export interface PreviewClick {
  /** The annotated element clicked, or `null` for the slide as a whole. */
  hit: PreviewHit | null
  /** Where on the slide, as fractions of its width and height. */
  pin: Point | null
  /** Where on screen, for placing the comment box. */
  at: Point
}

/** How far (CSS px) the mouse may move between press and release for it to
 * still be a click rather than a drag. */
const CLICK_SLOP = 4

const LAYOUT_CONTROLS = 'button, input, select, textarea, summary, label, video, audio, [contenteditable], [role="button"]'

const watched = new WeakMap<ShadowRoot, (click: PreviewClick) => void>()

/** Calls `onClick` for each click on `host`'s mounted slide that is meant
 * as a comment. Safe to call again for the same host (it re-mounts on every
 * selection change); the latest `onClick` is the one called. */
export function watchCommentClicks(host: HTMLElement, onClick: (click: PreviewClick) => void): void {
  const root = host.shadowRoot
  if (!root) return
  const alreadyWatched = watched.has(root)
  watched.set(root, onClick)
  if (alreadyWatched) return
  let pressedAt: Point | null = null
  root.addEventListener('mousedown', event => {
    pressedAt = event instanceof MouseEvent && event.button === 0 ? { x: event.clientX, y: event.clientY } : null
  })
  root.addEventListener('click', event => {
    const from = pressedAt
    pressedAt = null
    if (!(event instanceof MouseEvent) || event.button !== 0) return
    const target = event.target instanceof Element ? event.target : null
    const slide = target?.closest<HTMLElement>('.peitho-slide') ?? null
    if (target === null || slide === null) return
    if (from !== null && Math.hypot(event.clientX - from.x, event.clientY - from.y) > CLICK_SLOP) return
    if (!(document.getSelection()?.isCollapsed ?? true)) return
    if (target.closest(LAYOUT_CONTROLS)) return
    const at = { x: event.clientX, y: event.clientY }
    watched.get(root)?.({ hit: hitOf(target), pin: fractionInRect(at, slide.getBoundingClientRect()), at })
  })
}

// peitho-core annotates a heading through a `<span>` around its text, so a
// click on the heading's empty width lands on the heading itself.
const HEADINGS = 'h1, h2, h3, h4, h5, h6'

function hitOf(target: Element): PreviewHit | null {
  const annotated = target.closest('[data-peitho-src]') ?? target.closest(HEADINGS)?.querySelector(':scope > [data-peitho-src]') ?? null
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
