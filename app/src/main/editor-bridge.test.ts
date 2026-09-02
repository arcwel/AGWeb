import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  NO_EDITOR_ERROR,
  abortPendingEditorCommands,
  pendingEditorCommandCount,
  requestEditorCommand,
  respondEditorCommand,
  setEditorCommandSink
} from './editor-bridge'
import type { EditorCommandRequest } from '../shared/ipc'

afterEach(() => {
  setEditorCommandSink(null)
  vi.useRealTimers()
})

describe('requestEditorCommand', () => {
  it('fails closed with no shell attached', async () => {
    // Arrange: no sink set
    // Act
    const res = await requestEditorCommand({ op: 'run', command: 'x' })
    // Assert
    expect(res).toEqual({ ok: false, error: NO_EDITOR_ERROR })
    expect(pendingEditorCommandCount()).toBe(0)
  })

  it('resolves with the shell answer for the matching id', async () => {
    const sent: EditorCommandRequest[] = []
    setEditorCommandSink((req) => {
      sent.push(req)
      return true
    })

    const promise = requestEditorCommand({ op: 'run', command: 'editor.action.formatDocument' })
    expect(sent).toHaveLength(1)
    expect(sent[0].command).toBe('editor.action.formatDocument')

    respondEditorCommand('not-this-one', { ok: true, value: 'wrong' })
    respondEditorCommand(sent[0].id, { ok: true, value: { formatted: true } })

    await expect(promise).resolves.toEqual({
      ok: true,
      value: { formatted: true },
      error: undefined
    })
    expect(pendingEditorCommandCount()).toBe(0)
  })

  it('reports an undelivered request instead of waiting', async () => {
    setEditorCommandSink(() => false)
    const res = await requestEditorCommand({ op: 'list' })
    expect(res.ok).toBe(false)
    expect(res.error).toBe(NO_EDITOR_ERROR)
    expect(pendingEditorCommandCount()).toBe(0)
  })

  it('times out when the shell never answers', async () => {
    vi.useFakeTimers()
    setEditorCommandSink(() => true)
    const promise = requestEditorCommand({ op: 'run', command: 'slow' }, 1000)
    await vi.advanceTimersByTimeAsync(1001)
    const res = await promise
    expect(res.ok).toBe(false)
    expect(res.error).toMatch(/did not answer within 1s/)
    expect(pendingEditorCommandCount()).toBe(0)
  })

  it('aborts everything pending when the shell goes away', async () => {
    setEditorCommandSink(() => true)
    const a = requestEditorCommand({ op: 'run', command: 'a' })
    const b = requestEditorCommand({ op: 'list' })
    expect(pendingEditorCommandCount()).toBe(2)
    abortPendingEditorCommands()
    for (const res of await Promise.all([a, b])) {
      expect(res.ok).toBe(false)
      expect(res.error).toMatch(/went away/)
    }
  })

  it('normalises a malformed answer to a failure rather than trusting it', async () => {
    setEditorCommandSink((req) => {
      queueMicrotask(() =>
        respondEditorCommand(req.id, {
          ok: 'yes' as unknown as boolean,
          error: 42 as unknown as string
        })
      )
      return true
    })
    const res = await requestEditorCommand({ op: 'run', command: 'x' })
    expect(res.ok).toBe(false)
    expect(res.error).toBeUndefined()
  })
})
