// The feature tour's data and state rules, kept out of the component so the
// invariants (unique ids, every step resolving to a full mock state) run
// under `bun test`. The component only holds the "which step is selected"
// signal and the two hands-on toggles.

export type Pane = 'list' | 'editor' | 'preview' | 'header' | 'status' | 'all'

export interface TourStep {
  id: string
  title: string
  body: string
  /** Which part of the mock lights up while this step is selected. */
  highlight: Pane
  /** Mock state this step demonstrates; the visitor can still toggle it. */
  phone: boolean
  collapsed: boolean
  /** Text the mock's status bar shows, or empty for none. */
  status: string
}

export const TOUR_STEPS: readonly TourStep[] = [
  {
    id: 'three-panes',
    title: 'Three panes around one Markdown file',
    body: 'Slide list, editor and live preview. The deck stays a plain Peitho Markdown file on disk — Studio adds a GUI on top, nothing else.',
    highlight: 'all',
    phone: false,
    collapsed: false,
    status: 'Opened deck ~/talks/keynote',
  },
  {
    id: 'slide-list',
    title: 'Slides you can grab',
    body: 'Thumbnails rendered by the real engine. Drag to reorder, right-click to cut, copy, paste, delete or change layout — with a structure check before a layout swap, so a mismatch is an error you can read instead of a broken slide.',
    highlight: 'list',
    phone: false,
    collapsed: false,
    status: '',
  },
  {
    id: 'sections',
    title: 'Sections with a time budget',
    body: 'Mark a slide as a section start, give the section a name and minutes, collapse it out of the way. Draft and Skip flags show up as badges on the thumbnails.',
    highlight: 'list',
    phone: false,
    collapsed: true,
    status: '',
  },
  {
    id: 'editor',
    title: 'A CodeMirror 6 editor, vim optional',
    body: 'Slide body and speaker notes side by side. Undo and redo are unified across text edits and slide operations, and live in the Edit menu like any native app.',
    highlight: 'editor',
    phone: false,
    collapsed: false,
    status: 'Undone',
  },
  {
    id: 'preview',
    title: 'Preview on a PC or a phone canvas',
    body: 'peitho-core runs in-process, so the preview is exactly what `peitho present` will show. Flip the viewport to a phone shape to check how the deck reads on a small screen.',
    highlight: 'preview',
    phone: true,
    collapsed: false,
    status: '',
  },
  {
    id: 'file-watch',
    title: 'Edit the file elsewhere, too',
    body: 'Studio watches the deck on disk. Save from another editor or let an AI agent rewrite it — the change is merged into what you are looking at, or the deck reloads.',
    highlight: 'status',
    phone: false,
    collapsed: false,
    status: 'Merged external change',
  },
  {
    id: 'present',
    title: 'Present, or rehearse against the plan',
    body: 'One button launches `peitho present`. Rehearsal mode times each section as you go and saves it, so the next run can be compared with the plan.',
    highlight: 'header',
    phone: false,
    collapsed: false,
    status: 'Presenting (rehearsal)…',
  },
]

export const DEFAULT_STEP_ID = TOUR_STEPS[0].id

export function findStep(id: string): TourStep {
  return TOUR_STEPS.find((s) => s.id === id) ?? TOUR_STEPS[0]
}

export function nextStepId(id: string): string {
  const index = TOUR_STEPS.findIndex((s) => s.id === id)
  const safe = index < 0 ? 0 : index
  return TOUR_STEPS[(safe + 1) % TOUR_STEPS.length].id
}

export function prevStepId(id: string): string {
  const index = TOUR_STEPS.findIndex((s) => s.id === id)
  const safe = index < 0 ? 0 : index
  return TOUR_STEPS[(safe - 1 + TOUR_STEPS.length) % TOUR_STEPS.length].id
}

/** Whether the given pane lights up for a step's highlight. */
export function isLit(highlight: Pane, pane: Exclude<Pane, 'all'>): boolean {
  return highlight === 'all' || highlight === pane
}

/** The section's slides in the mock, three of five, shown only when expanded. */
export const MOCK_SLIDES: ReadonlyArray<{ key: string; title: string; badge: '' | 'Draft' | 'Skip'; inSection: boolean }> = [
  { key: 'title', title: 'Peitho Studio', badge: '', inSection: false },
  { key: 'why', title: 'Why Markdown decks', badge: '', inSection: false },
  { key: 'demo-1', title: 'Demo: open a deck', badge: '', inSection: true },
  { key: 'demo-2', title: 'Demo: reorder', badge: 'Draft', inSection: true },
  { key: 'demo-3', title: 'Demo: present', badge: 'Skip', inSection: true },
  { key: 'end', title: 'Thanks', badge: '', inSection: false },
]

export function visibleSlides(collapsed: boolean) {
  return MOCK_SLIDES.filter((s) => !(collapsed && s.inSection))
}

type MockSlide = (typeof MOCK_SLIDES)[number]

/**
 * The slide list as the mock draws it: slides before the section, the
 * section's own slides (hidden while collapsed), slides after it — so the
 * section header sits right above the slides it groups, as in the app.
 */
export function splitSlides(collapsed: boolean): { before: MockSlide[]; section: MockSlide[]; after: MockSlide[] } {
  const first = MOCK_SLIDES.findIndex((s) => s.inSection)
  if (first < 0) return { before: [...MOCK_SLIDES], section: [], after: [] }
  let last = first
  while (last + 1 < MOCK_SLIDES.length && MOCK_SLIDES[last + 1].inSection) last++
  return {
    before: MOCK_SLIDES.slice(0, first),
    section: collapsed ? [] : MOCK_SLIDES.slice(first, last + 1),
    after: MOCK_SLIDES.slice(last + 1),
  }
}
