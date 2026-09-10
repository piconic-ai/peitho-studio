import { createSignal, createMemo } from '@barefootjs/client'
import { type DragState } from '../domain/drag'
import { type ContextMenu, appendIndex as computeAppendIndex } from '../domain/contextMenu'
import { scopeRootToHost, splitFontFaceRules } from '../domain/slideCss'

const SLIDE_LIST_WIDTH = 176
const EDITOR_WIDTH = 420

/** Transient UI-only state that doesn't belong to any single deck/editor
 * concept: the thumbnail drag gesture, the right-click context menu (+ its
 * "Change Layout" submenu preview cache), the in-app clipboard, the Present
 * dropdown, and the two resizable column widths.
 *
 * Orchestration that spans this store and another concern — `startSlideDrag`
 * ending in a call to `reorderSlides`, `openContextMenu` also calling
 * `selectSlide` — stays in `Studio.tsx` (the composition root) rather than
 * here, so this store's own surface stays state-only: reading/transitioning
 * `dragState`/`contextMenu` and nothing that reaches into another store or
 * the IPC layer.
 *
 * A factory function (not signals declared at module scope) so `bun
 * test`/multiple windows each get their own independent instance, created
 * explicitly with `createRoot` in tests — see docs/architecture.md's
 * "State flow" section. */
export function createUiStore() {
  // A single `domain/drag.ts` DragState signal, with three independent
  // memos over it for `draggedIndex`/`dragOverGap`/`dragDeltaY` — reading
  // the raw DragState directly from every slide row would subscribe all
  // of them to the whole state and re-render every row on each
  // `dragOverGap` change during a drag, not just the two rows whose own
  // border actually flips.
  const [dragState, setDragState] = createSignal<DragState>({ kind: 'idle' })
  const draggedIndex = createMemo(() => {
    const s = dragState()
    return s.kind === 'dragging' ? s.index : null
  })
  const dragOverGap = createMemo(() => {
    const s = dragState()
    return s.kind === 'dragging' ? s.gap : null
  })
  const dragDeltaY = createMemo(() => {
    const s = dragState()
    return s.kind === 'dragging' ? s.deltaY : 0
  })

  // `ContextMenu`'s `closed`/`on-empty-space`/`on-slide` distinguish a
  // right-click on a specific thumbnail from one on empty space in the
  // slide list — every per-slide action (Cut/Delete/Change Layout/...)
  // disables itself outside `on-slide` (see `domain/contextMenu.ts`'s
  // `menuItems`), while actions that don't need an existing slide
  // (New Slide, Paste) still work. `layoutPickerOpen` only exists on
  // `on-slide` for the same reason a layout picker can't open with no
  // slide to change the layout of.
  const [contextMenu, setContextMenu] = createSignal<ContextMenu>({ kind: 'closed' })
  function closeContextMenu(): void {
    setContextMenu({ kind: 'closed' })
  }
  function toggleLayoutPicker(): void {
    setContextMenu(menu => (menu.kind === 'on-slide' ? { ...menu, layoutPickerOpen: !menu.layoutPickerOpen } : menu))
  }
  /** The index a slide-appending action (New Slide, Paste) should insert
   * after — the right-clicked slide, or the end of the list when the menu
   * is closed or was opened on empty space. */
  function contextMenuAppendIndex(slideCount: number): number {
    return computeAppendIndex(contextMenu(), slideCount)
  }

  // "Change Layout" expands this inline within the thumbnail context menu.
  const [layoutPreviews, setLayoutPreviews] = createSignal<{ name: string; fragment: string }[] | null>(null)
  const [layoutPreviewCss, setLayoutPreviewCss] = createSignal('')
  /** CSS for the picker grid's Shadow DOM canvases. `preview_layouts` runs
   * the deck's own theme files through `build_theme_css`, which concatenates
   * them verbatim, so this carries whatever `:root` custom properties the
   * theme declares and needs the same `:host` rewrite as `renderStore`'s
   * `slideStylesheetText` to reach a shadow tree at all. Unlike that one it
   * is never absolutized: `preview_layouts` deliberately stays off the asset
   * server (see its Rust doc comment), and the only relative `url()`s that
   * server would have resolved are the `theme-fonts/*` inside the
   * `@font-face` rules dropped here — `dom/slideCanvas.ts` already keeps one
   * hoisted, absolutized copy of those in `<head>` from the deck's own
   * render. */
  const layoutPreviewStylesheetText = createMemo<string>(() => scopeRootToHost(splitFontFaceRules(layoutPreviewCss()).rest))

  // The thumbnail context menu's Cut/Copy/Paste clipboard. Deliberately not
  // backed by `navigator.clipboard` — OS clipboard access needs its own
  // Tauri capability/plugin wiring, and the ask here is standard in-app
  // cut/copy/paste, not cross-app interop.
  const [clipboardSlideText, setClipboardSlideText] = createSignal<string | null>(null)

  const [presentMenuOpen, setPresentMenuOpen] = createSignal(false)

  const [slideListWidth, setSlideListWidth] = createSignal(SLIDE_LIST_WIDTH)
  const [editorWidth, setEditorWidth] = createSignal(EDITOR_WIDTH)

  return {
    dragState, setDragState, draggedIndex, dragOverGap, dragDeltaY,
    contextMenu, setContextMenu, closeContextMenu, toggleLayoutPicker, contextMenuAppendIndex,
    layoutPreviews, setLayoutPreviews, layoutPreviewStylesheetText, setLayoutPreviewCss,
    clipboardSlideText, setClipboardSlideText,
    presentMenuOpen, setPresentMenuOpen,
    slideListWidth, setSlideListWidth, editorWidth, setEditorWidth,
  }
}
