import { describe, expect, test } from 'bun:test'
import {
  DEFAULT_STEP_ID,
  MOCK_SLIDES,
  TOUR_STEPS,
  findStep,
  isLit,
  nextStepId,
  prevStepId,
  splitSlides,
  visibleSlides,
} from './tour'

describe('TOUR_STEPS', () => {
  test('ids are unique, non-empty and URL-safe', () => {
    const ids = TOUR_STEPS.map((s) => s.id)
    expect(new Set(ids).size).toBe(ids.length)
    for (const id of ids) expect(id).toMatch(/^[a-z][a-z0-9-]*$/)
  })
  test('every step has a title and a body', () => {
    for (const step of TOUR_STEPS) {
      expect(step.title.length).toBeGreaterThan(0)
      expect(step.body.length).toBeGreaterThan(0)
    }
  })
  test('the default step is the first one', () => {
    expect(DEFAULT_STEP_ID).toBe(TOUR_STEPS[0].id)
  })
})

describe('findStep', () => {
  test('resolves a known id', () => {
    expect(findStep('preview').id).toBe('preview')
  })
  test('falls back to the first step for an unknown or empty id', () => {
    expect(findStep('nope').id).toBe(TOUR_STEPS[0].id)
    expect(findStep('').id).toBe(TOUR_STEPS[0].id)
  })
})

describe('nextStepId / prevStepId', () => {
  test('walk forward and wrap around', () => {
    let id = TOUR_STEPS[0].id
    for (let i = 0; i < TOUR_STEPS.length; i++) id = nextStepId(id)
    expect(id).toBe(TOUR_STEPS[0].id)
  })
  test('prev of the first is the last', () => {
    expect(prevStepId(TOUR_STEPS[0].id)).toBe(TOUR_STEPS[TOUR_STEPS.length - 1].id)
  })
  test('prev then next is the identity', () => {
    for (const step of TOUR_STEPS) expect(nextStepId(prevStepId(step.id))).toBe(step.id)
  })
  test('an unknown id is treated as the first step', () => {
    expect(nextStepId('nope')).toBe(TOUR_STEPS[1].id)
    expect(prevStepId('nope')).toBe(TOUR_STEPS[TOUR_STEPS.length - 1].id)
  })
})

describe('isLit', () => {
  test('"all" lights every pane; a specific highlight lights only itself', () => {
    expect(isLit('all', 'list')).toBe(true)
    expect(isLit('all', 'status')).toBe(true)
    expect(isLit('editor', 'editor')).toBe(true)
    expect(isLit('editor', 'preview')).toBe(false)
  })
})

describe('visibleSlides', () => {
  test('expanded shows every mock slide, collapsed hides the section', () => {
    expect(visibleSlides(false)).toHaveLength(MOCK_SLIDES.length)
    const collapsed = visibleSlides(true)
    expect(collapsed.every((s) => !s.inSection)).toBe(true)
    expect(collapsed.length).toBeLessThan(MOCK_SLIDES.length)
  })
  test('mock slide keys are unique (they are `.map()` keys)', () => {
    const keys = MOCK_SLIDES.map((s) => s.key)
    expect(new Set(keys).size).toBe(keys.length)
  })
})

describe('splitSlides', () => {
  test('before + section + after is the whole list, in order, when expanded', () => {
    const { before, section, after } = splitSlides(false)
    expect([...before, ...section, ...after]).toEqual([...MOCK_SLIDES])
    expect(section.every((s) => s.inSection)).toBe(true)
    expect([...before, ...after].every((s) => !s.inSection)).toBe(true)
  })
  test('collapsed hides only the section, keeping the slides around it', () => {
    const open = splitSlides(false)
    const closed = splitSlides(true)
    expect(closed.section).toEqual([])
    expect(closed.before).toEqual(open.before)
    expect(closed.after).toEqual(open.after)
  })
  test('the section is contiguous in the mock data (the split assumes it)', () => {
    const flags = MOCK_SLIDES.map((s) => s.inSection).join('')
    expect(flags).toMatch(/^(false)*(true)*(false)*$/)
  })
})
