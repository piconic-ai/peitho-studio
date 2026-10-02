import { describe, expect, test } from 'bun:test'
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { DEFAULT_LAYOUT, STANDARD_LAYOUTS, layoutDisplayName, newSlideLayout } from './standardLayouts'

// The files `create_deck` writes the standard layouts from.
const BUILTIN_DIR = join(import.meta.dir, '../src-tauri/src/engine/builtin')
const STANDARD_DIR = join(BUILTIN_DIR, 'standard')

const NAMES = STANDARD_LAYOUTS.map(layout => layout.name)
// A deck New Deck creates: the standard layouts and the image layout.
const NEW_DECK = [...NAMES, 'title-body-image']

describe('STANDARD_LAYOUTS', () => {
  test('spec: Given the layout files the app ships, Then this list names exactly those, in the order engine/builtin.rs lists them', () => {
    const files = readdirSync(STANDARD_DIR).filter(file => file.endsWith('.html')).map(file => file.replace(/\.html$/, ''))
    expect([...files].sort()).toEqual([...NAMES].sort())
    const rust = readFileSync(join(BUILTIN_DIR, '../builtin.rs'), 'utf-8')
    const rustOrder = [...rust.matchAll(/standard_layout!\("([^"]+)"\)/g)].map(match => match[1])
    expect(rustOrder).toEqual(NAMES)
  })

  test('spec: Given the standard layouts, Then there are the eleven of the reference slide menu, title-body among them', () => {
    expect(NAMES).toHaveLength(11)
    expect(NAMES).toContain(DEFAULT_LAYOUT)
  })

  test('adversarial: Given every label, Then none is empty and no two layouts share one in a language', () => {
    for (const language of ['en', 'ja'] as const) {
      const labels = STANDARD_LAYOUTS.map(layout => layout.label[language])
      expect(labels.every(label => label.trim() !== '')).toBe(true)
      expect(new Set(labels).size).toBe(labels.length)
    }
  })

  test('adversarial: Given every name, Then it is a plain file stem (lowercase words joined by hyphens)', () => {
    for (const name of NAMES) expect(name).toMatch(/^[a-z]+(-[a-z]+)*$/)
  })
})

describe('layoutDisplayName', () => {
  test('spec: Given a standard layout, Then its label in the UI language', () => {
    expect(layoutDisplayName('title-body', 'en')).toBe('Title and body')
    expect(layoutDisplayName('title-body', 'ja')).toBe('タイトルと本文')
    expect(layoutDisplayName('big-number', 'ja')).toBe('数字(大)')
  })

  test('spec: Given a deck\'s own layout, Then its name as is, in either language', () => {
    expect(layoutDisplayName('cover', 'en')).toBe('cover')
    expect(layoutDisplayName('title-body-image', 'ja')).toBe('title-body-image')
  })

  test('adversarial: Given an empty name or one only differing in case or spacing, Then it is shown as is', () => {
    expect(layoutDisplayName('', 'en')).toBe('')
    expect(layoutDisplayName('Title-Body', 'en')).toBe('Title-Body')
    expect(layoutDisplayName(' title-body', 'ja')).toBe(' title-body')
  })
})

describe('newSlideLayout', () => {
  test('spec: Given a previous slide on most standard layouts, Then the new slide stays on it', () => {
    for (const name of ['section-header', 'title-body', 'two-column', 'title-only', 'one-column-text', 'main-point', 'section-title-description', 'big-number']) {
      expect(newSlideLayout(name, NEW_DECK)).toBe(name)
    }
  })

  test('spec: Given a previous slide on the title slide, Then the new slide is title-body (a deck has one title slide)', () => {
    expect(newSlideLayout('title-slide', NEW_DECK)).toBe('title-body')
  })

  test('spec: Given a previous slide on a layout without a title, Then the new slide (which opens with a heading) is title-body', () => {
    expect(newSlideLayout('caption', NEW_DECK)).toBe('title-body')
    expect(newSlideLayout('blank', NEW_DECK)).toBe('title-body')
  })

  test('spec: Given no previous layout, Then title-body in a deck that has it, and none in one that doesn\'t', () => {
    expect(newSlideLayout(null, NEW_DECK)).toBe('title-body')
    expect(newSlideLayout(null, ['cover', 'title-body-code'])).toBeNull()
  })

  test('spec: Given a deck\'s own layout, Then the new slide stays on it', () => {
    expect(newSlideLayout('title-body-image', NEW_DECK)).toBe('title-body-image')
    expect(newSlideLayout('cover', ['cover', 'title-body-code'])).toBe('cover')
  })

  test('adversarial: Given a deck without title-body, Then a layout named like a standard one is carried over as is', () => {
    // A deck of its own that happens to call a layout `blank`: nothing to
    // fall back to, so it keeps what it had before standard layouts.
    expect(newSlideLayout('blank', ['blank', 'cover'])).toBe('blank')
    expect(newSlideLayout('title-slide', [])).toBe('title-slide')
  })

  test('adversarial: Given an empty previous layout, Then it counts as none', () => {
    expect(newSlideLayout('', NEW_DECK)).toBe('title-body')
    expect(newSlideLayout('', [])).toBeNull()
  })

  test('adversarial: Given a previous layout the deck no longer has, Then it is still carried over (the build names the problem)', () => {
    expect(newSlideLayout('removed', NEW_DECK)).toBe('removed')
  })
})
