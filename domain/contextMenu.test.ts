import { describe, expect, test } from 'bun:test'
import { indexOf, positionOf, isLayoutPickerOpen, menuItems, appendIndex, type ContextMenu, type MenuContext } from './contextMenu'

const ctx = (overrides: Partial<MenuContext> = {}): MenuContext => ({
  slideCount: 3,
  hasClipboard: false,
  configOf: () => ({}),
  ...overrides,
})

describe('indexOf', () => {
  test('spec: on-slide carries its index', () => {
    expect(indexOf({ kind: 'on-slide', index: 2, x: 0, y: 0, layoutPickerOpen: false })).toBe(2)
  })

  test('adversarial: closed and on-empty-space both have no index', () => {
    expect(indexOf({ kind: 'closed' })).toBeNull()
    expect(indexOf({ kind: 'on-empty-space', x: 0, y: 0 })).toBeNull()
  })
})

describe('positionOf', () => {
  test('spec: on-slide/on-empty-space report their click position', () => {
    expect(positionOf({ kind: 'on-empty-space', x: 10, y: 20 })).toEqual({ x: 10, y: 20 })
    expect(positionOf({ kind: 'on-slide', index: 0, x: 30, y: 40, layoutPickerOpen: true })).toEqual({ x: 30, y: 40 })
  })

  test('adversarial: closed reports the origin, not a stale position', () => {
    expect(positionOf({ kind: 'closed' })).toEqual({ x: 0, y: 0 })
  })
})

describe('isLayoutPickerOpen', () => {
  test('spec: reflects on-slide\'s own flag', () => {
    expect(isLayoutPickerOpen({ kind: 'on-slide', index: 0, x: 0, y: 0, layoutPickerOpen: true })).toBe(true)
    expect(isLayoutPickerOpen({ kind: 'on-slide', index: 0, x: 0, y: 0, layoutPickerOpen: false })).toBe(false)
  })

  test('adversarial: closed and on-empty-space are never open (there is no picker to open)', () => {
    expect(isLayoutPickerOpen({ kind: 'closed' })).toBe(false)
    expect(isLayoutPickerOpen({ kind: 'on-empty-space', x: 0, y: 0 })).toBe(false)
  })
})

describe('menuItems', () => {
  test('spec: on-slide enables every per-slide action', () => {
    const menu: ContextMenu = { kind: 'on-slide', index: 1, x: 0, y: 0, layoutPickerOpen: false }
    const items = menuItems(menu, ctx())
    const byAction = Object.fromEntries(items.map(i => [i.action, i]))
    expect(byAction['cut'].enabled).toBe(true)
    expect(byAction['copy'].enabled).toBe(true)
    expect(byAction['delete'].enabled).toBe(true)
    expect(byAction['change-layout'].enabled).toBe(true)
    expect(byAction['move-up'].enabled).toBe(true)
    expect(byAction['move-down'].enabled).toBe(true)
  })

  test('spec: closed/on-empty-space disable every per-slide action but keep new-slide enabled', () => {
    const menus: ContextMenu[] = [{ kind: 'closed' }, { kind: 'on-empty-space', x: 0, y: 0 }]
    for (const menu of menus) {
      const items = menuItems(menu, ctx())
      const byAction = Object.fromEntries(items.map(i => [i.action, i]))
      expect(byAction['new-slide'].enabled).toBe(true)
      expect(byAction['cut'].enabled).toBe(false)
      expect(byAction['copy'].enabled).toBe(false)
      expect(byAction['delete'].enabled).toBe(false)
      expect(byAction['change-layout'].enabled).toBe(false)
      expect(byAction['toggle-draft'].enabled).toBe(false)
      expect(byAction['move-up'].enabled).toBe(false)
      expect(byAction['move-down'].enabled).toBe(false)
    }
  })

  test('spec: paste is driven by the clipboard, independent of which slide (if any) is targeted', () => {
    const menu: ContextMenu = { kind: 'closed' }
    expect(menuItems(menu, ctx({ hasClipboard: false })).find(i => i.action === 'paste')?.enabled).toBe(false)
    expect(menuItems(menu, ctx({ hasClipboard: true })).find(i => i.action === 'paste')?.enabled).toBe(true)
  })

  test('adversarial: delete disables itself on the last remaining slide even when targeted', () => {
    const menu: ContextMenu = { kind: 'on-slide', index: 0, x: 0, y: 0, layoutPickerOpen: false }
    expect(menuItems(menu, ctx({ slideCount: 1 })).find(i => i.action === 'delete')?.enabled).toBe(false)
  })

  test('adversarial: move-up/move-down disable at the respective ends of the list', () => {
    const first: ContextMenu = { kind: 'on-slide', index: 0, x: 0, y: 0, layoutPickerOpen: false }
    const last: ContextMenu = { kind: 'on-slide', index: 2, x: 0, y: 0, layoutPickerOpen: false }
    expect(menuItems(first, ctx()).find(i => i.action === 'move-up')?.enabled).toBe(false)
    expect(menuItems(first, ctx()).find(i => i.action === 'move-down')?.enabled).toBe(true)
    expect(menuItems(last, ctx()).find(i => i.action === 'move-up')?.enabled).toBe(true)
    expect(menuItems(last, ctx()).find(i => i.action === 'move-down')?.enabled).toBe(false)
  })

  test('spec: toggle-draft/skip/section reflect the targeted slide\'s own config', () => {
    const menu: ContextMenu = { kind: 'on-slide', index: 1, x: 0, y: 0, layoutPickerOpen: false }
    const items = menuItems(menu, ctx({ configOf: () => ({ draft: true, skip: false, section: 'Intro' }) }))
    const byAction = Object.fromEntries(items.map(i => [i.action, i]))
    expect(byAction['toggle-draft'].checked).toBe(true)
    expect(byAction['toggle-skip'].checked).toBe(false)
    expect(byAction['toggle-section'].checked).toBe(true)
  })

  test('adversarial: an empty (falsy) section string is not treated as a section start', () => {
    const menu: ContextMenu = { kind: 'on-slide', index: 0, x: 0, y: 0, layoutPickerOpen: false }
    const items = menuItems(menu, ctx({ configOf: () => ({ section: undefined }) }))
    expect(items.find(i => i.action === 'toggle-section')?.checked).toBe(false)
  })
})

describe('appendIndex', () => {
  test('spec: on-slide appends after the targeted slide', () => {
    expect(appendIndex({ kind: 'on-slide', index: 1, x: 0, y: 0, layoutPickerOpen: false }, 5)).toBe(1)
  })

  test('adversarial: closed/on-empty-space append at the end of the list', () => {
    expect(appendIndex({ kind: 'closed' }, 5)).toBe(4)
    expect(appendIndex({ kind: 'on-empty-space', x: 0, y: 0 }, 5)).toBe(4)
  })

  test('adversarial: an empty list still returns a usable (negative) anchor for the caller\'s own Math.min clamp', () => {
    expect(appendIndex({ kind: 'closed' }, 0)).toBe(-1)
  })
})
