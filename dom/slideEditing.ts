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

/** Edit the rendered element in place. Commit on leaving it, preserving
 * the slide typography and one CodeMirror Undo transaction per session. */
export function watchSlideEditing(host: HTMLElement, callbacks: SlideEditingCallbacks): void {
  const root = host.shadowRoot
  if (!root) return
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
    [data-studio-edit] { outline: 2px solid #2563eb; outline-offset: 5px; cursor: text; white-space: pre-wrap; min-width: 1em; }
    [data-studio-slot][data-studio-edit] { display: block !important; }
    [data-studio-edit][data-studio-empty]::before { content: none; }
    [data-studio-edit-error] { outline-color: #dc2626; }
    :host([data-studio-editing]) [data-studio-image] { cursor: move; outline-offset: 3px; }
    :host([data-studio-editing]) [data-studio-image]:hover,:host([data-studio-editing]) [data-studio-image]:focus { outline: 2px solid #2563eb; }
    [data-studio-handle] { position: absolute; width: calc(10px / var(--peitho-thumb-scale, 1)); height: calc(10px / var(--peitho-thumb-scale, 1)); background: white; border: calc(1px / var(--peitho-thumb-scale, 1)) solid #2563eb; transform: translate(-50%, -50%); display: none; }
    :host([data-studio-editing]) [data-studio-image]:focus [data-studio-handle], :host([data-studio-editing]) [data-studio-image]:hover [data-studio-handle] { display: block; }

  `
  root.append(style)
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
    for (const image of root.querySelectorAll<HTMLElement>('[data-studio-image]')) {
      if (image.querySelector('[data-studio-handle]')) continue
      for (const [direction, x, y] of [['nw', 0, 0], ['n', 50, 0], ['ne', 100, 0], ['w', 0, 50], ['e', 100, 50], ['sw', 0, 100], ['s', 50, 100], ['se', 100, 100]] as const) {
        const handle = document.createElement('span'); handle.dataset.studioHandle = direction
        handle.style.left = `${x}%`; handle.style.top = `${y}%`
        handle.style.cursor = `${direction}-resize`
        image.append(handle)
      }
    }
    for (const element of root.querySelectorAll<HTMLElement>('[data-studio-slot]')) {
      const accepts = element.dataset.studioAccepts ?? ''
      const empty = ['inline', 'blocks', 'list', 'image'].includes(accepts) && element.dataset.studioSlot !== 'footnotes' && element.textContent?.trim() === '' && !element.querySelector('img,svg,video,canvas')
      element.toggleAttribute('data-studio-empty', Boolean(empty) && state.callbacks.enabled())
      const freeText = element.closest<HTMLElement>('[data-studio-text]')
      if (freeText) freeText.hidden = Boolean(empty) && !freeText.querySelector('[data-studio-edit]')
      const ja = state.callbacks.language() === 'ja'
      const labels: Record<string, string> = ja ? { title: 'タイトルを入力', body: '本文を入力', left: '左の文章を入力', right: '右の文章を入力', subtitle: 'サブタイトルを入力' } : { title: 'Add a title', body: 'Add text', left: 'Add left column text', right: 'Add right column text', subtitle: 'Add a subtitle' }
      element.dataset.studioPlaceholder = accepts === 'image' ? (ja ? '画像を追加' : 'Add an image') : (labels[element.dataset.studioSlot ?? ''] ?? (ja ? 'クリックして入力' : 'Click to add text'))
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
  root.addEventListener('keydown', event => {
    if (!(event instanceof KeyboardEvent) || !state.callbacks.enabled() || box || event.target instanceof Element && event.target.closest(CONTROLS)) return
    if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'v') {
      keyboardPaste(); event.stopPropagation(); return
    }
    if (selectedText?.isConnected && root.activeElement === selectedText) {
      const target = targetForText(selectedText)
      if ((event.metaKey || event.ctrlKey) && ['c', 'x'].includes(event.key.toLowerCase()) || ['Delete', 'Backspace'].includes(event.key)) {
        event.preventDefault(); event.stopPropagation()
        if (target) state.callbacks.textAction(target, ['Delete', 'Backspace'].includes(event.key) ? 'delete' : event.key.toLowerCase() === 'x' ? 'cut' : 'copy')
        return
      }
      if (event.key === 'Enter' || event.key.length === 1 && !event.metaKey && !event.ctrlKey && !event.altKey) {
        event.preventDefault(); event.stopPropagation()
        selectedText.dispatchEvent(new MouseEvent('click', { bubbles: true, composed: true, detail: 2 }))
        if (event.key !== 'Enter' && box) {
          const range = document.createRange(); range.selectNodeContents(box)
          const selection = window.getSelection(); selection?.removeAllRanges(); selection?.addRange(range)
          document.execCommand('insertText', false, event.key)
        }
        return
      }
      event.stopPropagation(); return
    }
    if (!selectedImage?.isConnected || root.activeElement !== selectedImage) { event.stopPropagation(); return }
    if ((event.metaKey || event.ctrlKey) && ['c', 'x'].includes(event.key.toLowerCase())) {
      event.preventDefault(); event.stopPropagation()
      state.callbacks.imageClipboard(selectedImage.dataset.studioImage ?? '', event.key.toLowerCase() === 'x' ? 'cut' : 'copy')
    } else if (event.key === 'Delete' || event.key === 'Backspace') {
      event.preventDefault(); event.stopPropagation()
      state.callbacks.removeImage(selectedImage.dataset.studioImage ?? '')
    }
  })
  function targetForText(element: HTMLElement): Extract<SlideEditTarget, { kind: 'text' }> | null {
    const byteSpan = parseSourceSpan(element.getAttribute('data-peitho-src'))
    const quote = element.getAttribute('data-peitho-md')
    return byteSpan && quote !== null ? { kind: 'text', slot: element.closest<HTMLElement>('[data-studio-text]')?.dataset.studioText, byteSpan, quote, text: element.textContent ?? '', heading: Boolean(element.closest('h1,h2,h3,h4,h5,h6')) } : null
  }
  const startTextEditing = (event: Event) => {
    if (!state.callbacks.enabled() || !(event instanceof MouseEvent) || event.button !== 0) return
    const target = event.target instanceof Element ? event.target : null
    if (!target || target.closest(CONTROLS) || target.closest('[data-studio-image]')) return
    selectedImage = null; markEmpty()
    if (target.closest('.peitho-slide') && !target.closest('[data-peitho-src], [data-studio-slot]')) { host.tabIndex = 0; host.focus() }
    const slide = target.closest('.peitho-slide')
    if (!slide) return
    if (box) { if (box.contains(target)) return; if (!composing && commit?.()) close(); return }
    let element = target.closest<HTMLElement>('[data-peitho-src]') ?? target.closest('h1,h2,h3,h4,h5,h6')?.querySelector<HTMLElement>('[data-peitho-src]') ?? null
    if (!element) {
      const containedSlots = target === slide ? [] : target.querySelectorAll('[data-studio-slot]')
      const slot = target.closest('[data-studio-slot], [data-studio-text]') ?? (containedSlots.length === 1 ? containedSlots[0] : null)
      const candidates = Array.from(slot?.querySelectorAll<HTMLElement>('[data-peitho-src]') ?? []).filter(el => !el.closest('pre,code,[data-studio-image]') && el.tagName !== 'IMG')
      const distance = (el: HTMLElement) => {
        const rect = el.getBoundingClientRect()
        return Math.max(rect.left - event.clientX, 0, event.clientX - rect.right) ** 2 + Math.max(rect.top - event.clientY, 0, event.clientY - rect.bottom) ** 2
      }
      element = candidates.sort((a, b) => distance(a) - distance(b))[0] ?? null
    }
    let editTarget: SlideEditTarget | null = null
    if (element) {
      const byteSpan = parseSourceSpan(element.getAttribute('data-peitho-src'))
      const quote = element.getAttribute('data-peitho-md')
      if (byteSpan && quote !== null && !element.closest('pre,code')) editTarget = { kind: 'text', slot: element.closest<HTMLElement>('[data-studio-text]')?.dataset.studioText, byteSpan, quote, text: element.textContent ?? '', heading: Boolean(element.closest('h1,h2,h3,h4,h5,h6')) }
    } else {
      element = target.closest<HTMLElement>('[data-studio-empty]')
      if (element) {
        if (element.dataset.studioAccepts === 'image') { state.callbacks.image(element.dataset.studioSlot ?? null); return }
        editTarget = { kind: 'slot', slot: element.dataset.studioSlot ?? '', accepts: element.dataset.studioAccepts ?? '' }
      }
    }
    if (!element || !editTarget) { selectedText = null; markEmpty(); return }
    selectedText = element; element.tabIndex = 0; markEmpty()
    const session = state.callbacks.edit(editTarget)
    if (!session) return
    // WKWebView needs the native mouse-down focus action to establish its
    // text input responder; DOM focus alone leaves the first click unable to type.
    if (event.type !== 'mousedown') event.preventDefault()
    // Keep the actual slide element and its inherited typography; no floating field.
    box = element
    host.setAttribute('data-studio-text-editing', '')
    const field = element
    const original = field.innerHTML
    const empty = editTarget.kind === 'slot'
    if (empty) field.textContent = session.value
    field.dataset.studioEdit = ''
    field.contentEditable = 'true'
    field.setAttribute('role', 'textbox')
    field.setAttribute('aria-label', state.callbacks.language() === 'ja' ? 'スライドのテキスト' : 'Slide text')
    restore = () => {
      session.finish()
      field.innerHTML = original
      field.removeAttribute('contenteditable'); field.removeAttribute('role'); field.removeAttribute('aria-label')
      delete field.dataset.studioEdit; delete field.dataset.studioEditError
      field.removeEventListener('input', input)
      field.removeEventListener('keydown', keydown)
      field.removeEventListener('blur', blur)
      field.removeEventListener('compositionstart', compositionStart)
      field.removeEventListener('compositionend', compositionEnd)
      markEmpty()
    }
    const markdown = (node: Node): string => {
      if (node.nodeType === Node.TEXT_NODE) return literalSlideText(node.previousSibling instanceof Element && node.previousSibling.tagName === 'BR' ? (node.textContent ?? '').replace(/^\n/, '') : node.textContent ?? '')
      if (!(node instanceof Element)) return ''
      const text = Array.from(node.childNodes).map(markdown).join('')
      switch (node.tagName) {
        case 'BR': return '\n'
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
      const value = (!empty && field.innerHTML === original) || (empty && field.textContent === session.value) ? session.value : slideTextLines(Array.from(field.childNodes).map(markdown).join('').replace(/^\n/, ''))
      if (empty && value.trim() === '') return session.cancel()
      const ok = session.commit(value)
      field.toggleAttribute('data-studio-edit-error', !ok)
      return ok
    }
    const input = () => { if (!composing) commit?.() }
    const compositionStart = () => { composing = true }
    const compositionEnd = () => { composing = false; const ok = commit?.(); if (root.activeElement !== field && ok) close() }
    const keydown = (e: KeyboardEvent) => {
      e.stopPropagation()
      if (e.isComposing || composing) return
      if (e.key === 'Escape') { e.preventDefault(); if (session.cancel()) close() }
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
    // A real click places the caret at the clicked character; empty boxes start at the end.
    const doc = document as Document & { caretPositionFromPoint?: (x: number, y: number, options?: { shadowRoots: ShadowRoot[] }) => { offsetNode: Node; offset: number } | null; caretRangeFromPoint?: (x: number, y: number) => Range | null }
    const position = doc.caretPositionFromPoint?.(event.clientX, event.clientY, { shadowRoots: [root] })
    let range = position ? document.createRange() : doc.caretRangeFromPoint?.(event.clientX, event.clientY)
    if (position && range) { range.setStart(position.offsetNode, position.offset); range.collapse(true) }
    if (!range || !field.contains(range.startContainer)) {
      range = document.createRange(); range.selectNodeContents(field); range.collapse(false)
    }
    const selection = window.getSelection(); selection?.removeAllRanges(); selection?.addRange(range)

  }
  // Make the field editable during the first mouse gesture, before the
  // browser finishes its focus/selection handling. Click also supports
  // keyboard and accessibility activation.
  let mouseStartedEdit = false
  root.addEventListener('mousedown', event => {
    textMouseDown = event instanceof MouseEvent && event.button === 0
    const previous = box
    startTextEditing(event)
    mouseStartedEdit = Boolean(box && box !== previous)
  })
  root.addEventListener('mouseup', () => {
    textMouseDown = false
    if (mouseStartedEdit && box) {
      box.focus()
      const selection = window.getSelection()
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
