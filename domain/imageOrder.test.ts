import { expect, test } from 'bun:test'
import { moveImageOrder } from './imageOrder'

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
