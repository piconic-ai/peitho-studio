import { describe, expect, test } from 'bun:test'
import {
  NO_DRAFT_PREVIEW, draftPreviewError, draftPreviewFailed, draftPreviewRendered, previewToDraw, requestDraftPreview, resetDraftPreview,
} from './layoutDraftPreview'

const A = { fragment: '<section>a</section>', css: '.a {}' }
const B = { fragment: '<section>b</section>', css: '.b {}' }

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
