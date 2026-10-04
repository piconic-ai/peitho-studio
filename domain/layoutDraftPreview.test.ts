import { describe, expect, test } from 'bun:test'
import {
  DRAFT_FAMILY_SUFFIX, NO_DRAFT_PREVIEW, absolutizedDraft, aliasFontFamilies, draftPreviewError, fontFaceFamily, previewDraftCss, draftPreviewFailed, draftPreviewRendered, draftedLayout, previewToDraw, requestDraftPreview, resetDraftPreview,
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

describe('previewDraftCss: which faces register', () => {
  const DRAFT = '@font-face { font-family: "Draft"; src: url(http://h/fonts/d.woff2); }\n.x { font-family: "Draft"; }'

  test('spec: Given a drawn draft adding a face, Then that face is registered; the saved preview registers none', () => {
    expect(previewDraftCss({ css: DRAFT }, '').fontFaces).toBe('@font-face { font-family: "Draft"; src: url(http://h/fonts/d.woff2); }')
    expect(previewDraftCss({ css: null }, '').fontFaces).toBe('')
  })

  test('adversarial: Given a face the saved deck already has (whitespace aside), Then it isn\'t added again; other faces are', () => {
    const saved = '@font-face {\n  font-family: "Draft";\n  src: url(http://h/fonts/d.woff2);\n}'
    expect(previewDraftCss({ css: DRAFT }, saved).fontFaces).toBe('')
    const two = '@font-face { font-family: "A"; src: url(a.woff2); } @FONT-FACE { font-family: "B"; src: url(b.woff2); }'
    expect(previewDraftCss({ css: two }, '@font-face { font-family: "A"; src: url(a.woff2); }').fontFaces).toBe('@FONT-FACE { font-family: "B"; src: url(b.woff2); }')
  })

  test('adversarial: Given draft CSS with no faces, empty, or a broken unclosed face, Then nothing is registered', () => {
    expect(previewDraftCss({ css: '' }, '').fontFaces).toBe('')
    expect(previewDraftCss({ css: '.x { color: red; }' }, '').fontFaces).toBe('')
    expect(previewDraftCss({ css: '@font-face { font-family: "X"; src: url(x.woff2);' }, '').fontFaces).toBe('')
  })
})

describe('previewDraftCss', () => {
  const SAVED = '@font-face { font-family: "DeckFace"; src: url(http://h/fonts/deck.woff2); }'

  test('spec: Given a draft redefining a family the deck defines, Then the draft registers it under a preview-only name and uses that name', () => {
    const css = '@font-face { font-family: "DeckFace"; src: url(http://h/fonts/other.woff2); }\n.x h1 { font-family: "DeckFace", serif; }'
    const { fontFaces, rest } = previewDraftCss({ css }, SAVED)
    expect(fontFaces).toBe(`@font-face { font-family: "DeckFace${DRAFT_FAMILY_SUFFIX}"; src: url(http://h/fonts/other.woff2); }`)
    expect(rest).toContain(`font-family: "DeckFace${DRAFT_FAMILY_SUFFIX}", serif;`)
  })

  test('spec: Given a draft keeping the deck\'s face and adding a new family, Then only the new face registers and nothing is renamed', () => {
    const css = `${SAVED}\n@font-face { font-family: "New"; src: url(n.woff2); }\n.x { font-family: "DeckFace"; }`
    const { fontFaces, rest } = previewDraftCss({ css }, SAVED)
    expect(fontFaces).toBe('@font-face { font-family: "New"; src: url(n.woff2); }')
    expect(rest).toContain('font-family: "DeckFace";')
  })

  test('adversarial: Given a redefined family with several weights, Then all of its draft faces move to the preview-only name together', () => {
    const saved = `${SAVED}\n@font-face { font-family: "DeckFace"; font-weight: 700; src: url(http://h/fonts/deck-bold.woff2); }`
    const css = `@font-face { font-family: "DeckFace"; src: url(changed.woff2); }\n@font-face { font-family: "DeckFace"; font-weight: 700; src: url(http://h/fonts/deck-bold.woff2); }`
    const faces = previewDraftCss({ css }, saved).fontFaces.split('\n')
    expect(faces).toHaveLength(2)
    expect(faces.every(face => face.includes(DRAFT_FAMILY_SUFFIX))).toBe(true)
  })

  test('adversarial: Given the saved preview, no faces, or an unquoted family in another case, Then it is handled', () => {
    expect(previewDraftCss({ css: null }, SAVED)).toEqual({ fontFaces: '', rest: null })
    expect(previewDraftCss({ css: '' }, SAVED)).toEqual({ fontFaces: '', rest: '' })
    const css = '@font-face { font-family: deckface; src: url(x.woff2); } .x { font: italic 2rem deckface; }'
    const { fontFaces, rest } = previewDraftCss({ css }, SAVED)
    expect(fontFaces).toContain(`"deckface${DRAFT_FAMILY_SUFFIX}"`)
    expect(rest).toContain(`font: italic 2rem "deckface${DRAFT_FAMILY_SUFFIX}"`)
  })
})

describe('fontFaceFamily / aliasFontFamilies', () => {
  test('spec: Given faces quoted, single-quoted or bare, Then the family is read lower-cased; none without one', () => {
    expect(fontFaceFamily('@font-face { font-family: "Deck Face"; }')).toBe('deck face')
    expect(fontFaceFamily("@font-face { font-family: 'X' }")).toBe('x')
    expect(fontFaceFamily('@font-face { font-family: Y; }')).toBe('y')
    expect(fontFaceFamily('@font-face { src: url(a.woff2); }')).toBeNull()
    expect(fontFaceFamily('@font-face { font-family: Deck   Face; }')).toBe('deck face')
    expect(fontFaceFamily('@font-face { font-family: "Deck Face" !important; }')).toBe('deck face')
  })

  test('adversarial: Given families not listed, other properties, or no families, Then nothing changes', () => {
    const css = '.x { font-family: "Other", sans-serif; font-size: 2rem; } .y { font-weight: 700 }'
    expect(aliasFontFamilies(css, new Set(['deckface']))).toBe(css)
    expect(aliasFontFamilies(css, new Set())).toBe(css)
    expect(aliasFontFamilies('.x { font-family: "DeckFaceWide"; }', new Set(['deckface']))).toBe('.x { font-family: "DeckFaceWide"; }')
  })
})

describe('aliasFontFamilies: parsing declarations', () => {
  const DECK = new Set(['deck face'])
  const A = `"Deck Face${DRAFT_FAMILY_SUFFIX}"`

  test('adversarial: Given !important with or without spaces, Then the family is renamed and the flag kept byte for byte', () => {
    expect(aliasFontFamilies('.x { font-family: "Deck Face" !important; }', DECK)).toBe(`.x { font-family: ${A} !important; }`)
    expect(aliasFontFamilies('.x{font-family:"Deck Face"!important}', DECK)).toBe(`.x{font-family:${A}!important}`)
    expect(aliasFontFamilies('.x { font-family: Deck Face ! important; }', DECK)).toBe(`.x { font-family: ${A} ! important; }`)
  })

  test('adversarial: Given a shorthand with style, variant, weight, size and line-height and an unquoted multi-word family, Then only the family is renamed', () => {
    expect(aliasFontFamilies('.x { font: italic small-caps 700 2rem/1.2 Deck   Face, serif; }', DECK)).toBe(`.x { font: italic small-caps 700 2rem/1.2 ${A}, serif; }`)
    expect(aliasFontFamilies('.x { font: italic 2rem Deck Face; }', DECK)).toBe(`.x { font: italic 2rem ${A}; }`)
    expect(aliasFontFamilies('.x { font: 700 2rem / 1.5 "deck face" }', DECK)).toBe(`.x { font: 700 2rem / 1.5 "deck face${DRAFT_FAMILY_SUFFIX}" }`)
    expect(aliasFontFamilies('.x { font: large Deck Face !important; }', DECK)).toBe(`.x { font: large ${A} !important; }`)
  })

  test('adversarial: Given several families with the target in the middle, Then only it is renamed and the rest stay as written', () => {
    expect(aliasFontFamilies(".x { font-family: 'Other One',Deck Face ,  serif; }", DECK)).toBe(`.x { font-family: 'Other One',${A} ,  serif; }`)
  })

  test('adversarial: Given escaped quotes and commas inside a quoted family, Then quotes are read as one name and re-emitted escaped', () => {
    const quoted = new Set(['say "hi", there'])
    expect(aliasFontFamilies('.x { font-family: "Say \\"Hi\\", There", serif; }', quoted)).toBe(`.x { font-family: "Say \\"Hi\\", There${DRAFT_FAMILY_SUFFIX}", serif; }`)
  })

  test('adversarial: Given system keywords, generic families, var() and font-* longhands, Then they are left byte-identical', () => {
    for (const css of [
      '.x { font: caption; }',
      '.x { font: menu !important; }',
      '.x { font-family: serif, sans-serif; }',
      '.x { font-family: var(--deck-face); }',
      '.x { font: var(--font); }',
      '.x { font: 2rem var(--family); }',
      '.x { font-size: 2rem; font-weight: 700; }',
      '.x { --font: Deck Face; }',
      '.x { icon-font: Deck Face; }',
    ]) expect(aliasFontFamilies(css, DECK)).toBe(css)
  })

  test('spec: Given the @font-face of a renamed family, Then its family is renamed too, and a different family with the name as prefix is not', () => {
    expect(aliasFontFamilies('@font-face { font-family: Deck Face; src: url(a.woff2); }', DECK)).toBe(`@font-face { font-family: ${A}; src: url(a.woff2); }`)
    expect(aliasFontFamilies('.x { font-family: "Deck Face Wide"; }', DECK)).toBe('.x { font-family: "Deck Face Wide"; }')
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

describe('draftedLayout: which list thumbnail draws the draft', () => {
  test('spec: Given no draft rendered yet, Then every list thumbnail draws its saved files', () => {
    expect(draftedLayout(NO_DRAFT_PREVIEW)).toBeNull()
    expect(draftedLayout(requestDraftPreview(NO_DRAFT_PREVIEW, 'quote').state)).toBeNull()
  })

  test('spec: Given a draft of "quote" rendered, Then the "quote" row draws it, and keeps drawing it while a later draft is requested or fails', () => {
    const first = requestDraftPreview(NO_DRAFT_PREVIEW, 'quote')
    const rendered = draftPreviewRendered(first.state, first.seq, A)
    expect(draftedLayout(rendered)).toBe('quote')
    const second = requestDraftPreview(rendered, 'quote')
    expect(draftedLayout(second.state)).toBe('quote')
    expect(draftedLayout(draftPreviewFailed(second.state, second.seq, 'broken'))).toBe('quote')
  })

  test('adversarial: Given a reset (save, revert, another layout) or a request for another layout, Then no row draws a draft', () => {
    const first = requestDraftPreview(NO_DRAFT_PREVIEW, 'quote')
    const rendered = draftPreviewRendered(first.state, first.seq, A)
    expect(draftedLayout(resetDraftPreview(rendered))).toBeNull()
    expect(draftedLayout(requestDraftPreview(rendered, 'title-body').state)).toBeNull()
  })

  test('adversarial: Given only a failure and no good draft, or a layout named by an empty string, Then it is handled as written', () => {
    const first = requestDraftPreview(NO_DRAFT_PREVIEW, 'quote')
    expect(draftedLayout(draftPreviewFailed(first.state, first.seq, 'broken'))).toBeNull()
    const blank = requestDraftPreview(NO_DRAFT_PREVIEW, '')
    expect(draftedLayout(draftPreviewRendered(blank.state, blank.seq, { fragment: '', css: '' }))).toBe('')
  })
})
