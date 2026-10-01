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

test('spec: successfully persisting a revised body supersedes its earlier failed snapshot', async () => {
  const saves = createSaveTracker()
  saves.begin('first body draft', 'draft')(false)
  expect(await saves.drain()).toBe(false)
  saves.begin('revised body draft', 'draft')(true)
  expect(await saves.drain()).toBe(true)
})

test('spec: a full-deck structural commit can persist a revised body without clearing an unrelated structural failure', async () => {
  const saves = createSaveTracker()
  saves.begin('old body', 'draft')(false)
  saves.begin('revised body with settings', 'structural')(true)
  expect(await saves.drain()).toBe(true)
  saves.begin('failed reorder', 'structural')(false)
  saves.begin('revised body again', 'draft')(true)
  expect(await saves.drain()).toBe(false)
})

test('adversarial: an older save cannot clear a newer failed body, and a late superseded failure cannot revive a stale body error', async () => {
  const saves = createSaveTracker()
  const older = saves.begin('older body', 'draft')
  saves.begin('newer body', 'draft')(false)
  older(true)
  expect(await saves.drain()).toBe(false)
  saves.begin('latest body', 'draft')(true)
  const stale = saves.begin('stale body', 'draft')
  saves.begin('current body', 'draft')(true)
  stale(false)
  expect(await saves.drain()).toBe(true)
})
