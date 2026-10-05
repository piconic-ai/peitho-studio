import { describe, expect, test } from 'bun:test'
import {
  COMMENT_MENU_CLOSED, commentMenuItems, commentMenuLabel, commentMenuPosition, isOpenOnEditor,
  openOnEditor, selectionForMenu, withCommentMenuPosition,
  type CommentMenu, type CommentMenuAction, type MenuEditor,
} from './commentMenu'
import { messagesFor } from './messages'
const EDITORS: MenuEditor[] = ['body', 'note', 'layout']
const ACTIONS: CommentMenuAction[] = ['comment-lines', 'cut', 'copy', 'paste']

function enabledOf(menu: CommentMenu): Record<string, boolean> {
  return Object.fromEntries(commentMenuItems(menu).map(item => [item.action, item.enabled]))
}

describe('commentMenuItems', () => {
  test('spec: Given a right-click on an editor with lines selected, Then a comment on them, then — set apart — Cut, Copy and Paste, all enabled', () => {
    const menu = openOnEditor('body', 1, 2, 3, 9)
    expect(commentMenuItems(menu).map(item => [item.action, item.separatorBefore])).toEqual([
      ['comment-lines', false], ['cut', true], ['copy', false], ['paste', false],
    ])
    expect(enabledOf(menu)).toEqual({ 'comment-lines': true, cut: true, copy: true, paste: true })
  })

  test('spec: Given a right-click on an editor with only a caret, Then Cut and Copy are off, the comment and Paste on', () => {
    expect(enabledOf(openOnEditor('layout', 1, 2, 5, 5))).toEqual({ 'comment-lines': true, cut: false, copy: false, paste: true })
  })

  test('adversarial: Given the menu closed, Then there is nothing to offer', () => {
    expect(commentMenuItems(COMMENT_MENU_CLOSED)).toEqual([])
  })

  test('exhaustive: Given every editor and selection, Then the items are the same four in the same order, and never throw', () => {
    for (const editor of EDITORS) {
      for (const [from, to] of [[0, 0], [0, 1], [7, 2], [Number.NaN, 3]]) {
        expect(commentMenuItems(openOnEditor(editor, 0, 0, from, to)).map(item => item.action)).toEqual(['comment-lines', 'cut', 'copy', 'paste'])
      }
    }
  })
})

describe('commentMenuLabel', () => {
  test('spec: Given lines selected, Then the comment is on the selected lines; with a caret, on this line — in both languages', () => {
    const en = messagesFor('en')
    const ja = messagesFor('ja')
    expect(commentMenuLabel('comment-lines', openOnEditor('note', 0, 0, 1, 4), en)).toBe('Comment on Selected Lines…')
    expect(commentMenuLabel('comment-lines', openOnEditor('note', 0, 0, 4, 4), en)).toBe('Comment on This Line…')
    expect(commentMenuLabel('comment-lines', openOnEditor('body', 0, 0, 1, 4), ja)).toBe('選択した行にコメント…')
    expect(commentMenuLabel('comment-lines', openOnEditor('body', 0, 0, 4, 4), ja)).toBe('この行にコメント…')
  })

  test('exhaustive: Given every action and either language, Then each has a label of its own', () => {
    for (const language of ['en', 'ja'] as const) {
      const labels = ACTIONS.map(action => commentMenuLabel(action, openOnEditor('body', 0, 0, 0, 0), messagesFor(language)))
      expect(labels.every(label => label !== '')).toBe(true)
      expect(new Set(labels).size).toBe(ACTIONS.length)
    }
  })
})

describe('where the menu is', () => {
  test('spec: Given an open menu, Then it is where it was opened, and moving it keeps what it is open on', () => {
    const menu = openOnEditor('layout', 300, 400, 1, 2)
    expect(commentMenuPosition(menu)).toEqual({ x: 300, y: 400 })
    expect(withCommentMenuPosition(menu, { x: 10, y: 20 })).toEqual(openOnEditor('layout', 10, 20, 1, 2))
    expect(isOpenOnEditor(menu, 'layout')).toBe(true)
    expect(isOpenOnEditor(menu, 'body')).toBe(false)
  })

  test('adversarial: Given the menu closed, Then it sits nowhere and moving it changes nothing', () => {
    expect(commentMenuPosition(COMMENT_MENU_CLOSED)).toEqual({ x: 0, y: 0 })
    expect(withCommentMenuPosition(COMMENT_MENU_CLOSED, { x: 5, y: 5 })).toBe(COMMENT_MENU_CLOSED)
    expect(isOpenOnEditor(COMMENT_MENU_CLOSED, 'body')).toBe(false)
  })
})

describe('selectionForMenu', () => {
  test('spec: Given a right-click inside the selected text, Then the selection is kept', () => {
    expect(selectionForMenu(4, 10, 6)).toEqual({ from: 4, to: 10, moved: false })
    // Either way round, and on either end of it.
    expect(selectionForMenu(10, 4, 4)).toEqual({ from: 4, to: 10, moved: false })
    expect(selectionForMenu(4, 10, 10)).toEqual({ from: 4, to: 10, moved: false })
  })

  test('spec: Given a right-click outside the selection, or with only a caret, Then the caret goes where it landed', () => {
    expect(selectionForMenu(4, 10, 20)).toEqual({ from: 20, to: 20, moved: true })
    expect(selectionForMenu(4, 4, 9)).toEqual({ from: 9, to: 9, moved: true })
  })

  test('adversarial: Given a right-click on the caret itself, or where it could not be told, Then nothing moves', () => {
    expect(selectionForMenu(4, 4, 4)).toEqual({ from: 4, to: 4, moved: false })
    expect(selectionForMenu(4, 10, null)).toEqual({ from: 4, to: 10, moved: false })
    expect(selectionForMenu(4, 10, Number.NaN)).toEqual({ from: 4, to: 10, moved: false })
  })
})
