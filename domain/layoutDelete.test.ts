import { describe, expect, test } from 'bun:test'
import { DELETE_IDLE, cancelDelete, canConfirmDelete, confirmDelete, deletingName, pickReplacement, replacementChoices, startDelete } from './layoutDelete'

const NAMES = ['title-slide', 'title-body', 'quote']

describe('deleting a layout', () => {
  test('spec: Given an unused layout, When Delete is chosen, Then it only asks for confirmation, and confirming deletes it with no slide to move', () => {
    const flow = startDelete('quote', NAMES, [])
    expect(flow).toEqual({ kind: 'confirming', name: 'quote' })
    expect(canConfirmDelete(flow)).toBe(true)
    expect(confirmDelete(flow)).toEqual({ kind: 'deleting', name: 'quote', slides: [], replacement: null })
  })

  test('spec: Given a layout two slides use, When Delete is chosen, Then a layout to move them to must be picked before it can be confirmed', () => {
    const flow = startDelete('title-body', NAMES, [1, 3])
    expect(flow).toEqual({ kind: 'choosing-replacement', name: 'title-body', slides: [1, 3], replacement: null })
    expect(canConfirmDelete(flow)).toBe(false)
    expect(confirmDelete(flow)).toBe(flow)

    const picked = pickReplacement(flow, 'quote', NAMES)
    expect(canConfirmDelete(picked)).toBe(true)
    expect(confirmDelete(picked)).toEqual({ kind: 'deleting', name: 'title-body', slides: [1, 3], replacement: 'quote' })
  })

  test('spec: Given a used layout, Then every other layout is offered to move its slides to, and the layout itself is not', () => {
    expect(replacementChoices(startDelete('title-body', NAMES, [1]), NAMES)).toEqual(['title-slide', 'quote'])
  })

  test('adversarial: Given a used layout, When the layout being deleted (or one the deck lacks) is picked as the replacement, Then nothing changes', () => {
    const flow = startDelete('title-body', NAMES, [1])
    expect(pickReplacement(flow, 'title-body', NAMES)).toBe(flow)
    expect(pickReplacement(flow, 'gone', NAMES)).toBe(flow)
    expect(pickReplacement(flow, '', NAMES)).toBe(flow)
  })

  test('adversarial: Given the deck\'s only layout, or a layout it lacks, When Delete is chosen, Then nothing starts', () => {
    expect(startDelete('only', ['only'], [])).toEqual(DELETE_IDLE)
    expect(startDelete('gone', NAMES, [])).toEqual(DELETE_IDLE)
    expect(startDelete('', [], [])).toEqual(DELETE_IDLE)
  })

  test('spec: Given a delete not yet confirmed, When cancelled, Then nothing is deleted', () => {
    expect(cancelDelete(startDelete('quote', NAMES, []))).toEqual(DELETE_IDLE)
    expect(cancelDelete(pickReplacement(startDelete('title-body', NAMES, [1]), 'quote', NAMES))).toEqual(DELETE_IDLE)
  })

  test('adversarial: Given a delete already running, When cancelled or confirmed again, Then it just keeps running', () => {
    const running = confirmDelete(startDelete('quote', NAMES, []))
    expect(cancelDelete(running)).toBe(running)
    expect(confirmDelete(running)).toBe(running)
  })

  test('adversarial: Given no delete, Then there is nothing to pick, confirm or name', () => {
    expect(pickReplacement(DELETE_IDLE, 'quote', NAMES)).toBe(DELETE_IDLE)
    expect(confirmDelete(DELETE_IDLE)).toBe(DELETE_IDLE)
    expect(replacementChoices(DELETE_IDLE, NAMES)).toEqual([])
    expect(deletingName(DELETE_IDLE)).toBeNull()
    expect(deletingName(startDelete('quote', NAMES, []))).toBe('quote')
  })

  test('adversarial: Given the slides list handed in, When it is changed afterwards, Then the flow keeps its own copy', () => {
    const slides = [1]
    const flow = startDelete('title-body', NAMES, slides)
    slides.push(2)
    expect(flow.kind === 'choosing-replacement' && flow.slides).toEqual([1])
  })
})
