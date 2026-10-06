import { expect, test } from 'bun:test'
import { moveImageOrder, canvasImageOrder } from './imageOrder'

test('four image order actions move to either end or one layer at a time', () => {
  const order = ['a', 'b', 'c', 'd']
  expect(moveImageOrder(order, 'b', 'front')).toEqual(['a', 'c', 'd', 'b'])
  expect(moveImageOrder(order, 'b', 'forward')).toEqual(['a', 'c', 'b', 'd'])
  expect(moveImageOrder(order, 'c', 'backward')).toEqual(['a', 'c', 'b', 'd'])
  expect(moveImageOrder(order, 'c', 'back')).toEqual(['c', 'a', 'b', 'd'])
  expect(order).toEqual(['a', 'b', 'c', 'd'])
})

test('missing images and layer boundaries leave the order intact', () => {
  expect(moveImageOrder(['a'], 'a', 'forward')).toEqual(['a'])
  expect(moveImageOrder(['a', 'b'], 'a', 'backward')).toEqual(['a', 'b'])
  expect(moveImageOrder(['a', 'b'], 'b', 'front')).toEqual(['a', 'b'])
  expect(moveImageOrder(['a', 'b'], 'missing', 'back')).toEqual(['a', 'b'])
  expect(moveImageOrder([], 'missing', 'front')).toEqual([])
})


test('the text layer makes even a single image movable from front to back', () => {
  const order = canvasImageOrder([{ slot: 'image', layer: 0 }])
  expect(order).toEqual(['studio-content', 'image'])
  expect(moveImageOrder(order, 'image', 'back')).toEqual(['image', 'studio-content'])
  expect(canvasImageOrder([{ slot: 'a', layer: -2 }, { slot: 'b', layer: 1 }, { slot: 'c', layer: -1 }])).toEqual(['a', 'c', 'studio-content', 'b'])
})
