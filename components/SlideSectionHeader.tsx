'use client'

import { type SectionDraft } from '../domain/render'
import { type DurationPart, formatDurationMs, msToMinutesSeconds } from '../domain/slides'
import { type Language } from '../domain/language'
import { messagesFor } from '../domain/messages'
import { isFocusMovingWithinSectionHeader, showCanonicalValue } from '../dom/sectionHeader'

interface SlideSectionHeaderProps {
  language: Language
  index: number
  collapsed: boolean
  editing: boolean
  draft: SectionDraft
  onToggleSectionCollapse: (index: number) => void
  onEditSection: (index: number) => void
  onSectionNameInput: (index: number, value: string) => void
  onSectionTimeInput: (index: number, part: DurationPart, value: number) => void
  onCommitSectionEdit: (index: number) => void
}

export function SlideSectionHeader(props: SlideSectionHeaderProps) {
  return (
    <div className="flex items-center gap-2 pt-3 pb-1">
      {/* Folds the section's slides away (or back) — separate
          from the summary button beside it, which opens the
          header's name/time editor instead. One SVG chevron
          rotated for the collapsed state, not the ▾/▸ text
          glyphs: those two differ in size and baseline from
          font to font, so the icon visibly jumped on toggle.
          `w-4` matches the slide rows' number column so the
          chevron and the header text line up with it. */}
      <button
        type="button"
        aria-label={props.collapsed ? messagesFor(props.language).expandSection : messagesFor(props.language).collapseSection}
        aria-expanded={props.collapsed ? 'false' : 'true'}
        onClick={() => props.onToggleSectionCollapse(props.index)}
        className="shrink-0 w-4 h-4 flex items-center justify-center text-muted-foreground hover:text-foreground"
      >
        <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" className={props.collapsed ? 'block w-3 h-3 -rotate-90' : 'block w-3 h-3'}>
          <path d="m6 9 6 6 6-6" />
        </svg>
      </button>
      <div className="min-w-0 flex-1">
        {props.editing ? (
          // The time is edited with two number spinners instead of
          // free text in peitho's `1m30s` format, so no input can
          // produce a time peitho rejects (see `domain/slides.ts`'s
          // `withDurationPart`). The header saves — and collapses
          // back to its plain summary below — once focus leaves
          // it, not on each input's own blur (see
          // `isFocusMovingWithinSectionHeader`).
          <div data-section-header="" className="flex items-center gap-1">
            <input
              aria-label={messagesFor(props.language).sectionName}
              // Studio.tsx focuses this field when section editing opens.
              value={props.draft.name}
              onInput={e => props.onSectionNameInput(props.index, e.target.value)}
              onBlur={e => { if (!isFocusMovingWithinSectionHeader(e)) props.onCommitSectionEdit(props.index) }}
              onKeyDown={e => { if (e.key === 'Enter') e.target.blur() }}
              className="min-w-0 flex-1 bg-transparent outline-none text-xs font-semibold text-foreground/80"
            />
            <input
              type="number"
              min="0"
              step="1"
              aria-label={messagesFor(props.language).sectionMinutes}
              value={String(msToMinutesSeconds(props.draft.timeMs).minutes)}
              onInput={e => props.onSectionTimeInput(props.index, 'minutes', e.target.valueAsNumber)}
              onChange={e => showCanonicalValue(e.target, String(msToMinutesSeconds(props.draft.timeMs).minutes))}
              onBlur={e => { if (!isFocusMovingWithinSectionHeader(e)) props.onCommitSectionEdit(props.index) }}
              onKeyDown={e => { if (e.key === 'Enter') e.target.blur() }}
              className="w-10 shrink-0 bg-transparent outline-none text-xs text-muted-foreground text-right"
            />
            <span className="shrink-0 text-xs text-muted-foreground">{messagesFor(props.language).minutesUnit}</span>
            {/* No `min`/`max` on the seconds spinner, so its arrows
                step past 59 and below 0 and carry into or borrow
                from the minutes. */}
            <input
              type="number"
              step="1"
              aria-label={messagesFor(props.language).sectionSeconds}
              value={String(msToMinutesSeconds(props.draft.timeMs).seconds)}
              onInput={e => props.onSectionTimeInput(props.index, 'seconds', e.target.valueAsNumber)}
              onChange={e => showCanonicalValue(e.target, String(msToMinutesSeconds(props.draft.timeMs).seconds))}
              onBlur={e => { if (!isFocusMovingWithinSectionHeader(e)) props.onCommitSectionEdit(props.index) }}
              onKeyDown={e => { if (e.key === 'Enter') e.target.blur() }}
              className="w-10 shrink-0 bg-transparent outline-none text-xs text-muted-foreground text-right"
            />
            <span className="shrink-0 text-xs text-muted-foreground">{messagesFor(props.language).secondsUnit}</span>
          </div>
        ) : (
          // Collapsed by default: the native spinner arrows
          // permanently sitting in an otherwise plain list read as
          // an unstyled form, not a slide list, so they only
          // appear once someone actually asks to edit this header.
          <button
            type="button"
            aria-label={messagesFor(props.language).editSection}
            onClick={() => props.onEditSection(props.index)}
            className="w-full flex items-center gap-1 text-left"
          >
            <span className="min-w-0 flex-1 truncate text-xs font-semibold text-foreground/80">
              {props.draft.name}
            </span>
            <span className="shrink-0 text-xs text-muted-foreground">
              {formatDurationMs(props.draft.timeMs)}
            </span>
          </button>
        )}
      </div>
    </div>
  )
}
