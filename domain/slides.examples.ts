// Given-When-Then examples for editing a section's planned time with the
// minutes/seconds spinners in the slide list's section header (see
// docs/architecture.md's "Examples by Specification"). `slides.test.ts`
// runs every automated example. The manual ones need the real Tauri app.
import { defineExamples } from './spec'
import { type DurationPart, MAX_DURATION_MS } from './slides'

/** What a spinner edit starts from: the section's current planned time. */
export interface SectionTimeState {
  timeMs: number
}

/** One edit to one spinner. `value` is what the `<input type="number">`
 * reports (`valueAsNumber`), so it can be NaN, negative or fractional. */
export interface SectionTimeEdit {
  part: DurationPart
  value: number
}

/** What the section ends up with: the spinners' new values and the time
 * string written into the slide's PageComment. */
export interface SectionTimeResult {
  minutes: number
  seconds: number
  written: string
}

export const sectionTimeExamples = defineExamples<SectionTimeState, SectionTimeEdit, SectionTimeResult>(
  'editing a section time with the minutes/seconds spinners',
  [
    {
      id: 'seconds-step-up',
      given: 'a section planned for 1 minute 30 seconds',
      when: 'the seconds spinner is stepped up to 31',
      then: 'the section is planned for 1 minute 31 seconds',
      state: { timeMs: 90_000 },
      event: { part: 'seconds', value: 31 },
      expect: { minutes: 1, seconds: 31, written: '1m31s' },
    },
    {
      id: 'minutes-typed',
      given: 'a section planned for 1 minute 30 seconds',
      when: '5 is typed into the minutes spinner',
      then: 'the minutes change and the seconds stay: 5 minutes 30 seconds',
      state: { timeMs: 90_000 },
      event: { part: 'minutes', value: 5 },
      expect: { minutes: 5, seconds: 30, written: '5m30s' },
    },
    {
      id: 'seconds-carry',
      given: 'a section planned for 59 seconds',
      when: 'the seconds spinner is stepped up past 59, to 60',
      then: 'the seconds carry into the minutes: 1 minute 0 seconds',
      state: { timeMs: 59_000 },
      event: { part: 'seconds', value: 60 },
      expect: { minutes: 1, seconds: 0, written: '1m' },
      tags: ['boundary'],
    },
    {
      id: 'seconds-typed-past-a-minute',
      given: 'a section planned for 2 minutes',
      when: '75 is typed into the seconds spinner',
      then: 'the extra minute carries over: 3 minutes 15 seconds',
      state: { timeMs: 120_000 },
      event: { part: 'seconds', value: 75 },
      expect: { minutes: 3, seconds: 15, written: '3m15s' },
      tags: ['boundary'],
    },
    {
      id: 'seconds-borrow',
      given: 'a section planned for 2 minutes 0 seconds',
      when: 'the seconds spinner is stepped down below 0, to -1',
      then: 'a minute is borrowed: 1 minute 59 seconds',
      state: { timeMs: 120_000 },
      event: { part: 'seconds', value: -1 },
      expect: { minutes: 1, seconds: 59, written: '1m59s' },
      tags: ['boundary'],
    },
    {
      id: 'floor-at-zero',
      given: 'a section planned for 0 seconds',
      when: 'the seconds spinner is stepped down to -1',
      then: 'the time stays at 0 seconds instead of going negative',
      state: { timeMs: 0 },
      event: { part: 'seconds', value: -1 },
      expect: { minutes: 0, seconds: 0, written: '0s' },
      tags: ['boundary'],
    },
    {
      id: 'negative-minutes',
      given: 'a section planned for 1 minute 30 seconds',
      when: '-5 is typed into the minutes spinner',
      then: 'the time bottoms out at 0 seconds',
      state: { timeMs: 90_000 },
      event: { part: 'minutes', value: -5 },
      expect: { minutes: 0, seconds: 0, written: '0s' },
      tags: ['boundary'],
    },
    {
      id: 'unfinished-entry',
      given: 'a section planned for 1 minute 30 seconds',
      when: 'the minutes spinner is cleared, or holds an unfinished entry like "-" (a number input reads both as NaN)',
      then: 'the time stays 1 minute 30 seconds, so the field isn\'t rewritten while the user is still typing',
      state: { timeMs: 90_000 },
      event: { part: 'minutes', value: Number.NaN },
      expect: { minutes: 1, seconds: 30, written: '1m30s' },
    },
    {
      id: 'minutes-to-zero',
      given: 'a section planned for 1 minute 30 seconds',
      when: '0 is typed into the minutes spinner',
      then: 'the seconds stay: 30 seconds',
      state: { timeMs: 90_000 },
      event: { part: 'minutes', value: 0 },
      expect: { minutes: 0, seconds: 30, written: '30s' },
    },
    {
      id: 'fractional-seconds',
      given: 'a section planned for 0 seconds',
      when: '1.6 is typed into the seconds spinner',
      then: 'it rounds to a whole second, 2 seconds, since peitho times have no sub-second precision',
      state: { timeMs: 0 },
      event: { part: 'seconds', value: 1.6 },
      expect: { minutes: 0, seconds: 2, written: '2s' },
    },
    {
      id: 'huge-minutes',
      given: 'a section planned for 0 seconds',
      when: 'an absurdly large number (1e20) is typed into the minutes spinner',
      then: 'it is capped at the longest time peitho accepts, still written in plain digits',
      state: { timeMs: 0 },
      event: { part: 'minutes', value: 1e20 },
      expect: { minutes: MAX_DURATION_MS / 60_000, seconds: 0, written: `${String(MAX_DURATION_MS / 60_000)}m` },
      tags: ['boundary'],
    },
    {
      id: 'wkwebview-native-spinner-carry',
      given: 'a section planned for 59 seconds, open in the real app',
      when: "the seconds input's native up arrow is clicked",
      then: 'the minutes input shows 1 and the seconds input shows 0',
      state: { timeMs: 59_000 },
      event: { part: 'seconds', value: 60 },
      expect: { minutes: 1, seconds: 0, written: '1m' },
      manual: { reason: "the native spin buttons are drawn by WKWebView; the mocked e2e runs in Chrome and only covers keyboard stepping" },
    },
  ],
)
