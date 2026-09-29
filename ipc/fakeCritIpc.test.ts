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
      id: 'c_1', lines: { start: 5, end: 5 }, body: 'Make it bigger', quote: '# Hello', author: 'Peitho Studio', resolved: false, replies: [], createdAt: expect.any(String),
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
    expect((await ipc.listComments())[0].replies).toEqual([{ id: 'rp_2', body: 'Made it bigger', author: 'Agent', createdAt: expect.any(String) }])
  })

  test('Given no session, When Studio tries to send, Then every call that needs the session rejects', async () => {
    const ipc = createFakeCritIpc({ session: 'none' })
    expect(await ipc.sessionStatus()).toEqual({ kind: 'none' })
    expect(ipc.addComments([comment()])).rejects.toThrow()
    expect(ipc.addReplies([{ commentId: 'c_1', body: 'b', author: 'a' }])).rejects.toThrow()
    expect(ipc.resolveComment('c_1')).rejects.toThrow()
    expect(ipc.finish()).rejects.toThrow()
    expect(ipc.listComments()).rejects.toThrow()
    expect(() => ipc.agentConnects()).toThrow()
  })

  test('Given no session, When Studio starts one, Then it is found with no agent waiting until one connects', async () => {
    const ipc = createFakeCritIpc({ session: 'none' })
    const heard: CritReviewEvent[] = []
    ipc.onReviewEvent(event => { heard.push(event) })
    expect(await ipc.startSession()).toMatchObject({ kind: 'found', agentWaiting: false, reviewRound: 1 })
    ipc.agentConnects()
    expect(await ipc.sessionStatus()).toMatchObject({ kind: 'found', agentWaiting: true, reviewRound: 2 })
    expect(heard).toEqual(['commentsChanged'])
  })

  test('Given a session already there, When Studio starts one, Then the same session is kept', async () => {
    const ipc = createFakeCritIpc()
    expect(await ipc.startSession()).toMatchObject({ kind: 'found', agentWaiting: true })
  })

  test('Given an agent waiting, When Studio finishes the round, Then no agent waits until it connects again', async () => {
    const ipc = createFakeCritIpc()
    await ipc.finish()
    expect(await ipc.sessionStatus()).toMatchObject({ agentWaiting: false })
    ipc.agentConnects()
    expect(await ipc.sessionStatus()).toMatchObject({ agentWaiting: true })
  })

  test('Given a comment, When Studio replies under it and resolves it, Then the thread has the reply and is resolved', async () => {
    const ipc = createFakeCritIpc()
    const [sent] = await ipc.addComments([comment()])
    const replied = await ipc.addReplies([{ commentId: sent.id, body: 'Still small', author: 'Peitho Studio' }])
    expect(replied[0].replies).toEqual([{ id: 'rp_2', body: 'Still small', author: 'Peitho Studio', createdAt: expect.any(String) }])
    expect((await ipc.resolveComment(sent.id))[0].resolved).toBe(true)
  })

  test('Given a reply to a missing comment or a blank one, When replies are added, Then none is sent', async () => {
    const ipc = createFakeCritIpc()
    const [sent] = await ipc.addComments([comment()])
    expect(ipc.addReplies([{ commentId: sent.id, body: 'ok', author: 'a' }, { commentId: 'c_missing', body: 'x', author: 'a' }])).rejects.toThrow()
    expect(ipc.addReplies([{ commentId: sent.id, body: ' ', author: 'a' }])).rejects.toThrow()
    expect(ipc.resolveComment('c_missing')).rejects.toThrow()
    expect((await ipc.listComments())[0].replies).toEqual([])
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
