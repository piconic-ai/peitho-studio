'use client'
import { createSignal, createEffect, createMemo } from '@barefootjs/client'

const GROUPS = ['ratio', 'lang']
const CHOICES: Record<string, string[]> = { ratio: ['wide', 'square'], lang: ['en', 'ja'] }

export function NestedMaps() {
  const [open] = createSignal(true)
  const [selected, setSelected] = createSignal<Record<string, string>>({ ratio: 'wide', lang: 'en' })
  return <section>{open() ? <div>{GROUPS.map(group => <div key={group}>
    {CHOICES[group].map(choice => <button key={choice} data-choice={choice}
      aria-checked={selected()[group] === choice ? 'true' : 'false'}
      onClick={() => setSelected({ ...selected(), [group]: choice })}>{selected()[group] === choice ? 'yes' : 'no'}</button>)}
  </div>)}</div> : null}</section>
}

export function Propagation() {
  const [parent, setParent] = createSignal(0)
  const [child, setChild] = createSignal(0)
  const [rows] = createSignal(['row'])
  return <section><output>{parent() + ',' + child()}</output>
    <div onClick={() => setParent(parent() + 1)}>{rows().map(row => <button key={row}
      onClick={e => { e.stopPropagation(); setChild(child() + 1) }}>child</button>)}</div>
  </section>
}

export function KeyedRef() {
  const [rows, setRows] = createSignal([{ id: 'row', shown: true }])
  return <section><button onClick={() => setRows(rows().map(row => ({ ...row, shown: !row.shown })))}>toggle</button>
    {rows().map(row => <div key={row.id}>{row.shown ? <input ref={/* @client */ el => el.setAttribute('data-mounted', 'yes')} /> : <span>off</span>}</div>)}
  </section>
}

export function LateRef() {
  const [rows, setRows] = createSignal([{ id: 'row', editing: false }])
  return <section><button onClick={() => setRows(rows().map(row => ({ ...row, editing: !row.editing })))}>toggle</button>
    {rows().map(row => <div key={row.id}>{row.editing ? <input ref={el => el.focus()} /> : <span>off</span>}</div>)}
  </section>
}

export function BranchEffect() {
  const [open, setOpen] = createSignal(true)
  const [tick, setTick] = createSignal(0)
  return <section><button onClick={() => setOpen(!open())}>toggle</button><button onClick={() => setTick(tick() + 1)}>tick</button>
    {open() ? <div ref={el => createEffect(() => { el.textContent = String(tick()); document.body.dataset.runs = String(Number(document.body.dataset.runs || 0) + 1) })} /> : null}
  </section>
}

export function DelayedBranch() {
  const [error, setError] = createSignal<string | null>(null)
  return <section><button onClick={() => setTimeout(() => setError('failure'), 0)}>fail</button>
    {error() ? <p>{error()}</p> : null}
  </section>
}

export function NestedBranch() {
  const [open, setOpen] = createSignal(false)
  const [ready, setReady] = createSignal(false)
  return <section><button onClick={() => { setOpen(true); setTimeout(() => setReady(true), 0) }}>open</button>
    {open() ? <div>{ready() ? <p>ready</p> : <p>loading</p>}</div> : null}
  </section>
}

export function SendingLabel(props: { sending: boolean }) {
  return <p>{props.sending ? 'sending' : 'send'}</p>
}

export function BranchChildText() {
  const [open, setOpen] = createSignal(false)
  const [sending, setSending] = createSignal(false)
  return <section><button onClick={() => setOpen(true)}>open</button><button onClick={() => setSending(!sending())}>toggle</button>
    {open() ? <div><SendingLabel sending={sending()} /><span>entered</span></div> : null}
  </section>
}

function createStore() {
  const [count, setCount] = createSignal(0)
  return { count, setCount }
}

export function DestructuredStore() {
  const { count, setCount } = createStore()
  return <button onClick={() => setCount(count() + 1)}>{count()}</button>
}

export function KeyedIndex() {
  const [rows, setRows] = createSignal(['a', 'b'])
  return <section><button onClick={() => setRows([...rows()].reverse())}>reverse</button>
    {rows().map((row, index) => <p key={row}>{row + ':' + index}</p>)}
  </section>
}

export function NativeConstChild(props: { busy: boolean; ready: boolean }) {
  const disabled = createMemo(() => !props.ready || props.busy)
  return <button disabled={disabled()}>action</button>
}

export function NativeConst() {
  const [busy, setBusy] = createSignal(false)
  return <section><button onClick={() => setBusy(!busy())}>toggle</button><NativeConstChild busy={busy()} ready={true} /></section>
}

export function BlockMap() {
  const [rows] = createSignal(['a', 'b'])
  return <section>{rows().map(row => {
    const label = row.toUpperCase()
    return <p key={row}>{label}</p>
  })}</section>
}

function newToken() { return { value: 1 } }

export function IdentityChild(props: { token: { value: number } }) {
  return <output>{props.token === props.token ? 'same' : 'different'}</output>
}

export function ObjectIdentity() {
  const token = newToken()
  return <section><IdentityChild token={token} /></section>
}

export function GetterChild(props: { value: () => number }) {
  return <output>{props.value()}</output>
}

export function GetterProp() {
  const [value, setValue] = createSignal(0)
  return <section><button onClick={() => setValue(value() + 1)}>increment</button><GetterChild value={value} /></section>
}

export function StableIdentityChild(props: { token: () => { value: number } }) {
  return <output>{props.token() === props.token() ? 'same' : 'different'}</output>
}

export function StableObjectIdentity() {
  const token = newToken()
  function getToken() { return token }
  return <section><StableIdentityChild token={getToken} /></section>
}

export function ComposedConstChild(props: { busy: boolean; ready: boolean }) {
  const disabled = !props.ready || props.busy
  return <button disabled={disabled}>action</button>
}

export function ComposedConst() {
  const [busy, setBusy] = createSignal(false)
  return <section><button onClick={() => setBusy(!busy())}>toggle</button><ComposedConstChild busy={busy()} ready={true} /></section>
}
