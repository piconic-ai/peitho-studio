'use client'

import { createMemo, createSignal } from '@barefootjs/client'
import {
  DEFAULT_STEP_ID,
  TOUR_STEPS,
  findStep,
  isLit,
  nextStepId,
  prevStepId,
  splitSlides,
} from '../domain/tour'

// A schematic of the Studio window (not a screenshot) that reacts to the
// selected step: the pane a step talks about lights up, and the two toggles
// a step demonstrates — the phone viewport and a collapsed section — are
// real controls the visitor can also flip by hand inside the mock.
export function FeatureTour() {
  const [stepId, setStepId] = createSignal(DEFAULT_STEP_ID)
  const [phone, setPhone] = createSignal(false)
  const [collapsed, setCollapsed] = createSignal(false)

  const step = createMemo(() => findStep(stepId()))
  const slides = createMemo(() => splitSlides(collapsed()))

  const select = (id: string) => {
    const next = findStep(id)
    setStepId(next.id)
    setPhone(next.phone)
    setCollapsed(next.collapsed)
  }

  return (
    <div className="tour">
      <ol className="tour-steps" aria-label="Feature tour">
        {/* @client */ TOUR_STEPS.map((s) => (
          <li key={s.id}>
            <button
              type="button"
              className={s.id === stepId() ? 'tour-step is-active' : 'tour-step'}
              aria-pressed={s.id === stepId()}
              data-step={s.id}
              onClick={() => select(s.id)}
            >
              <span className="tour-step-title">{s.title}</span>
            </button>
          </li>
        ))}
      </ol>

      <div className="tour-stage">
        <div className="mock" data-highlight={step().highlight} data-phone={phone()} data-collapsed={collapsed()}>
          <div className={isLit(step().highlight, 'header') ? 'mock-header lit' : 'mock-header'}>
            <span className="mock-title">keynote.md</span>
            <span className="mock-variant">ja ▾</span>
            <span className="mock-spacer" />
            <span className={step().id === 'present' ? 'mock-btn is-busy' : 'mock-btn'}>
              {step().id === 'present' ? 'Presenting…' : 'Present'}
            </span>
          </div>

          <div className="mock-body">
            <div className={isLit(step().highlight, 'list') ? 'mock-list lit' : 'mock-list'}>
              {/* @client */ slides().before.map((s) => (
                <div key={s.key} className="mock-thumb" data-thumb={s.key}>
                  <span className="mock-thumb-title">{s.title}</span>
                  <span className={s.badge ? 'mock-badge' : 'mock-badge hidden'}>{s.badge}</span>
                </div>
              ))}
              <button
                type="button"
                className="mock-section"
                aria-expanded={!collapsed()}
                data-toggle-section
                onClick={() => setCollapsed(!collapsed())}
              >
                <span className="mock-chevron">{collapsed() ? '▸' : '▾'}</span>
                <span>Demo</span>
                <span className="mock-time">12:00</span>
              </button>
              {/* @client */ slides().section.map((s) => (
                <div key={s.key} className="mock-thumb in-section" data-thumb={s.key}>
                  <span className="mock-thumb-title">{s.title}</span>
                  <span className={s.badge ? 'mock-badge' : 'mock-badge hidden'}>{s.badge}</span>
                </div>
              ))}
              {/* @client */ slides().after.map((s) => (
                <div key={s.key} className="mock-thumb" data-thumb={s.key}>
                  <span className="mock-thumb-title">{s.title}</span>
                  <span className={s.badge ? 'mock-badge' : 'mock-badge hidden'}>{s.badge}</span>
                </div>
              ))}
            </div>

            <div className={isLit(step().highlight, 'editor') ? 'mock-editor lit' : 'mock-editor'}>
              <pre className="mock-code">
{`# Why Markdown decks

- one file, any editor
- diff-able, grep-able
- present with \`peitho\`
`}
              </pre>
              <div className="mock-notes">
                <span className="mock-label">Speaker Notes</span>
                <span className="mock-line" />
                <span className="mock-line short" />
              </div>
              <span className={step().id === 'editor' ? 'mock-vim' : 'mock-vim hidden'}>-- NORMAL --</span>
            </div>

            <div className={isLit(step().highlight, 'preview') ? 'mock-preview lit' : 'mock-preview'}>
              <div className="mock-viewport">
                <button type="button" className={phone() ? 'mock-vp' : 'mock-vp is-on'} data-viewport="pc" onClick={() => setPhone(false)}>PC</button>
                <button type="button" className={phone() ? 'mock-vp is-on' : 'mock-vp'} data-viewport="phone" onClick={() => setPhone(true)}>Phone</button>
              </div>
              <div className={phone() ? 'mock-canvas is-phone' : 'mock-canvas'} data-canvas>
                <span className="mock-h1">Why Markdown decks</span>
                <span className="mock-line" />
                <span className="mock-line" />
                <span className="mock-line short" />
              </div>
            </div>
          </div>

          <div className={isLit(step().highlight, 'status') ? 'mock-status lit' : 'mock-status'}>
            <span data-status-text>{step().status || 'Saved'}</span>
            <span className="mock-spacer" />
            <span>slide 2 / 6</span>
          </div>
        </div>

        <div className="tour-caption" aria-live="polite">
          <p data-step-body>{step().body}</p>
          <div className="tour-nav">
            <button type="button" aria-label="Previous" onClick={() => select(prevStepId(stepId()))} data-prev>← prev</button>
            <button type="button" aria-label="Next" onClick={() => select(nextStepId(stepId()))} data-next>next →</button>
          </div>
        </div>
      </div>
    </div>
  )
}
