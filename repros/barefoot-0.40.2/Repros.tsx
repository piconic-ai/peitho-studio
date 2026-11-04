'use client'

import { createSignal } from '@barefootjs/client'

export function Fragment() {
  const [shown] = createSignal(true)
  const [busy, setBusy] = createSignal(false)
  return <>
    <button data-toggle onClick={() => setBusy(!busy())}>{busy() ? 'busy' : 'idle'}</button>
    {shown() ? <button data-action disabled={busy()} hidden={busy()}>action</button> : null}
  </>
}

export function Element() {
  const [shown] = createSignal(true)
  const [busy, setBusy] = createSignal(false)
  return <section>
    <button data-toggle onClick={() => setBusy(!busy())}>{busy() ? 'busy' : 'idle'}</button>
    {shown() ? <button data-action disabled={busy()} hidden={busy()}>action</button> : null}
  </section>
}

export function Hidden() {
  const [shown] = createSignal(true)
  const [busy, setBusy] = createSignal(false)
  return <>
    <button data-toggle onClick={() => setBusy(!busy())}>{busy() ? 'busy' : 'idle'}</button>
    <button data-action disabled={busy()} hidden={!shown() || busy()}>action</button>
  </>
}

export function Child(props: { token: { n: number } }) {
  return <output>{props.token === props.token ? 'same' : 'different'}</output>
}

export function ObjectIdentity() {
  const token = { n: 1 }
  return <main><Child token={token} /></main>
}

export function StableChild(props: { token: () => { n: number } }) {
  return <output>{props.token() === props.token() ? 'same' : 'different'}</output>
}

export function StableIdentity() {
  const token = { n: 1 }
  function getToken() { return token }
  return <main><StableChild token={getToken} /></main>
}
