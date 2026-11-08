import { describe, expect, test } from 'bun:test'
import { columnWidthBudget } from './columnResize'

describe('columnWidthBudget', () => {
  test('spec: spare preview space allows a column wider than 640 CSS pixels', () => {
    expect(columnWidthBudget({ columnWidth: 420, previewWidth: 872, reservedWidth: 180 })).toBe(1112)
  })

  test('spec: a narrow viewport provides a maximum below 640 CSS pixels', () => {
    expect(columnWidthBudget({ columnWidth: 420, previewWidth: 272, reservedWidth: 180 })).toBe(512)
  })

  test('adversarial: a constrained or absent preview donates no width', () => {
    for (const previewWidth of [0, 52, 179.5, 180]) {
      expect(columnWidthBudget({ columnWidth: 420, previewWidth, reservedWidth: 180 })).toBe(420)
    }
  })

  test('adversarial: fractional CSS widths are preserved at the reserve boundary', () => {
    expect(columnWidthBudget({ columnWidth: 420.25, previewWidth: 180.5, reservedWidth: 180 })).toBe(420.75)
    expect(columnWidthBudget({ columnWidth: 180, previewWidth: 0, reservedWidth: 180 })).toBe(180)
  })
})
