import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { MAX_LAYOUT_NAME_LENGTH, layoutNameProblem, layoutRows, layoutUsage, shownLayout } from './layoutScreen'
import type { ManifestSlide } from './render'
import { buildSlideList } from './slideList'

function slide(index: number, key: string): ManifestSlide {
  return { index, key, src: '', hasNotes: false, skip: false, revealSteps: 1, text: { title: key, body: '', code: '' } }
}

// Four slides; the third is a draft, so the manifest holds three.
const SOURCE = [
  '<!-- {"key":"cover","layout":"title-slide"} -->\n# Cover',
  '<!-- {"key":"intro","layout":"title-body"} -->\n# Intro',
  '<!-- {"key":"wip","layout":"title-body","draft":true} -->\n# WIP',
  '<!-- {"key":"more","layout":"title-body"} -->\n# More',
].join('\n\n---\n\n')
const ENTRIES = buildSlideList(SOURCE, [slide(0, 'cover'), slide(1, 'intro'), slide(2, 'more')])
const SLIDE_LAYOUTS = { cover: 'title-slide', intro: 'title-body', more: 'title-body' }

describe('layoutUsage', () => {
  test('spec: Given a deck whose slides are on two layouts, When usage is counted, Then each layout lists its slides by their place in deck.md', () => {
    expect(layoutUsage(ENTRIES, SLIDE_LAYOUTS)).toEqual(new Map([['title-slide', [0]], ['title-body', [1, 3]]]))
  })

  test('spec: Given a draft slide before another, When usage is counted, Then the later slide keeps its own position and the draft counts for no layout', () => {
    // `more` is the fourth slide of deck.md even though it's the third
    // the render built — the draft before it takes a place too.
    expect(layoutUsage(ENTRIES, SLIDE_LAYOUTS).get('title-body')).toEqual([1, 3])
  })

  test('adversarial: Given no slides, or no layout reported for a slide, When usage is counted, Then nothing is invented', () => {
    expect(layoutUsage([], SLIDE_LAYOUTS)).toEqual(new Map())
    expect(layoutUsage(ENTRIES, {})).toEqual(new Map())
    expect(layoutUsage(ENTRIES, { cover: 'title-slide' })).toEqual(new Map([['title-slide', [0]]]))
  })

  test('adversarial: Given a slide key that collides with an Object prototype name, When usage is counted, Then only the layouts actually reported count', () => {
    const entries = buildSlideList('<!-- {"key":"constructor"} -->\n# X', [slide(0, 'constructor')])
    expect(layoutUsage(entries, {})).toEqual(new Map())
    expect(layoutUsage(entries, { constructor: 'blank' })).toEqual(new Map([['blank', [0]]]))
  })

  test('adversarial: Given layouts named like Object prototype members, When usage is counted and listed, Then each counts only its own slides', () => {
    const source = ['constructor', 'toString', '__proto__', 'hasOwnProperty'].map(key => `<!-- {"key":"${key}"} -->\n# ${key}`).join('\n\n---\n\n')
    const entries = buildSlideList(source, ['constructor', 'toString', '__proto__', 'hasOwnProperty'].map((key, i) => slide(i, key)))
    // Parsed, so `__proto__` is an own key as it is in a render payload.
    const slideLayouts = JSON.parse('{"constructor":"constructor","toString":"toString","__proto__":"__proto__","hasOwnProperty":"toString"}') as Record<string, string>
    const usage = layoutUsage(entries, slideLayouts)
    expect(usage).toEqual(new Map([['constructor', [0]], ['toString', [1, 3]], ['__proto__', [2]]]))
    const rows = layoutRows(['constructor', 'toString', '__proto__', 'valueOf'], usage, 'en', 0)
    expect(rows.map(row => [row.name, row.usage])).toEqual([['constructor', 1], ['toString', 2], ['__proto__', 1], ['valueOf', 0]])
  })
})

describe('layoutRows', () => {
  test('spec: Given the deck\'s layouts, When the list is built, Then each row has its display name and how many slides use it, in the deck\'s order', () => {
    const rows = layoutRows(['title-slide', 'title-body', 'quote'], layoutUsage(ENTRIES, SLIDE_LAYOUTS), 'ja', 1)
    expect(rows.map(row => [row.name, row.label, row.usage])).toEqual([
      ['title-slide', 'タイトルスライド', 1],
      ['title-body', 'タイトルと本文', 2],
      ['quote', 'quote', 0],
    ])
    expect(rows.every(row => row.deletable)).toBe(true)
  })

  test('spec: Given the deck\'s only layout, When the list is built, Then its row offers no Delete', () => {
    expect(layoutRows(['title-body-code'], new Map(), 'en', 0)).toEqual([
      { key: '0:title-body-code', name: 'title-body-code', label: 'title-body-code', usage: 0, deletable: false },
    ])
  })

  test('spec: Given a fresh set of previews, When the list is rebuilt, Then every row gets a new key so its thumbnail is drawn again', () => {
    const before = layoutRows(['a', 'b'], new Map(), 'en', 1).map(row => row.key)
    const after = layoutRows(['a', 'b'], new Map(), 'en', 2).map(row => row.key)
    expect(after.some(key => before.includes(key))).toBe(false)
  })

  test('adversarial: Given no layouts, When the list is built, Then it is empty', () => {
    expect(layoutRows([], new Map(), 'en', 0)).toEqual([])
  })
})

describe('shownLayout', () => {
  test('spec: Given the shown layout is still in the deck, Then it stays shown', () => {
    expect(shownLayout('b', ['a', 'b'])).toBe('b')
  })

  test('spec: Given nothing shown yet, or a layout just deleted, Then the first layout is shown', () => {
    expect(shownLayout(null, ['a', 'b'])).toBe('a')
    expect(shownLayout('gone', ['a', 'b'])).toBe('a')
  })

  test('adversarial: Given a deck with no layouts listed, Then nothing is shown', () => {
    expect(shownLayout(null, [])).toBeNull()
    expect(shownLayout('a', [])).toBeNull()
  })
})

describe('layoutNameProblem', () => {
  test('spec: Given a plain new name, Then it can be used (surrounding spaces are trimmed)', () => {
    expect(layoutNameProblem('quote', ['title-body'])).toBeNull()
    expect(layoutNameProblem('  my_layout-2 ', [])).toBeNull()
    expect(layoutNameProblem('2col', [])).toBeNull()
  })

  test('adversarial: Given an empty or blank name, Then it is "empty"', () => {
    for (const name of ['', ' ', '\t\n']) expect(layoutNameProblem(name, [])).toBe('empty')
  })

  test('adversarial: Given a name that could act as a path, or holds other characters, Then it is "invalid"', () => {
    for (const name of ['../x', 'a/b', 'a\\b', '.hidden', '.', 'x.html', 'a b', '表紙', 'café']) {
      expect(layoutNameProblem(name, [])).toBe('invalid')
    }
  })

  test('adversarial: Given a name starting with - or _, Then it must "start" with a letter or digit', () => {
    for (const name of ['-x', '_x', '--']) expect(layoutNameProblem(name, [])).toBe('start')
  })

  test('adversarial: Given a name the deck already has, in any case, Then it is "taken"', () => {
    for (const name of ['title-body', 'Title-Body', ' TITLE-BODY ']) expect(layoutNameProblem(name, ['title-body'])).toBe('taken')
  })

  test('adversarial: Given a name one past the limit, Then it is "too-long"; at the limit it is fine', () => {
    expect(layoutNameProblem('a'.repeat(MAX_LAYOUT_NAME_LENGTH), [])).toBeNull()
    expect(layoutNameProblem('a'.repeat(MAX_LAYOUT_NAME_LENGTH + 1), [])).toBe('too-long')
  })

  test('spec: Given the Rust side\'s limit, Then this one is the same', () => {
    const rust = readFileSync(join(import.meta.dir, '../src-tauri/src/engine/layout_files.rs'), 'utf-8')
    expect(rust).toContain(`const MAX_NAME_LEN: usize = ${String(MAX_LAYOUT_NAME_LENGTH)};`)
  })
})
