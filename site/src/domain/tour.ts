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
    title: 'Three panes',
    body: 'Slides, editor, preview. Around one Markdown file.',
    highlight: 'all',
    phone: false,
    collapsed: false,
    status: 'Opened deck ~/talks/keynote',
  },
  {
    id: 'slide-list',
    title: 'Slides',
    body: 'Drag to reorder. Right-click to cut, paste, or change layout.',
    highlight: 'list',
    phone: false,
    collapsed: false,
    status: '',
  },
  {
    id: 'sections',
    title: 'Sections',
    body: 'Name it, give it minutes, collapse it. Draft and Skip show as badges.',
    highlight: 'list',
    phone: false,
    collapsed: true,
    status: '',
  },
  {
    id: 'editor',
    title: 'Editor',
    body: 'CodeMirror 6, vim optional. Undo works across text and slides.',
    highlight: 'editor',
    phone: false,
    collapsed: false,
    status: 'Undone',
  },
  {
    id: 'preview',
    title: 'Preview',
    body: 'Rendered by peitho-core itself. Flip it to a phone.',
    highlight: 'preview',
    phone: true,
    collapsed: false,
    status: '',
  },
  {
    id: 'file-watch',
    title: 'File watch',
    body: 'Save from any other editor. Studio merges it in.',
    highlight: 'status',
    phone: false,
    collapsed: false,
    status: 'Merged external change',
  },
  {
    id: 'present',
    title: 'Present',
    body: 'One button runs `peitho present`. Rehearsal mode times each section.',
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
