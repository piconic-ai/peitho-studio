import { describe, expect, test } from 'bun:test'
import { isZoomShortcut } from './keyboard'

describe('isZoomShortcut', () => {
  test('spec: Given Cmd or Ctrl, when a browser zoom key is pressed, then it is recognized', () => {
    for (const modifier of [{ metaKey: true, ctrlKey: false }, { metaKey: false, ctrlKey: true }, { metaKey: true, ctrlKey: true }]) {
      for (const key of ['+', '=', '-', '0']) expect(isZoomShortcut({ key, ...modifier })).toBe(true)
    }
  })

  test('adversarial: Given no modifier, when a zoom character is typed, then it stays an editing key', () => {
    for (const key of ['+', '=', '-', '0']) expect(isZoomShortcut({ key, metaKey: false, ctrlKey: false })).toBe(false)
  })

  test('adversarial: Given Cmd or Ctrl, when another key is pressed, then it stays an editing command', () => {
    for (const modifier of [{ metaKey: true, ctrlKey: false }, { metaKey: false, ctrlKey: true }]) {
      for (const key of ['', ' ', 'Enter', 'Escape', 'Backspace', 'v', 'c', 'x', '1', '_', 'Add', 'Subtract', '０', '＋', '−']) {
        expect(isZoomShortcut({ key, ...modifier })).toBe(false)
      }
    }
  })
})
