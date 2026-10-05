import { describe, expect, test } from 'bun:test'
import { fileLanguage, fileName, fileTreeRows, layoutFilePaths, layoutOfFile, toggledFolder, type DeckFileEntry } from './deckFiles'

const dir = (path: string): DeckFileEntry => ({ path, kind: 'dir', editable: false })
const file = (path: string, editable = true): DeckFileEntry => ({ path, kind: 'file', editable })

/** A deck's tree as `list_deck_files` lists it: depth-first, folders first. */
const ENTRIES: DeckFileEntry[] = [
  dir('layouts'), file('layouts/cover.html'), file('layouts/title-body.html'),
  dir('css'), file('css/base.css'), file('css/cover.css'),
  dir('img'), dir('img/photos'), file('img/photos/a.jpg', false), file('img/logo.png', false),
  dir('fonts'),
]

describe('the file tree\'s rows', () => {
  test('spec: Given a deck\'s files and no folder closed, Then every entry is a row, each indented by its folder depth', () => {
    const rows = fileTreeRows(ENTRIES, new Set())
    expect(rows.map(row => `${'  '.repeat(row.depth)}${row.name}`)).toEqual([
      'layouts', '  cover.html', '  title-body.html',
      'css', '  base.css', '  cover.css',
      'img', '  photos', '    a.jpg', '  logo.png',
      'fonts',
    ])
    expect(rows.find(row => row.path === 'img')?.expanded).toBe(true)
  })

  test('spec: Given a folder closed, Then what is in it — subfolders too — is hidden, and the folder row says it is closed', () => {
    const rows = fileTreeRows(ENTRIES, new Set(['img']))
    expect(rows.map(row => row.path)).toEqual(['layouts', 'layouts/cover.html', 'layouts/title-body.html', 'css', 'css/base.css', 'css/cover.css', 'img', 'fonts'])
    expect(rows.find(row => row.path === 'img')?.expanded).toBe(false)
  })

  test('spec: Given images and fonts, Then they are rows that don\'t open as text', () => {
    const rows = fileTreeRows(ENTRIES, new Set())
    expect(rows.find(row => row.path === 'img/logo.png')?.editable).toBe(false)
    expect(rows.find(row => row.path === 'css/base.css')?.editable).toBe(true)
  })

  test('adversarial: Given no entries, a folder flagged editable, or a closed folder that isn\'t there, Then nothing breaks', () => {
    expect(fileTreeRows([], new Set(['img']))).toEqual([])
    expect(fileTreeRows([{ path: 'css', kind: 'dir', editable: true }], new Set())[0].editable).toBe(false)
    expect(fileTreeRows([file('css/base.css')], new Set(['nowhere'])).length).toBe(1)
    // A closed folder whose name is a prefix of another's hides only its own.
    expect(fileTreeRows([dir('img'), file('img/a.png'), dir('imgs'), file('imgs/b.png')], new Set(['img'])).map(row => row.path)).toEqual(['img', 'imgs', 'imgs/b.png'])
  })

  test('spec: Given a folder toggled twice, Then it is back as it was', () => {
    const closed = toggledFolder(new Set(), 'img')
    expect([...closed]).toEqual(['img'])
    expect([...toggledFolder(closed, 'img')]).toEqual([])
  })
})

describe('which layout a file belongs to', () => {
  const NAMES = ['cover', 'title-body']

  test('spec: Given a layout\'s HTML or own CSS, Then it belongs to that layout', () => {
    expect(layoutOfFile('layouts/cover.html', NAMES)).toBe('cover')
    expect(layoutOfFile('css/title-body.css', NAMES)).toBe('title-body')
    expect(layoutFilePaths('cover')).toEqual({ html: 'layouts/cover.html', css: 'css/cover.css' })
  })

  test('spec: Given css/base.css or an image, Then it belongs to no single layout', () => {
    expect(layoutOfFile('css/base.css', NAMES)).toBeNull()
    expect(layoutOfFile('img/logo.png', NAMES)).toBeNull()
  })

  test('adversarial: Given lookalike paths, a subfolder, or a layout the deck lacks, Then no layout is picked', () => {
    for (const path of ['', 'layouts/cover.css', 'css/cover.html', 'layouts/sub/cover.html', 'xlayouts/cover.html', 'layouts/cover.html/', 'layouts/nowhere.html', 'layouts/.html']) {
      expect(layoutOfFile(path, NAMES)).toBeNull()
    }
    expect(layoutOfFile('layouts/cover.html', [])).toBeNull()
  })
})

describe('a file\'s name and language', () => {
  test('spec: the name is the path\'s last part; .html and .css open as HTML and CSS', () => {
    expect(fileName('img/photos/a.jpg')).toBe('a.jpg')
    expect(fileName('layouts')).toBe('layouts')
    expect(fileLanguage('layouts/cover.html')).toBe('html')
    expect(fileLanguage('css/base.css')).toBe('css')
  })

  test('adversarial: an empty path or a trailing slash, and files of other kinds', () => {
    expect(fileName('')).toBe('')
    expect(fileName('img/')).toBe('img')
    expect(fileLanguage('img/logo.png')).toBeNull()
    expect(fileLanguage('')).toBeNull()
  })
})
