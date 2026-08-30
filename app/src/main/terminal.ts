import { coreEnv } from '../core/env'
import { spawn } from 'node:child_process'
import type { ChildProcess } from 'node:child_process'
import { createRequire } from 'node:module'
import { createInterface } from 'node:readline'
import { join } from 'node:path'
import { IpcEvents } from '@shared/ipc'
import { broadcast } from './windows'
import { getCurrentWorkspace } from './workspace'
import { IpcChannels } from '@shared/ipc'
import { core } from '../core/rpc'
import { asString, asNumber } from '../core/coerce'

/**
 * Terminal sessions live in the main process so they survive deck hide/reveal,
 * window moves, and detach. Preferred backend: node-pty in-process (packaged
 * builds run electron-rebuild). Fallback: a pty host child process under the
 * system Node, for dev setups where node-pty isn't built for Electron's ABI.
 */

const BUFFER_LIMIT = 200_000

type PtyLike = {
  write(data: string): void
  resize(cols: number, rows: number): void
  kill(): void
}

interface Session {
  backend: 'native' | 'child'
  proc?: PtyLike
  buffer: string
  running: boolean
  /** Set on exit; command-backed sessions resolve their caller with it. */
  exitCode?: number
}

const sessions = new Map<string, Session>()
const nodeRequire = createRequire(__filename)

type NodePtyModule = typeof import('node-pty')

let nativePty: NodePtyModule | null | undefined
function getNativePty(): NodePtyModule | null {
  if (nativePty !== undefined) return nativePty
  try {
    nativePty = nodeRequire('node-pty') as NodePtyModule
  } catch {
    nativePty = null
    console.warn('node-pty not loadable in Electron; using system-node pty host')
  }
  return nativePty
}

/* ---- Child pty-host fallback ---- */

let host: ChildProcess | null = null
function getHost(): ChildProcess | null {
  if (host && host.exitCode === null) return host
  try {
    const hostScript = join(coreEnv().appDir, 'resources', 'pty-host.cjs')
    const ptyModule = nodeRequire.resolve('node-pty')
    host = spawn(process.env.AGWEB_NODE ?? 'node', [hostScript, ptyModule], {
      stdio: ['pipe', 'pipe', 'inherit']
    })
    const hostDied = (): void => {
      for (const [id, session] of sessions) {
        if (session.backend === 'child' && session.running) endSession(id, -1)
      }
      host = null
    }
    host.on('exit', hostDied)
    // Without this, a missing `node` binary raises an unhandled 'error'
    // event and takes down the whole main process.
    host.on('error', (error) => {
      console.warn('pty host failed to start:', error)
      hostDied()
    })
    createInterface({ input: host.stdout! }).on('line', (line) => {
      let msg: { ev: string; id: string; data?: string; code?: number }
      try {
        msg = JSON.parse(line)
      } catch {
        return
      }
      if (msg.ev === 'data' && typeof msg.data === 'string') pushData(msg.id, msg.data)
      else if (msg.ev === 'exit') endSession(msg.id, msg.code ?? 0)
    })
    return host
  } catch {
    host = null
    return null
  }
}

const hostSend = (msg: object): void => {
  getHost()?.stdin?.write(JSON.stringify(msg) + '\n')
}

/* ---- Session plumbing ---- */

function pushData(id: string, data: string): void {
  const session = sessions.get(id)
  if (!session) return
  session.buffer = (session.buffer + data).slice(-BUFFER_LIMIT)
  broadcast(IpcEvents.termData, { id, data }, null)
}

function endSession(id: string, code: number): void {
  const session = sessions.get(id)
  if (!session) return
  session.running = false
  session.exitCode = code
  session.proc = undefined
  broadcast(IpcEvents.termExit, { id, code }, null)
}

export function createTerminal(
  id: string,
  cols: number,
  rows: number,
  options: { command?: string; cwd?: string } = {}
): void {
  if (sessions.get(id)?.running) return
  const cwd = options.cwd ?? getCurrentWorkspace()?.path ?? coreEnv().homeDir
  const shell = process.env.SHELL || 'bash'
  // A command-backed session runs that command in a login shell and exits with
  // its real status, so the agent gets a true exit code while the user watches
  // the output scroll in an ordinary Terminal block.
  const args = options.command ? ['-lc', options.command] : []

  const native = getNativePty()
  if (native) {
    const proc = native.spawn(shell, args, {
      name: 'xterm-256color',
      cols,
      rows,
      cwd,
      env: process.env as Record<string, string>
    })
    sessions.set(id, { backend: 'native', proc, buffer: '', running: true })
    proc.onData((data) => pushData(id, data))
    proc.onExit(({ exitCode }) => endSession(id, exitCode))
    return
  }

  if (!getHost()) {
    // No native pty and no system node to host one: surface a dead session
    // instead of a silently blank terminal marked running.
    sessions.set(id, { backend: 'child', buffer: '', running: false })
    broadcast(
      IpcEvents.termData,
      {
        id,
        data: '\r\n[terminal unavailable: node-pty is not built for Electron and no `node` binary was found]\r\n'
      },
      null
    )
    broadcast(IpcEvents.termExit, { id, code: -1 }, null)
    return
  }
  sessions.set(id, { backend: 'child', buffer: '', running: true })
  hostSend({ op: 'create', id, cols, rows, cwd, shell, args })
}

/* ---- Agent-driven commands (Phase 3B.2/3B.3) ---- */

let nextAgentTerminal = 1

/**
 * Run a command in a real pty the user can watch, and resolve when it exits.
 *
 * No timeout is imposed here: a dev server, watcher or REPL is a legitimate
 * agent command. The caller decides when to stop it, and the model's own
 * context is the only limit on what comes back.
 */
export function runInTerminal(
  command: string,
  cwd: string,
  onAdopt: (sessionId: string) => void
): { sessionId: string; done: Promise<{ code: number; output: string }> } {
  const sessionId = `agent-term-${nextAgentTerminal++}`
  createTerminal(sessionId, 120, 30, { command, cwd })
  onAdopt(sessionId)

  const done = new Promise<{ code: number; output: string }>((resolve) => {
    const settle = (): void => {
      const session = sessions.get(sessionId)
      if (!session || session.running) return
      clearInterval(poll)
      resolve({ code: session.exitCode ?? 0, output: session.buffer })
    }
    // Both backends report exit through endSession; poll the session rather
    // than duplicating the native/host event wiring.
    const poll = setInterval(settle, 120)
    settle()
  })
  return { sessionId, done }
}

/** Stop a running agent command (or any session) without disposing scrollback. */
export function stopTerminal(id: string): boolean {
  const session = sessions.get(id)
  if (!session?.running) return false
  if (session.backend === 'native') session.proc?.kill()
  else hostSend({ op: 'dispose', id })
  return true
}

export function terminalOutput(id: string): string {
  return sessions.get(id)?.buffer ?? ''
}

export function isTerminalRunning(id: string): boolean {
  return sessions.get(id)?.running === true
}

export function writeTerminal(id: string, data: string): void {
  const session = sessions.get(id)
  if (!session?.running) return
  if (session.backend === 'native') session.proc?.write(data)
  else hostSend({ op: 'input', id, data })
}

export function resizeTerminal(id: string, cols: number, rows: number): void {
  const session = sessions.get(id)
  if (!session?.running) return
  try {
    if (session.backend === 'native') session.proc?.resize(cols, rows)
    else hostSend({ op: 'resize', id, cols, rows })
  } catch {
    // resizing a dying pty throws; ignore
  }
}

export function disposeTerminal(id: string): void {
  const session = sessions.get(id)
  if (!session) return
  if (session.backend === 'native') session.proc?.kill()
  else hostSend({ op: 'dispose', id })
  sessions.delete(id)
}

/** Reattach a renderer to a session: returns scrollback and liveness. */
export function attachTerminal(id: string): { buffer: string; running: boolean } {
  const session = sessions.get(id)
  return { buffer: session?.buffer ?? '', running: session?.running ?? false }
}

export function disposeAllTerminals(): void {
  for (const id of [...sessions.keys()]) disposeTerminal(id)
  host?.kill()
}

/** Register the terminal domain with webdeck-core (P1). All invoke-based; the
 *  live output stream is a separate broadcast, not a request. */
export function registerTerminalRpc(): void {
  core.register(IpcChannels.termCreate, (id, cols, rows) => {
    const t = asString(id)
    if (t) createTerminal(t, asNumber(cols, 80), asNumber(rows, 24))
  })
  core.register(IpcChannels.termInput, (id, data) => {
    const t = asString(id)
    if (t && typeof data === 'string') writeTerminal(t, data)
  })
  core.register(IpcChannels.termResize, (id, cols, rows) => {
    const t = asString(id)
    if (t) resizeTerminal(t, asNumber(cols, 80), asNumber(rows, 24))
  })
  core.register(IpcChannels.termDispose, (id) => {
    const t = asString(id)
    if (t) disposeTerminal(t)
  })
  core.register(IpcChannels.termStop, (id) => {
    const t = asString(id)
    if (t) stopTerminal(t)
  })
  core.register(IpcChannels.termAttach, (id) => {
    const t = asString(id)
    return t ? attachTerminal(t) : { buffer: '', running: false }
  })
}
