import { describe, expect, test } from 'bun:test'
import type { CritReviewEvent, NewReviewComment } from './critIpc'
import { createFakeCritIpc } from './fakeCritIpc'

const comment = (overrides: Partial<NewReviewComment> = {}): NewReviewComment => ({
  startLine: 5, endLine: 5, body: 'Make it bigger', quote: '# Hello', author: 'Peitho Studio', ...overrides,
})

describe('createFakeCritIpc', () => {
  test('Given an agent waiting, When Studio adds a comment, Then the session holds it with its lines and quote', async () => {
    const ipc = createFakeCritIpc()
    expect((await ipc.sessionStatus()).kind).toBe('found')
    const comments = await ipc.addComments([comment()])
    expect(comments).toEqual([{
      id: 'c_1', lines: { start: 5, end: 5 }, body: 'Make it bigger', quote: '# Hello', author: 'Peitho Studio', resolved: false, replies: [],
    }])
    expect(ipc.calls.map(call => call.method)).toEqual(['sessionStatus', 'addComments'])
  })

  test('Given comments were sent, When Studio finishes and the agent replies, Then Studio hears both and reads the reply under the comment', async () => {
    const ipc = createFakeCritIpc()
    const heard: CritReviewEvent[] = []
    ipc.onReviewEvent(event => { heard.push(event) })
    const [sent] = await ipc.addComments([comment()])
    await ipc.finish()
    ipc.reply(sent.id, 'Made it bigger')
    expect(heard).toEqual(['finished', 'commentsChanged'])
    expect((await ipc.listComments())[0].replies).toEqual([{ id: 'rp_2', body: 'Made it bigger', author: 'Agent' }])
  })

  test('Given no agent is waiting, When Studio tries to send, Then every call that needs the session rejects', async () => {
    const ipc = createFakeCritIpc({ session: { kind: 'none' } })
    expect(await ipc.sessionStatus()).toEqual({ kind: 'none' })
    expect(ipc.addComments([comment()])).rejects.toThrow()
    expect(ipc.finish()).rejects.toThrow()
    expect(ipc.listComments()).rejects.toThrow()
  })

  test('Given one malformed comment among good ones, When they are added, Then none is sent', async () => {
    const ipc = createFakeCritIpc()
    expect(ipc.addComments([comment(), comment({ body: '  ' })])).rejects.toThrow()
    expect(ipc.addComments([comment({ startLine: 0 })])).rejects.toThrow()
    expect(ipc.addComments([comment({ startLine: 3, endLine: 2 })])).rejects.toThrow()
    expect(await ipc.listComments()).toEqual([])
  })

  test('Given a listener unsubscribed, When an event is emitted, Then it is not called', () => {
    const ipc = createFakeCritIpc()
    const heard: CritReviewEvent[] = []
    const stop = ipc.onReviewEvent(event => { heard.push(event) })
    stop()
    ipc.emitReviewEvent('ended')
    expect(heard).toEqual([])
  })

  test('Given a comment list was returned, When the caller mutates it, Then the session is unaffected', async () => {
    const ipc = createFakeCritIpc()
    const list = await ipc.addComments([comment()])
    list[0].body = 'changed'
    expect((await ipc.listComments())[0].body).toBe('Make it bigger')
  })
})
