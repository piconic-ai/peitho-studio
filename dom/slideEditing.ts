import type { Language } from '../domain/language'
import { parseSourceSpan } from '../domain/reviewComment'
import { flushSlideTextEdit } from './slideCanvas'
import { literalSlideText, slideInlineCode, slideTextLines, type SlideEditTarget, type SlideEditSession } from '../domain/slideEdit'

export interface SlideEditingCallbacks {
  language: () => Language
  enabled: () => boolean
  edit: (target: SlideEditTarget) => SlideEditSession | null
  image: (slot: string | null) => void
  imageGesture: (slot: string, rect: { x: number; y: number; width: number; height: number }) => Promise<boolean>
  pasteImages: (files: File[]) => void
  pasteElement: (text: string, gesture?: object) => boolean
  pasteShortcut: (gesture: object) => void
  textAction: (target: Extract<SlideEditTarget, { kind: 'text' }>, action: 'cut' | 'copy' | 'delete') => void
  imageClipboard: (slot: string, action: 'cut' | 'copy') => void
  removeImage: (slot: string) => void
}

const watched = new WeakMap<ShadowRoot, { callbacks: SlideEditingCallbacks; close: () => void }>()
const CONTROLS = 'button,input,textarea,select,summary,a,video,audio,[contenteditable],[role="button"]'

type DOMEditTarget =
  | { kind: 'none' }
  | { kind: 'image'; slot: string | null }
  | { kind: 'edit'; element: HTMLElement; target: SlideEditTarget }

function sourceDistance(element: HTMLElement, point: Pick<MouseEvent, 'clientX' | 'clientY'>): number {
  const rect = element.getBoundingClientRect()
  return Math.max(rect.left - point.clientX, 0, point.clientX - rect.right) ** 2
    + Math.max(rect.top - point.clientY, 0, point.clientY - rect.bottom) ** 2
}

function nearestSlotSource(target: Element, slide: Element, point: Pick<MouseEvent, 'clientX' | 'clientY'>): HTMLElement | null {
  const containedSlots = target === slide ? [] : target.querySelectorAll('[data-studio-slot]')
  const slot = target.closest('[data-studio-slot], [data-studio-text]')
    ?? (containedSlots.length === 1 ? containedSlots[0] : null)
  const candidates = Array.from(slot?.querySelectorAll<HTMLElement>('[data-peitho-src]') ?? [])
    .filter(element => !element.closest('pre,code,[data-studio-image]') && element.tagName !== 'IMG')
  return candidates.sort((a, b) => sourceDistance(a, point) - sourceDistance(b, point))[0] ?? null
}

function sourceElementAtPoint(target: Element, slide: Element, point: Pick<MouseEvent, 'clientX' | 'clientY'>): HTMLElement | null {
  return target.closest<HTMLElement>('[data-peitho-src]')
    ?? target.closest('h1,h2,h3,h4,h5,h6')?.querySelector<HTMLElement>('[data-peitho-src]')
    ?? nearestSlotSource(target, slide, point)
}

function textDescriptorForElement(element: HTMLElement): Extract<SlideEditTarget, { kind: 'text' }> | null {
  const byteSpan = parseSourceSpan(element.getAttribute('data-peitho-src'))
  const quote = element.getAttribute('data-peitho-md')
  if (!byteSpan || quote === null || element.closest('pre,code')) return null
  return {
    kind: 'text',
    slot: element.closest<HTMLElement>('[data-studio-text]')?.dataset.studioText
      ?? element.closest<HTMLElement>('[data-studio-slot]')?.dataset.studioSlot,
    byteSpan,
    quote,
    text: element.textContent ?? '',
    heading: Boolean(element.closest('h1,h2,h3,h4,h5,h6')),
  }
}

function resolveDOMEditTarget(target: Element, slide: Element, point: Pick<MouseEvent, 'clientX' | 'clientY'>): DOMEditTarget {
  const source = sourceElementAtPoint(target, slide, point)
  if (source) {
    const descriptor = textDescriptorForElement(source)
    return descriptor ? { kind: 'edit', element: source, target: descriptor } : { kind: 'none' }
  }
  const empty = target.closest<HTMLElement>('[data-studio-empty]')
  if (!empty) return { kind: 'none' }
  if (empty.dataset.studioAccepts === 'image') return { kind: 'image', slot: empty.dataset.studioSlot ?? null }
  return {
    kind: 'edit',
    element: empty,
    target: { kind: 'slot', slot: empty.dataset.studioSlot ?? '', accepts: empty.dataset.studioAccepts ?? '' },
  }
}

function listEditContext(element: HTMLElement, target: SlideEditTarget): { element: HTMLElement; target: SlideEditTarget; selectedElement: HTMLElement; list: HTMLElement | null } {
  const selectedElement = element
  let list = element.closest<HTMLElement>('ul,ol')
  while (list?.parentElement?.closest<HTMLElement>('ul,ol')) list = list.parentElement.closest<HTMLElement>('ul,ol')
  if (list && target.kind === 'text') {
    const listItems = Array.from(list.querySelectorAll<HTMLElement>('[data-peitho-src]')).flatMap(item => {
      const byteSpan = parseSourceSpan(item.getAttribute('data-peitho-src'))
      const quote = item.getAttribute('data-peitho-md')
      return byteSpan && quote !== null ? [{ byteSpan, quote }] : []
    })
    if (listItems.length) { target = { ...target, listItems }; element = list }
  }
  return { element, target, selectedElement, list }
}

function placeEditingCaret(field: HTMLElement, point: Pick<MouseEvent, 'clientX' | 'clientY'>, root: ShadowRoot, getSelection: () => Selection | null): void {
  const doc = document as Document & { caretPositionFromPoint?: (x: number, y: number, options?: { shadowRoots: ShadowRoot[] }) => { offsetNode: Node; offset: number } | null; caretRangeFromPoint?: (x: number, y: number) => Range | null }
  const position = doc.caretPositionFromPoint?.(point.clientX, point.clientY, { shadowRoots: [root] })
  let range = position ? document.createRange() : doc.caretRangeFromPoint?.(point.clientX, point.clientY)
  if (position && range) { range.setStart(position.offsetNode, position.offset); range.collapse(true) }
  if (!range || !field.contains(range.startContainer)) {
    range = document.createRange(); range.selectNodeContents(field); range.collapse(false)
  }
  const selection = getSelection(); selection?.removeAllRanges(); selection?.addRange(range)
}

/** Edit the rendered element in place. Commit on leaving it, preserving
 * the slide typography and one CodeMirror Undo transaction per session. */
export function watchSlideEditing(host: HTMLElement, callbacks: SlideEditingCallbacks): void {
  const root = host.shadowRoot
  if (!root) return
  const getSelection = () => (root as ShadowRoot & { getSelection?: () => Selection | null }).getSelection?.() ?? window.getSelection()
  const selectionRange = (selection: Selection): Range | null => {
    const raw = selection.rangeCount ? selection.getRangeAt(0) : null
    if (raw && root.contains(raw.startContainer)) return raw
    // Safari's original API takes a ShadowRoot; the current standard takes
    // an options object. A plain getRangeAt may rescope to the shadow host.
    const composed = selection as unknown as { getComposedRanges?: (options: { shadowRoots: ShadowRoot[] } | ShadowRoot) => StaticRange[] }
    for (const options of [{ shadowRoots: [root] }, root]) {
      try {
        const span = composed.getComposedRanges?.(options)[0]
        if (span && root.contains(span.startContainer) && root.contains(span.endContainer)) {
          const range = document.createRange()
          range.setStart(span.startContainer, span.startOffset); range.setEnd(span.endContainer, span.endOffset)
          return range
        }
      } catch { /* Try the other API signature. */ }
    }
    return raw
  }
  const existing = watched.get(root)
  if (existing) { existing.callbacks = callbacks; existing.close(); return }
  let box: HTMLElement | null = null
  let restore: (() => void) | null = null
  let commit: (() => boolean) | null = null
  let composing = false
  let selectedImage: HTMLElement | null = null
  let selectedText: HTMLElement | null = null
  let textMouseDown = false
  const close = () => { const cleanup = restore; restore = null; box = null; commit = null; cleanup?.(); host.removeAttribute('data-studio-text-editing'); flushSlideTextEdit(host) }
  // WKWebView may emit only the shortcut; other engines also emit paste.
  // Share a gesture so the two paths cannot create duplicate objects.
  let pasteGesture: object | undefined
  const keyboardPaste = () => {
    const gesture = {}; pasteGesture = gesture
    state.callbacks.pasteShortcut(gesture)
    setTimeout(() => { if (pasteGesture === gesture) pasteGesture = undefined }, 1000)
  }
  const state = { callbacks, close }
  watched.set(root, state)
  const style = document.createElement('style')
  style.textContent = `
    [data-studio-slot] { display: contents; }
    [data-studio-empty] { display: block !important; min-height: 90px; min-width: 100px; padding: 20px; box-sizing: border-box; border: 2px dashed #a3a3a3; border-radius: 8px; cursor: text; }
    [data-studio-empty]::before { content: attr(data-studio-placeholder); font: 24px system-ui; color: #777; }
    [data-studio-slot][data-studio-accepts="image"][data-studio-empty] { cursor: pointer; }
    [data-studio-selected] { outline: 2px solid #2563eb; outline-offset: 5px; }
    [data-studio-edit] { outline: 2px solid #2563eb; outline-offset: 5px; cursor: text; min-width: 1em; }
    [data-studio-slot][data-studio-edit] { display: block !important; }
    [data-studio-edit][data-studio-empty]::before { content: none; }
    [data-studio-slot="footnotes"][data-studio-empty] { min-height: 0; padding: 8px 16px; }
    [data-studio-slot="footnotes"][data-studio-empty]::before { font-size: 18px; }
    [data-studio-reveal] { display: block !important; }
    [data-studio-edit-error] { outline-color: #dc2626; }
    :host([data-studio-editing]) [data-studio-image] { cursor: move; outline-offset: 3px; }
    :host([data-studio-editing]) [data-studio-image]:hover,:host([data-studio-editing]) [data-studio-image]:focus { outline: 2px solid #2563eb; }
    [data-studio-handle] { position: absolute; width: calc(10px / var(--peitho-thumb-scale, 1)); height: calc(10px / var(--peitho-thumb-scale, 1)); background: white; border: calc(1px / var(--peitho-thumb-scale, 1)) solid #2563eb; transform: translate(-50%, -50%); display: none; }
    :host([data-studio-editing]) [data-studio-image]:focus [data-studio-handle], :host([data-studio-editing]) [data-studio-image]:hover [data-studio-handle] { display: block; }

  `
  root.append(style)
  const ensureImageHandles = (image: HTMLElement) => {
    if (image.querySelector('[data-studio-handle]')) return
    for (const [direction, x, y] of [['nw', 0, 0], ['n', 50, 0], ['ne', 100, 0], ['w', 0, 50], ['e', 100, 50], ['sw', 0, 100], ['s', 50, 100], ['se', 100, 100]] as const) {
      const handle = document.createElement('span'); handle.dataset.studioHandle = direction
      handle.style.left = `${x}%`; handle.style.top = `${y}%`
      handle.style.cursor = `${direction}-resize`
      image.append(handle)
    }
  }
  const updateSlotPlaceholder = (element: HTMLElement, accepts: string) => {
    const ja = state.callbacks.language() === 'ja'
    const labels: Record<string, string> = ja ? { title: 'タイトルを入力', body: '本文を入力', left: '左の文章を入力', right: '右の文章を入力', subtitle: 'サブタイトルを入力', footnotes: '脚注を追加' } : { title: 'Add a title', body: 'Add text', left: 'Add left column text', right: 'Add right column text', subtitle: 'Add a subtitle', footnotes: 'Add a footnote' }
    element.dataset.studioPlaceholder = accepts === 'image' ? (ja ? '画像を追加' : 'Add an image') : (labels[element.dataset.studioSlot ?? ''] ?? (ja ? 'クリックして入力' : 'Click to add text'))
  }
  const isEmptySlot = (element: HTMLElement, accepts: string): boolean =>
    ['inline', 'blocks', 'list', 'image'].includes(accepts) && element.textContent?.trim() === '' && !element.querySelector('img,svg,video,canvas')
  const refreshSlotMarkers = (element: HTMLElement) => {
    const accepts = element.dataset.studioAccepts ?? ''
    const empty = isEmptySlot(element, accepts)
    element.toggleAttribute('data-studio-empty', Boolean(empty) && state.callbacks.enabled())
    const freeText = element.closest<HTMLElement>('[data-studio-text]')
    if (freeText) freeText.hidden = Boolean(empty) && !freeText.querySelector('[data-studio-edit]')
    if (state.callbacks.enabled() && !freeText?.hidden && (empty || element.matches('[data-studio-edit], :has([data-studio-edit])'))) revealHiddenAncestors(element)
    updateSlotPlaceholder(element, accepts)
  }
  const markEmpty = () => {
    host.toggleAttribute('data-studio-editing', state.callbacks.enabled())
    if (!style.isConnected) root.append(style)
    if (selectedImage && !selectedImage.isConnected) {
      const sameSlide = selectedImage.closest('.peitho-slide')?.getAttribute('data-slide-key') === root.querySelector('.peitho-slide')?.getAttribute('data-slide-key')
      selectedImage = sameSlide ? Array.from(root.querySelectorAll<HTMLElement>('[data-studio-image]')).find(image => image.dataset.studioImage === selectedImage?.dataset.studioImage) ?? null : null
    }
    if (selectedText && !selectedText.isConnected) selectedText = null
    for (const element of root.querySelectorAll<HTMLElement>('[data-peitho-src], [data-studio-empty]')) element.toggleAttribute('data-studio-selected', element === selectedText)
    const images = Array.from(root.querySelectorAll<HTMLElement>('[data-studio-image]'))
    for (const image of images) image.toggleAttribute('data-studio-selected', image === selectedImage)
    for (const image of root.querySelectorAll<HTMLElement>('[data-studio-image]')) ensureImageHandles(image)
    for (const element of root.querySelectorAll<HTMLElement>('[data-studio-reveal]')) element.removeAttribute('data-studio-reveal')
    for (const element of root.querySelectorAll<HTMLElement>('[data-studio-slot]')) refreshSlotMarkers(element)
  }
  // A layout may hide a slot's wrapper while the slot is empty (base.css
  // hides `.footnotes` via `data-empty-slots`), which would hide its
  // placeholder too; while editing, show that wrapper.
  const revealHiddenAncestors = (element: HTMLElement) => {
    for (let node = element.parentElement; node && !node.classList.contains('peitho-slide'); node = node.parentElement) {
      if (getComputedStyle(node).display === 'none') node.setAttribute('data-studio-reveal', '')
    }
  }
  new MutationObserver(markEmpty).observe(root, { childList: true, subtree: true })
  host.addEventListener('studio-edit-mode', markEmpty)
  markEmpty()

  root.addEventListener('contextmenu', event => {
    if (!state.callbacks.enabled() || !(event.target instanceof Element)) return
    const image = event.target.closest<HTMLElement>('[data-studio-image]')
    if (image) { selectedText = null; selectedImage = image; image.tabIndex = 0; image.focus(); markEmpty() }
  }, true)
  root.addEventListener('mousedown', event => {
    if (!(event instanceof MouseEvent) || event.button !== 0 || !state.callbacks.enabled()) return
    const target = event.target instanceof Element ? event.target : null
    const image = target?.closest<HTMLElement>('[data-studio-image]')
    const slide = image?.closest<HTMLElement>('.peitho-slide')
    if (!image || !slide) return
    event.preventDefault()
    selectedText = null; selectedImage = image; image.tabIndex = 0; image.focus(); markEmpty()
    const bounds = slide.getBoundingClientRect()
    const rect = image.getBoundingClientRect()
    const initial = { x: (rect.left - bounds.left) / bounds.width, y: (rect.top - bounds.top) / bounds.height, width: rect.width / bounds.width, height: rect.height / bounds.height }
    const resize = target?.closest<HTMLElement>('[data-studio-handle]')?.dataset.studioHandle ?? (event.clientX >= rect.right - 12 && event.clientY >= rect.bottom - 12 ? 'se' : '')
    const start = { x: event.clientX, y: event.clientY }
    let next = initial
    const move = (e: MouseEvent) => {
      const dx = (e.clientX - start.x) / bounds.width
      const dy = (e.clientY - start.y) / bounds.height
      if (resize) {
        const left = resize.includes('w') ? Math.max(0, Math.min(initial.x + initial.width - .05, initial.x + dx)) : initial.x
        const top = resize.includes('n') ? Math.max(0, Math.min(initial.y + initial.height - .05, initial.y + dy)) : initial.y
        const right = resize.includes('e') ? Math.max(left + .05, Math.min(1, initial.x + initial.width + dx)) : initial.x + initial.width
        const bottom = resize.includes('s') ? Math.max(top + .05, Math.min(1, initial.y + initial.height + dy)) : initial.y + initial.height
        next = { x: left, y: top, width: right - left, height: bottom - top }
      } else next = { ...initial, x: Math.max(0, Math.min(1 - initial.width, initial.x + dx)), y: Math.max(0, Math.min(1 - initial.height, initial.y + dy)) }

      image.style.left = `${next.x * 100}%`; image.style.top = `${next.y * 100}%`
      image.style.width = `${next.width * 100}%`; image.style.height = `${next.height * 100}%`
    }
    const up = () => {
      document.removeEventListener('mousemove', move); document.removeEventListener('mouseup', up)
      if (next !== initial) void state.callbacks.imageGesture(image.dataset.studioImage ?? '', next).then(saved => {
        if (saved || !image.isConnected) return
        image.style.left = `${initial.x * 100}%`; image.style.top = `${initial.y * 100}%`
        image.style.width = `${initial.width * 100}%`; image.style.height = `${initial.height * 100}%`
      })
    }
    document.addEventListener('mousemove', move); document.addEventListener('mouseup', up)
  })
  function handleTextObjectCommand(event: KeyboardEvent, target: Extract<SlideEditTarget, { kind: 'text' }> | null): boolean {
    if ((event.metaKey || event.ctrlKey) && ['c', 'x'].includes(event.key.toLowerCase()) || ['Delete', 'Backspace'].includes(event.key)) {
      event.preventDefault(); event.stopPropagation()
      if (target) state.callbacks.textAction(target, ['Delete', 'Backspace'].includes(event.key) ? 'delete' : event.key.toLowerCase() === 'x' ? 'cut' : 'copy')
      return true
    }
    return false
  }
  function startTextObjectEditing(element: HTMLElement, event: KeyboardEvent): void {
    event.preventDefault(); event.stopPropagation()
    element.dispatchEvent(new MouseEvent('click', { bubbles: true, composed: true, detail: 2 }))
    if (event.key === 'Enter' || !box) return
    const range = document.createRange(); range.selectNodeContents(box)
    const selection = getSelection(); selection?.removeAllRanges(); selection?.addRange(range)
    document.execCommand('insertText', false, event.key)
  }
  function handleTextObjectKey(element: HTMLElement, event: KeyboardEvent): void {
    const target = targetForText(element)
    if (handleTextObjectCommand(event, target)) return
    if (event.key === 'Enter' || event.key.length === 1 && !event.metaKey && !event.ctrlKey && !event.altKey) {
      startTextObjectEditing(element, event)
      return
    }
    event.stopPropagation()
  }
  function handleImageObjectKey(element: HTMLElement, event: KeyboardEvent): void {
    if ((event.metaKey || event.ctrlKey) && ['c', 'x'].includes(event.key.toLowerCase())) {
      event.preventDefault(); event.stopPropagation()
      state.callbacks.imageClipboard(element.dataset.studioImage ?? '', event.key.toLowerCase() === 'x' ? 'cut' : 'copy')
    } else if (event.key === 'Delete' || event.key === 'Backspace') {
      event.preventDefault(); event.stopPropagation()
      state.callbacks.removeImage(element.dataset.studioImage ?? '')
    }
  }
  root.addEventListener('keydown', event => {
    if (!(event instanceof KeyboardEvent) || !state.callbacks.enabled() || box || event.target instanceof Element && event.target.closest(CONTROLS)) return
    if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'v') {
      keyboardPaste(); event.stopPropagation(); return
    }
    if (selectedText?.isConnected && root.activeElement === selectedText) {
      handleTextObjectKey(selectedText, event)
      return
    }
    if (!selectedImage?.isConnected || root.activeElement !== selectedImage) { event.stopPropagation(); return }
    handleImageObjectKey(selectedImage, event)
  })
  function targetForText(element: HTMLElement): Extract<SlideEditTarget, { kind: 'text' }> | null {
    const byteSpan = parseSourceSpan(element.getAttribute('data-peitho-src'))
    const quote = element.getAttribute('data-peitho-md')
    return byteSpan && quote !== null ? { kind: 'text', slot: element.closest<HTMLElement>('[data-studio-text]')?.dataset.studioText, byteSpan, quote, text: element.textContent ?? '', heading: Boolean(element.closest('h1,h2,h3,h4,h5,h6')) } : null
  }
  const handleActiveFieldClick = (target: Element): void => {
    if (!box || box.contains(target)) return
    if (!composing && commit?.()) close()
  }
  const configureEditingField = (field: HTMLElement, empty: boolean, session: SlideEditSession): void => {
    if (empty) field.textContent = session.value
    field.dataset.studioEdit = ''
    field.contentEditable = 'true'
    field.setAttribute('role', 'textbox')
    field.setAttribute('aria-label', state.callbacks.language() === 'ja' ? 'スライドのテキスト' : 'Slide text')
  }
  const startTextEditing = (event: Event) => {
    if (!state.callbacks.enabled() || !(event instanceof MouseEvent) || event.button !== 0) return
    const target = event.target instanceof Element ? event.target : null
    if (!target || target.closest(CONTROLS) || target.closest('[data-studio-image]')) return
    selectedImage = null; markEmpty()
    if (target.closest('.peitho-slide') && !target.closest('[data-peitho-src], [data-studio-slot]')) { host.tabIndex = 0; host.focus() }
    const slide = target.closest('.peitho-slide')
    if (!slide) return
    if (box) { handleActiveFieldClick(target); return }
    const destination = resolveDOMEditTarget(target, slide, event)
    if (destination.kind === 'image') {
      state.callbacks.image(destination.slot)
      return
    }
    if (destination.kind === 'none') {
      selectedText = null
      markEmpty()
      return
    }
    const context = listEditContext(destination.element, destination.target)
    let { element, target: editTarget } = context
    const { selectedElement, list } = context
    selectedText = element; element.tabIndex = 0; markEmpty()
    const session = state.callbacks.edit(editTarget)
    if (!session) return
    // WKWebView needs the native mouse-down focus action to establish its
    // text input responder; DOM focus alone leaves the first click unable to type.
    if (event.type !== 'mousedown') event.preventDefault()
    // Use a block editing host around lists. WKWebView exposes an editable
    // UL through accessibility but does not reliably accept native typing.
    // Keep the original list and its typography inside the temporary host.
    let listHost: HTMLElement | null = null
    if (list) {
      listHost = document.createElement('div')
      // Match the list's whitespace behavior on its temporary editing host,
      // including layouts that style UL/OL differently from their parent.
      listHost.style.whiteSpace = getComputedStyle(list).whiteSpace
      element.before(listHost); listHost.append(element)
      element = listHost; element.tabIndex = 0; selectedText = element; markEmpty()
    }
    // Keep the actual slide element and its inherited typography; no floating field.
    box = element
    host.setAttribute('data-studio-text-editing', '')
    const field = element
    const original = field.innerHTML
    const empty = editTarget.kind === 'slot'
    configureEditingField(field, empty, session)
    restore = () => {
      session.finish()
      field.innerHTML = original
      if (list) {
        selectedText = Array.from(field.querySelectorAll<HTMLElement>('[data-peitho-src]')).find(el => el.getAttribute('data-peitho-src') === selectedElement.getAttribute('data-peitho-src')) ?? null
        if (selectedText) selectedText.tabIndex = 0
      }
      field.removeAttribute('contenteditable'); field.removeAttribute('role'); field.removeAttribute('aria-label')
      delete field.dataset.studioEdit; delete field.dataset.studioEditError
      field.removeEventListener('input', input)
      field.removeEventListener('keydown', keydown)
      field.removeEventListener('blur', blur)
      field.removeEventListener('compositionstart', compositionStart)
      field.removeEventListener('compositionend', compositionEnd)
      if (listHost) listHost.replaceWith(...Array.from(listHost.childNodes))
      markEmpty()
    }
    const markdownText = (node: Node): string => {
      if (node.parentElement?.matches('ul,ol') && !node.textContent?.trim()) return ''
      return literalSlideText(node.previousSibling instanceof Element && node.previousSibling.tagName === 'BR' ? (node.textContent ?? '').replace(/^\n/, '') : node.textContent ?? '')
    }
    const isListFormattingWhitespace = (node: Node): boolean => node.nodeType === Node.TEXT_NODE && node.textContent?.trim() === '' && node.textContent.includes('\n')
    const listItemContent = (node: Element): string => {
      const blocks: string[] = []
      let inline = ''
      const flush = () => { if (inline !== '') { blocks.push(inline); inline = '' } }
      for (const child of node.childNodes) {
        if (child instanceof Element && ['P', 'DIV', 'UL', 'OL'].includes(child.tagName)) {
          flush()
          blocks.push(child.matches('p,div') ? Array.from(child.childNodes).map(markdown).join('') : markdown(child).replace(/^\n+|\n+$/g, ''))
        } else if (!isListFormattingWhitespace(child)) inline += markdown(child)
      }
      flush()
      return blocks.join('\n\n')
    }
    const listItemMarkdown = (node: Element): string => {
      const content = listItemContent(node)
      if (node.hasAttribute('data-studio-unlisted')) return `\n\n${content.trim() === '' ? '&#160;' : content}\n\n`
      const marker = node.parentElement?.tagName === 'OL' ? `${Number(node.parentElement.getAttribute('start') ?? 1) + Array.from(node.parentElement.children).indexOf(node)}. ` : '- '
      const indentation = ' '.repeat(marker.length)
      return `\n${marker}${content.trim() === '' ? '&#160;' : content.replace(/\n/g, `\n${indentation}`)}`
    }
    const listAwareLineBreak = (node: Element): string => list ? !node.nextSibling ? '' : '  \n' : '\n'
    const markdown = (node: Node): string => {
      if (node.nodeType === Node.TEXT_NODE) return markdownText(node)
      if (!(node instanceof Element)) return ''
      const text = Array.from(node.childNodes).map(markdown).join('')
      switch (node.tagName) {
        case 'LI': return listItemMarkdown(node)
        case 'UL': case 'OL': return text
        case 'BR': return listAwareLineBreak(node)
        case 'INPUT': return node.getAttribute('type') === 'checkbox' ? `[${(node as HTMLInputElement).checked ? 'x' : ' '}] ` : ''
        case 'CODE': return slideInlineCode(node.textContent ?? '')
        case 'STRONG': case 'B': return `**${text}**`
        case 'EM': case 'I': return `*${text}*`
        case 'S': case 'DEL': return `~~${text}~~`
        case 'A': return `[${text}](${node.getAttribute('href') ?? ''})`
        // An empty browser-created line contains a placeholder BR, which
        // does not add a second line break of its own.
        case 'DIV': case 'P': return `\n${node.childNodes.length === 1 && node.firstChild instanceof Element && node.firstChild.tagName === 'BR' ? '' : text}`
        default: return text
      }
    }
    commit = () => {
      const value = (!empty && field.innerHTML === original) || (empty && field.textContent === session.value) ? session.value : list ? Array.from(field.childNodes).map(markdown).join('').replace(/\n{3,}/g, '\n\n').replace(/^\n+|\n+$/g, '') : slideTextLines(Array.from(field.childNodes).map(markdown).join('').replace(/^\n/, ''))
      if (empty && value.trim() === '') return session.cancel()
      const ok = session.commit(value)
      field.toggleAttribute('data-studio-edit-error', !ok)
      return ok
    }
    const input = () => { if (!composing) commit?.() }
    const compositionStart = () => { composing = true }
    const compositionEnd = () => { composing = false; const ok = commit?.(); if (root.activeElement !== field && ok) close() }
    const closestItem = (node: Node): HTMLElement | null => {
      const element = node instanceof Element ? node : node.parentElement
      return element?.closest<HTMLElement>('li') ?? null
    }
    const normalizeListCaret = (caret: Range, list: HTMLElement): HTMLElement | null => {
      // WebKit can put the caret on the list container after its formatting newline.
      const child = caret.startContainer === field ? field.childNodes[Math.max(0, caret.startOffset - 1)] : caret.startContainer
      const adjacent = child instanceof Element ? child : child?.previousSibling
      const adjacentItem = adjacent instanceof Element ? adjacent.closest<HTMLElement>('li') : null
      const item = adjacentItem ?? Array.from(list.children).filter((el): el is HTMLElement => el instanceof HTMLElement && el.tagName === 'LI').at(-1) ?? null
      if (!item) return null
      const atBeginning = caret.startContainer === field && caret.startOffset === 0
      caret.selectNodeContents(item); caret.collapse(atBeginning)
      return item
    }
    const isListKey = (e: KeyboardEvent) => (e.key === 'Enter' || e.key === 'Backspace') && !e.metaKey && !e.ctrlKey && !e.altKey && !e.shiftKey
    const handleListKey = (e: KeyboardEvent, list: HTMLElement): boolean => {
      if (!isListKey(e)) return false
      const selection = getSelection()
      if (!selection?.rangeCount) return false
      const caret = selectionRange(selection)
      if (!caret) return true
      let item = closestItem(caret.startContainer)
      let normalizedCaret = false
      if (!item && selection.isCollapsed && field.contains(caret.startContainer)) {
        item = normalizeListCaret(caret, list)
        normalizedCaret = item !== null
      }
      if (!item || !field.contains(item)) return false
      const handleItemKey = (item: HTMLElement): boolean => {
        const before = caret.cloneRange(); before.selectNodeContents(item); before.setEnd(caret.startContainer, caret.startOffset)
        const atStart = selection.isCollapsed && before.toString() === ''
        if (item.hasAttribute('data-studio-unlisted')) return false
        const unlist = e.key === 'Backspace' ? atStart : item.textContent?.trim() === ''
        if (unlist) {
          e.preventDefault()
          item.setAttribute('data-studio-unlisted', '')
          item.style.listStyleType = 'none'
          commit?.()
          return true
        }
        if (e.key !== 'Enter') return false
        // Keep the native Enter action: cancelling it or splitting DOM
        // nodes ourselves prevents WKWebView from accepting further input.
        if (normalizedCaret) { selection.removeAllRanges(); selection.addRange(caret) }
        return true
      }
      return handleItemKey(item)
    }
    const keydown = (e: KeyboardEvent) => {
      e.stopPropagation()
      if (e.isComposing || composing) return
      if (list && handleListKey(e, list)) return
      if (e.key === 'Escape') { e.preventDefault(); if (session.cancel()) { close(); selectedText?.focus() } }
      if (e.key === 'Enter' && (editTarget?.kind === 'text' && editTarget.heading || e.metaKey || e.ctrlKey)) {
        e.preventDefault(); if (commit?.()) close()
      }
    }
    const blur = () => { if (!composing && !textMouseDown) { commit?.(); close() } }
    field.addEventListener('input', input)
    field.addEventListener('compositionstart', compositionStart)
    field.addEventListener('compositionend', compositionEnd)
    field.addEventListener('keydown', keydown)
    field.addEventListener('blur', blur)
    field.focus()
    placeEditingCaret(field, event, root, getSelection)

  }
  // Make the field editable during the first mouse gesture, before the
  // browser finishes its focus/selection handling. Click also supports
  // keyboard and accessibility activation.
  let mouseStartedEdit = false
  root.addEventListener('mousedown', event => {
    const target = event.target instanceof Element ? event.target : null
    textMouseDown = event instanceof MouseEvent && event.button === 0 && Boolean(target) && !target?.closest(`${CONTROLS},[data-studio-image]`)
    const previous = box
    startTextEditing(event)
    mouseStartedEdit = Boolean(box && box !== previous)
  })
  root.addEventListener('mouseup', () => {
    textMouseDown = false
    if (mouseStartedEdit && box && root.activeElement !== box) {
      box.focus()
      const selection = getSelection()
      if (!selection?.rangeCount || !box.contains(selection.getRangeAt(0).startContainer)) {
        const range = document.createRange(); range.selectNodeContents(box); range.collapse(false)
        selection?.removeAllRanges(); selection?.addRange(range)
      }
    }
  })
  document.addEventListener('mouseup', () => { textMouseDown = false })
  root.addEventListener('click', event => {
    if (mouseStartedEdit) { mouseStartedEdit = false; return }
    startTextEditing(event)
  })
  host.addEventListener('keydown', event => {
    if (event.target !== host || host.shadowRoot?.activeElement || box || !state.callbacks.enabled()) return
    if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'v') {
      keyboardPaste(); event.stopPropagation()
    } else if (event.target === host) { event.stopPropagation() }
  })
  const paste = (event: Event) => {
    if (!state.callbacks.enabled() || !(event instanceof ClipboardEvent) || !box && event.target instanceof Element && event.target.closest(CONTROLS)) return
    const gesture = pasteGesture
    pasteGesture = undefined
    const files = Array.from(event.clipboardData?.files ?? []).filter(file => file.type.startsWith('image/'))
    if (files.length === 0) {
      if (box && event.clipboardData) {
        event.preventDefault()
        document.execCommand('insertText', false, event.clipboardData.getData('text/plain'))
      } else if (state.callbacks.pasteElement(event.clipboardData?.getData('text/plain') ?? '', gesture)) {
        event.preventDefault(); event.stopPropagation()
      }
      return
    }
    event.preventDefault(); event.stopPropagation()
    if (box) { if (composing || !commit?.()) return; close() }
    state.callbacks.pasteImages(files)
  }
  root.addEventListener('paste', paste)
  host.addEventListener('paste', event => { if (event.target === host && !event.defaultPrevented) paste(event) })
}
