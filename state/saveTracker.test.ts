import { expect, test } from 'bun:test'
import { createSaveTracker } from './saveTracker'

test('spec: update-exit waits for every overlapping save and queued follow-up', async () => {
  const saves = createSaveTracker()
  const first = saves.begin('first')
  const second = saves.begin('second')
  let settled = false
  const drain = saves.drain().then(saved => { settled = true; return saved })
  first(true)
  await Promise.resolve()
  expect(settled).toBe(false)
  expect(saves.pendingCount()).toBe(1)
  const queued = saves.begin('queued')
  second(true)
  await Promise.resolve()
  expect(settled).toBe(false)
  queued(true)
  expect(await drain).toBe(true)
})

test('spec: a failed structural save blocks exit until that source is successfully retried', async () => {
  const saves = createSaveTracker()
  const structural = saves.begin('reordered deck')
  const body = saves.begin('edited body')
  structural(false)
  body(true)
  expect(await saves.drain()).toBe(false)
  saves.begin('reordered deck')(true)
  expect(await saves.drain()).toBe(true)
})

test('adversarial: failure after overlapping success is retained; duplicate completion is ignored', async () => {
  const saves = createSaveTracker()
  expect(await saves.drain()).toBe(true)
  const first = saves.begin('same source')
  const second = saves.begin('same source')
  first(true)
  second(false)
  second(true)
  expect(saves.pendingCount()).toBe(0)
  expect(await saves.drain()).toBe(false)
})
