import { describe, expect, test } from 'bun:test'
import {
  NO_DRAFT_PREVIEW, absolutizedDraft, draftFontFaces, draftPreviewError, draftPreviewFailed, draftPreviewRendered, previewToDraw, requestDraftPreview, resetDraftPreview,
} from './layoutDraftPreview'

const A = { fragment: '<section>a</section>', css: '.a {}' }
const B = { fragment: '<section>b</section>', css: '.b {}' }

describe('absolutizedDraft', () => {
  test('spec: Given a draft naming an asset and a CSS url, Then both point at the deck\'s asset server', () => {
    const drawn = absolutizedDraft({ fragment: '<img src="assets/bbbb-logo.png">', css: '.x { background: url(assets/cccc-bg.png); }' }, 'http://127.0.0.1:5/')
    expect(drawn.fragment).toBe('<img src="http://127.0.0.1:5/assets/bbbb-logo.png">')
    expect(drawn.css).toBe('.x { background: url(http://127.0.0.1:5/assets/cccc-bg.png); }')
  })

  test('adversarial: Given absolute URLs, an empty draft or no server yet, Then nothing breaks', () => {
    const absolute = { fragment: '<img src="https://example.com/a.png">', css: '.x { background: url(data:image/png;base64,AA==); }' }
    expect(absolutizedDraft(absolute, 'http://127.0.0.1:5/')).toEqual(absolute)
    expect(absolutizedDraft({ fragment: '', css: '' }, 'http://127.0.0.1:5/')).toEqual({ fragment: '', css: '' })
    expect(() => absolutizedDraft({ fragment: '<img src="assets/a.png">', css: '' }, '')).not.toThrow()
  })
})

describe('draftFontFaces', () => {
  const DRAFT = '@font-face { font-family: "Draft"; src: url(http://h/fonts/d.woff2); }\n.x { font-family: "Draft"; }'

  test('spec: Given a drawn draft adding a face, Then that face is registered; the saved preview registers none', () => {
    expect(draftFontFaces({ css: DRAFT }, '')).toBe('@font-face { font-family: "Draft"; src: url(http://h/fonts/d.woff2); }')
    expect(draftFontFaces({ css: null }, '')).toBe('')
  })

  test('adversarial: Given a face the saved deck already has (whitespace aside), Then it isn\'t added again; other faces are', () => {
    const saved = '@font-face {\n  font-family: "Draft";\n  src: url(http://h/fonts/d.woff2);\n}'
    expect(draftFontFaces({ css: DRAFT }, saved)).toBe('')
    const two = '@font-face { font-family: "A"; src: url(a.woff2); } @FONT-FACE { font-family: "B"; src: url(b.woff2); }'
    expect(draftFontFaces({ css: two }, '@font-face { font-family: "A"; src: url(a.woff2); }')).toBe('@FONT-FACE { font-family: "B"; src: url(b.woff2); }')
  })

  test('adversarial: Given draft CSS with no faces, empty, or a broken unclosed face, Then nothing is registered', () => {
    expect(draftFontFaces({ css: '' }, '')).toBe('')
    expect(draftFontFaces({ css: '.x { color: red; }' }, '')).toBe('')
    expect(draftFontFaces({ css: '@font-face { font-family: "X"; src: url(x.woff2);' }, '')).toBe('')
  })
})

describe('the layout editor\'s live preview', () => {
  test('spec: Given a draft rendered, Then the preview draws it with its own CSS; before that, the saved preview with the deck\'s', () => {
    const { state, seq } = requestDraftPreview(NO_DRAFT_PREVIEW, 'quote')
    expect(previewToDraw(state, 'quote', 'saved')).toEqual({ fragment: 'saved', css: null })
    const rendered = draftPreviewRendered(state, seq, A)
    expect(previewToDraw(rendered, 'quote', 'saved')).toEqual(A)
    expect(draftPreviewError(rendered, 'quote')).toBe('')
  })

  test('spec: Given a later draft that fails, Then the last good one stays drawn and the error shows; a good one after clears it', () => {
    const first = requestDraftPreview(NO_DRAFT_PREVIEW, 'quote')
    const good = draftPreviewRendered(first.state, first.seq, A)
    const second = requestDraftPreview(good, 'quote')
    const failed = draftPreviewFailed(second.state, second.seq, 'a layout needs a <section> element')
    expect(previewToDraw(failed, 'quote', 'saved')).toEqual(A)
    expect(draftPreviewError(failed, 'quote')).toBe('a layout needs a <section> element')
    const third = requestDraftPreview(failed, 'quote')
    expect(draftPreviewError(draftPreviewRendered(third.state, third.seq, B), 'quote')).toBe('')
  })

  test('adversarial: Given answers arriving out of order, Then only the latest request\'s applies', () => {
    const first = requestDraftPreview(NO_DRAFT_PREVIEW, 'quote')
    const second = requestDraftPreview(first.state, 'quote')
    const latest = draftPreviewRendered(second.state, second.seq, B)
    expect(draftPreviewRendered(latest, first.seq, A)).toBe(latest)
    expect(draftPreviewFailed(latest, first.seq, 'stale')).toBe(latest)
    expect(previewToDraw(latest, 'quote', 'saved')).toEqual(B)
  })

  test('adversarial: Given a reset (another layout, revert, save), Then the saved preview shows and answers in flight are dropped', () => {
    const { state, seq } = requestDraftPreview(NO_DRAFT_PREVIEW, 'quote')
    const reset = resetDraftPreview(draftPreviewRendered(state, seq, A))
    expect(previewToDraw(reset, 'quote', 'saved')).toEqual({ fragment: 'saved', css: null })
    expect(draftPreviewRendered(reset, seq, B)).toBe(reset)
    expect(draftPreviewFailed(reset, seq, 'late')).toBe(reset)
  })

  test('adversarial: Given a draft for another layout, Then it is never drawn for this one, and a request for a new layout forgets it', () => {
    const first = requestDraftPreview(NO_DRAFT_PREVIEW, 'quote')
    const rendered = draftPreviewFailed(draftPreviewRendered(first.state, first.seq, A), first.seq, 'x')
    expect(previewToDraw(rendered, 'title-body', 'saved')).toEqual({ fragment: 'saved', css: null })
    expect(draftPreviewError(rendered, 'title-body')).toBe('')
    expect(previewToDraw(rendered, null, '')).toEqual({ fragment: '', css: null })
    const other = requestDraftPreview(rendered, 'title-body')
    expect(other.state.shown).toBeNull()
    expect(other.state.error).toBeNull()
  })

  test('adversarial: Given an empty fragment or empty CSS rendered, Then it is still the draft drawn', () => {
    const { state, seq } = requestDraftPreview(NO_DRAFT_PREVIEW, 'blank')
    expect(previewToDraw(draftPreviewRendered(state, seq, { fragment: '', css: '' }), 'blank', 'saved')).toEqual({ fragment: '', css: '' })
  })
})
