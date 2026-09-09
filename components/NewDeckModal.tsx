'use client'

// Props here are values (`isBusy={isBusy()}`), not signal getters — see
// `components/WelcomeScreen.tsx` for why (BF044). `isOpen` gates rendering
// inside this component (a single sibling condition, not a nested
// ternary — the pattern docs/architecture.md asks for) rather than at the
// call site, so callers don't have to duplicate the `? <NewDeckModal .../> :
// null` wrapper.
export interface NewDeckModalProps {
  isOpen: boolean
  name: string
  parentDir: string | null
  isBusy: boolean
  onNameChange: (name: string) => void
  onCancel: () => void
  onConfirm: () => void
}

export function NewDeckModal(props: NewDeckModalProps) {
  return props.isOpen ? (
    <>
      {/* Closing on a backdrop click/Escape while `create_deck` is still
          in flight would abandon the modal but not the in-flight
          create itself — `decide`'s `creating` state rejects a
          `create-cancelled` it doesn't recognize as an event anyway
          (busy), so this guard is belt-and-suspenders for the UI, not
          load-bearing for correctness. Guarding these the same way as
          the Cancel/Create buttons below keeps all four exits in sync. */}
      <div
        className="fixed top-0 right-0 bottom-0 left-0 z-40 bg-black/40"
        onClick={() => { if (!props.isBusy) props.onCancel() }}
      />
      <div className="fixed top-0 right-0 bottom-0 left-0 z-50 flex items-center justify-center">
        <div className="w-full max-w-sm rounded-lg border border-border bg-popover text-popover-foreground shadow-lg p-4">
          <div className="text-sm font-medium mb-3">New Deck</div>
          <input
            type="text"
            value={props.name}
            onInput={e => props.onNameChange(e.target.value)}
            placeholder="Deck name"
            autofocus
            disabled={props.isBusy}
            className="w-full px-3 py-2 rounded-md border border-border bg-background text-sm outline-none mb-1 disabled:opacity-50"
            onKeyDown={e => {
              if (e.key === 'Enter') props.onConfirm()
              if (e.key === 'Escape' && !props.isBusy) props.onCancel()
            }}
          />
          <div className="text-xs text-muted-foreground mb-3 truncate">{props.parentDir}</div>
          <div className="flex justify-end gap-2">
            <button
              type="button"
              disabled={props.isBusy}
              onClick={() => props.onCancel()}
              className="px-3 py-1.5 rounded-md border border-border text-sm disabled:opacity-50"
            >
              Cancel
            </button>
            <button
              type="button"
              disabled={props.name.trim() === '' || props.isBusy}
              onClick={() => props.onConfirm()}
              className="px-3 py-1.5 rounded-md bg-primary text-primary-foreground text-sm disabled:opacity-50"
            >
              {props.isBusy ? 'Creating…' : 'Create'}
            </button>
          </div>
        </div>
      </div>
    </>
  ) : null
}
