import { describe, expect, test } from 'bun:test'
import {
  LAYOUT_MENU_CLOSED, type LayoutMenu, type LayoutMenuAction, type LayoutMenuContext,
  layoutMenuItems, layoutMenuLabel, layoutMenuPosition, layoutMenuSeparatorBefore, layoutMenuSlot, layoutMenuTarget, layoutMenuTitle,
  openOnLayout, openOnList, openOnPreview, withLayoutMenuFit, withLayoutMenuPosition,
} from './layoutMenu'
import { messagesFor } from './messages'

const READY: LayoutMenuContext = { hasSlide: true, layoutCount: 3, busy: false }

function enabledOf(menu: LayoutMenu, ctx: LayoutMenuContext): Record<string, boolean> {
  return Object.fromEntries(layoutMenuItems(menu, ctx).map(item => [item.action, item.enabled]))
}

describe('layoutMenuItems', () => {
  test('spec: Given a right-click on a layout the open slide fits, Then Apply, Edit, Duplicate, Delete and a comment on it are offered, all enabled', () => {
    const menu = withLayoutMenuFit(openOnLayout('quote', 10, 20, 1), 1, [{ layout: 'quote', fit: { kind: 'fits' } }])
    expect(layoutMenuItems(menu, READY).map(item => item.action)).toEqual(['apply', 'edit', 'duplicate', 'delete', 'comment-layout'])
    expect(enabledOf(menu, READY)).toEqual({ apply: true, edit: true, duplicate: true, delete: true, 'comment-layout': true })
  })

  test('spec: Given a right-click on empty list space, Then New Layout and a comment on every layout are offered', () => {
    expect(layoutMenuItems(openOnList(1, 2), READY)).toEqual([
      { action: 'new-layout', enabled: true, reason: null },
      { action: 'comment-all-layouts', enabled: true, reason: null },
    ])
  })

  test('spec: Given no slide open in Slides, Then Apply is off and says why', () => {
    const items = layoutMenuItems(openOnLayout('quote', 0, 0, null), { ...READY, hasSlide: false })
    expect(items[0]).toEqual({ action: 'apply', enabled: false, reason: { kind: 'no-slide' } })
  })

  test('spec: Given a slide that does not fit the layout, Then Apply is off with peitho-core\'s reason', () => {
    const menu = withLayoutMenuFit(openOnLayout('quote', 0, 0, 7), 7, [{ layout: 'quote', fit: { kind: 'mismatch', reason: "missing 'body' slot" } }])
    expect(layoutMenuItems(menu, READY)[0]).toEqual({ action: 'apply', enabled: false, reason: { kind: 'mismatch', reason: "missing 'body' slot" } })
  })

  test('spec: Given the fit check still running, Then Apply waits; an unavailable check leaves it on', () => {
    expect(enabledOf(openOnLayout('quote', 0, 0, 1), READY).apply).toBe(false)
    expect(enabledOf(withLayoutMenuFit(openOnLayout('quote', 0, 0, 1), 1, null), READY).apply).toBe(true)
  })

  test('spec: Given the deck\'s only layout, Then Delete is off', () => {
    const items = layoutMenuItems(openOnLayout('only', 0, 0, null), { ...READY, layoutCount: 1 })
    expect(items.find(item => item.action === 'delete')).toEqual({ action: 'delete', enabled: false, reason: { kind: 'only-layout' } })
  })

  test('adversarial: Given another operation running, Then every item but Edit and the comments waits', () => {
    const busy = { ...READY, busy: true }
    const menu = withLayoutMenuFit(openOnLayout('quote', 0, 0, 1), 1, null)
    expect(enabledOf(menu, busy)).toEqual({ apply: false, edit: true, duplicate: false, delete: false, 'comment-layout': true })
    expect(enabledOf(openOnList(0, 0), busy)).toEqual({ 'new-layout': false, 'comment-all-layouts': true })
  })

  test('adversarial: Given the deck\'s only layout and no slide open, Then a comment on it is still offered', () => {
    const items = layoutMenuItems(openOnLayout('only', 0, 0, null), { hasSlide: false, layoutCount: 1, busy: false })
    expect(items.find(item => item.action === 'comment-layout')).toEqual({ action: 'comment-layout', enabled: true, reason: null })
  })

  test('adversarial: Given a closed menu, Then it has no items', () => {
    expect(layoutMenuItems(LAYOUT_MENU_CLOSED, READY)).toEqual([])
  })

  test('adversarial: Given layout names that look like prototype members or are empty, Then they are just names', () => {
    for (const name of ['constructor', '__proto__', '', '<b>x</b>']) {
      const menu = withLayoutMenuFit(openOnLayout(name, 0, 0, 1), 1, [{ layout: name, fit: { kind: 'fits' } }])
      expect(layoutMenuTarget(menu)).toBe(name)
      expect(enabledOf(menu, READY).apply).toBe(true)
    }
  })
})

describe('withLayoutMenuFit', () => {
  test('adversarial: Given an answer to an earlier right-click, Then it is dropped', () => {
    const menu = openOnLayout('quote', 0, 0, 2)
    expect(withLayoutMenuFit(menu, 1, [])).toBe(menu)
    expect(withLayoutMenuFit(LAYOUT_MENU_CLOSED, 2, [])).toBe(LAYOUT_MENU_CLOSED)
    const list = openOnList(0, 0)
    expect(withLayoutMenuFit(list, 2, [])).toBe(list)
  })

  test('adversarial: Given a check already settled, Then a second answer leaves it', () => {
    const settled = withLayoutMenuFit(openOnLayout('quote', 0, 0, 3), 3, null)
    expect(withLayoutMenuFit(settled, 3, [{ layout: 'quote', fit: { kind: 'mismatch', reason: 'x' } }])).toBe(settled)
  })
})

describe('position and target', () => {
  test('spec: Given an open menu, Then it is drawn where it was opened, and can be moved on-screen', () => {
    const menu = openOnLayout('quote', 30, 40, null)
    expect(layoutMenuPosition(menu)).toEqual({ x: 30, y: 40 })
    expect(layoutMenuPosition(withLayoutMenuPosition(menu, { x: 5, y: 6 }))).toEqual({ x: 5, y: 6 })
    expect(layoutMenuTarget(withLayoutMenuPosition(menu, { x: 5, y: 6 }))).toBe('quote')
  })

  test('adversarial: Given a closed menu or empty space, Then nothing is targeted and a closed menu stays put', () => {
    expect(layoutMenuTarget(LAYOUT_MENU_CLOSED)).toBeNull()
    expect(layoutMenuTarget(openOnList(1, 1))).toBeNull()
    expect(layoutMenuPosition(LAYOUT_MENU_CLOSED)).toEqual({ x: 0, y: 0 })
    expect(withLayoutMenuPosition(LAYOUT_MENU_CLOSED, { x: 9, y: 9 })).toBe(LAYOUT_MENU_CLOSED)
  })
})

describe('labels and titles', () => {
  test('spec: Given every action, When worded in each language, Then each has its own non-empty label', () => {
    const actions: LayoutMenuAction[] = ['new-layout', 'apply', 'edit', 'duplicate', 'delete', 'comment-layout', 'comment-all-layouts', 'comment-here']
    for (const language of ['en', 'ja'] as const) {
      const labels = actions.map(action => layoutMenuLabel(action, messagesFor(language)))
      expect(labels.every(label => label.trim() !== '')).toBe(true)
      expect(new Set(labels).size).toBe(actions.length)
    }
  })

  test('spec: Given why an item is off, Then the title says so; an enabled one has none', () => {
    const en = messagesFor('en')
    expect(layoutMenuTitle(null, en)).toBe('')
    expect(layoutMenuTitle({ kind: 'mismatch', reason: "missing 'body' slot" }, en)).toBe("missing 'body' slot")
    for (const kind of ['no-slide', 'checking', 'only-layout'] as const) expect(layoutMenuTitle({ kind }, en)).not.toBe('')
  })
})

describe('the menu on the selected layout\'s large preview', () => {
  test('spec: Given a right-click on the large preview in a slot, Then a comment on what was clicked comes first, then — set apart — Apply, Duplicate and Delete; no Edit', () => {
    const menu = withLayoutMenuFit(openOnPreview('quote', 'body', 10, 20, 4), 4, [{ layout: 'quote', fit: { kind: 'fits' } }])
    expect(layoutMenuItems(menu, READY).map(item => item.action)).toEqual(['comment-here', 'apply', 'duplicate', 'delete'])
    expect(enabledOf(menu, READY)).toEqual({ 'comment-here': true, apply: true, duplicate: true, delete: true })
    expect(layoutMenuItems(menu, READY).map(item => layoutMenuSeparatorBefore(menu, item.action))).toEqual([false, true, false, false])
    expect(layoutMenuTarget(menu)).toBe('quote')
    expect(layoutMenuSlot(menu)).toBe('body')
    expect(layoutMenuLabel('comment-here', messagesFor('ja'))).toBe('コメント…')
  })

  test('spec: Given a busy screen or the deck\'s only layout, Then the comment is still offered while the rest wait or are off, as on a row', () => {
    const menu = openOnPreview('quote', null, 0, 0, null)
    expect(enabledOf(menu, { ...READY, busy: true })).toEqual({ 'comment-here': true, apply: false, duplicate: false, delete: false })
    expect(enabledOf(menu, { ...READY, layoutCount: 1 }).delete).toBe(false)
    expect(layoutMenuSlot(menu)).toBeNull()
  })

  test('spec: Given its fit check, Then it settles as a row\'s does, and a stale answer is dropped', () => {
    const menu = openOnPreview('quote', null, 0, 0, 5)
    expect(enabledOf(menu, READY).apply).toBe(false)
    expect(withLayoutMenuFit(menu, 4, [])).toBe(menu)
    expect(enabledOf(withLayoutMenuFit(menu, 5, null), READY).apply).toBe(true)
  })

  test('adversarial: Given a row\'s menu or empty space, Then nothing is set apart and no slot is known', () => {
    for (const menu of [openOnLayout('quote', 0, 0, null), openOnList(0, 0), LAYOUT_MENU_CLOSED]) {
      expect(layoutMenuSlot(menu)).toBeNull()
      expect(layoutMenuItems(menu, READY).some(item => layoutMenuSeparatorBefore(menu, item.action))).toBe(false)
    }
  })
})
