import { describe, expect, it, vi } from 'vitest'

const run = vi.fn()
vi.mock('@/editor-commands', () => ({
  EDITOR_SECTION: 'Editor & Extensions',
  listEditorCommands: () => [
    {
      id: 'vscode:editor.action.formatDocument',
      title: 'Format Document',
      section: 'Editor & Extensions',
      shortcut: '⇧⌥F',
      run: () => {}
    },
    {
      id: 'vscode:gitlens.showGraph',
      title: 'Show Commit Graph',
      section: 'Editor & Extensions',
      badge: 'GitLens',
      run: () => {}
    },
    { id: 'shell.newTab', title: 'New Tab', section: 'Tabs', run: () => {} }
  ],
  runEditorCommand: (...args: unknown[]) => run(...args)
}))

import { editorCommandsForAgent, handleEditorCommandRequest } from './editor-agent-bridge'

describe('editorCommandsForAgent', () => {
  it('lists editor commands by their VS Code id, never shell commands', () => {
    const out = editorCommandsForAgent()
    expect(out.map((c) => c.id)).toEqual(['editor.action.formatDocument', 'gitlens.showGraph'])
    expect(out[1].source).toBe('GitLens')
    expect(out[0].shortcut).toBe('⇧⌥F')
  })

  it('filters on id or title, case-insensitively', () => {
    expect(editorCommandsForAgent('GRAPH').map((c) => c.id)).toEqual(['gitlens.showGraph'])
    expect(editorCommandsForAgent('formatdoc').map((c) => c.id)).toEqual([
      'editor.action.formatDocument'
    ])
  })
})

describe('handleEditorCommandRequest', () => {
  it('answers a list request', async () => {
    const res = await handleEditorCommandRequest({ id: '1', op: 'list', query: 'git' })
    expect(res.ok).toBe(true)
    expect((res.value as Array<{ id: string }>).map((c) => c.id)).toEqual(['gitlens.showGraph'])
  })

  it('runs a command with its args and returns a JSON-safe value', async () => {
    run.mockResolvedValueOnce({ ok: 1, when: new Date(0) })
    const res = await handleEditorCommandRequest({
      id: '2',
      op: 'run',
      command: 'editor.action.formatDocument',
      args: [{ a: 1 }]
    })
    expect(run).toHaveBeenCalledWith('editor.action.formatDocument', { a: 1 })
    expect(res).toEqual({ ok: true, value: { ok: 1, when: '1970-01-01T00:00:00.000Z' } })
  })

  it('maps undefined results to null so the answer is still JSON', async () => {
    run.mockResolvedValueOnce(undefined)
    const res = await handleEditorCommandRequest({ id: '3', op: 'run', command: 'x' })
    expect(res).toEqual({ ok: true, value: null })
  })

  it('reports a thrown command as an error, not a rejection', async () => {
    run.mockRejectedValueOnce(new Error('command not found'))
    const res = await handleEditorCommandRequest({ id: '4', op: 'run', command: 'nope' })
    expect(res).toEqual({ ok: false, error: 'command not found' })
  })

  it('refuses an empty command id', async () => {
    const res = await handleEditorCommandRequest({ id: '5', op: 'run', command: '  ' })
    expect(res.ok).toBe(false)
    expect(run).not.toHaveBeenCalledWith('  ')
  })
})
