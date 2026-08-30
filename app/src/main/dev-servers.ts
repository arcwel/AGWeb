import { spawn } from 'node:child_process'
import type { ChildProcess } from 'node:child_process'
import { createServer } from 'node:http'
import type { Server } from 'node:http'
import { createReadStream, existsSync, readFileSync, statSync } from 'node:fs'
import { extname, join, normalize, sep } from 'node:path'
import type { BrowserWindow } from 'electron'
import { IpcEvents } from '@shared/ipc'
import type { DevServerStatus } from '@shared/ipc'
import { getCurrentWorkspace } from './workspace'
import { IpcChannels } from '@shared/ipc'
import { core } from '../core/rpc'

/**
 * Workspace dev server for the Preview block (Phase 4.1). Two modes:
 *  - script: runs the detected package.json dev script (dev > start > serve)
 *    in the workspace, parses the local URL from its output, health-checks it.
 *  - static: a built-in file server over the workspace root for plain sites.
 * One server per app at a time, scoped to the open workspace; a workspace
 * switch or quit stops it (the whole process group, not just the shell).
 */

const SCRIPT_PREFERENCE = ['dev', 'start', 'serve']
const URL_PATTERN = /https?:\/\/(?:localhost|127\.0\.0\.1|0\.0\.0\.0)(?::\d+)?[^\s'"]*/
const LOG_TAIL = 12
const HEALTH_TIMEOUT_MS = 30_000

let host: BrowserWindow | null = null
let child: ChildProcess | null = null
let staticServer: Server | null = null
let generation = 0

let status: DevServerStatus = {
  state: 'stopped',
  mode: 'static',
  script: null,
  url: null,
  logTail: []
}

export function initDevServers(window: BrowserWindow): void {
  host = window
}

function push(update: Partial<DevServerStatus>): void {
  status = { ...status, ...update, script: detectScript() }
  if (host && !host.isDestroyed()) host.webContents.send(IpcEvents.devServerUpdate, status)
}

function appendLog(chunk: string): void {
  const lines = chunk.split('\n').filter((l) => l.trim().length > 0)
  if (lines.length > 0) push({ logTail: [...status.logTail, ...lines].slice(-LOG_TAIL) })
}

/** The package.json script the Preview block would run, if the project has one. */
export function detectScript(): { name: string; command: string } | null {
  const workspace = getCurrentWorkspace()
  if (!workspace) return null
  try {
    const pkg = JSON.parse(readFileSync(join(workspace.path, 'package.json'), 'utf8')) as {
      scripts?: Record<string, string>
    }
    for (const name of SCRIPT_PREFERENCE) {
      const command = pkg.scripts?.[name]
      if (command) return { name, command }
    }
  } catch {
    // no package.json — static mode only
  }
  return null
}

export function getDevServerStatus(): DevServerStatus {
  return { ...status, script: detectScript() }
}

async function healthCheck(url: string, gen: number): Promise<boolean> {
  const deadline = Date.now() + HEALTH_TIMEOUT_MS
  while (Date.now() < deadline && gen === generation) {
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(2000) })
      if (response.status < 500) return true
    } catch {
      // not up yet
    }
    await new Promise((resolve) => setTimeout(resolve, 300))
  }
  return false
}

async function startScript(workspacePath: string): Promise<DevServerStatus> {
  const script = detectScript()
  if (!script) {
    push({ state: 'error', logTail: ['No dev/start/serve script in package.json'] })
    return getDevServerStatus()
  }
  const gen = generation
  push({ state: 'starting', mode: 'script', url: null, logTail: [] })

  // Own process group so stop() can kill the script's whole tree.
  child = spawn('npm', ['run', script.name], {
    cwd: workspacePath,
    env: { ...process.env, FORCE_COLOR: '0' },
    detached: true,
    stdio: ['ignore', 'pipe', 'pipe']
  })

  let url: string | null = null
  const onOutput = (chunk: Buffer): void => {
    if (gen !== generation) return
    const text = chunk.toString()
    appendLog(text)
    if (!url) {
      const match = URL_PATTERN.exec(text)
      if (match) {
        url = match[0].replace('0.0.0.0', '127.0.0.1').replace(/\/$/, '')
        void healthCheck(url, gen).then((healthy) => {
          if (gen !== generation) return
          if (healthy) push({ state: 'running', url })
          else push({ state: 'error', logTail: [...status.logTail, 'Health check timed out'] })
        })
      }
    }
  }
  child.stdout?.on('data', onOutput)
  child.stderr?.on('data', onOutput)
  child.on('exit', (code) => {
    if (gen !== generation) return
    child = null
    push({
      state: code === 0 ? 'stopped' : 'error',
      url: null,
      logTail: code === 0 ? status.logTail : [...status.logTail, `exited with code ${code}`]
    })
  })
  return getDevServerStatus()
}

const CONTENT_TYPES: Record<string, string> = {
  '.html': 'text/html',
  '.js': 'text/javascript',
  '.mjs': 'text/javascript',
  '.css': 'text/css',
  '.json': 'application/json',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.ico': 'image/x-icon',
  '.txt': 'text/plain',
  '.md': 'text/plain',
  '.woff2': 'font/woff2'
}

/** Reject non-loopback Host headers so a rebound DNS name can't read
 *  workspace files through this server (P1-2). */
function staticHostAllowed(header: string | undefined, port: number): boolean {
  if (!header) return false
  const host = header.toLowerCase()
  return host === `127.0.0.1:${port}` || host === `localhost:${port}` || host === `[::1]:${port}`
}

async function startStatic(workspacePath: string): Promise<DevServerStatus> {
  const gen = generation
  push({ state: 'starting', mode: 'static', url: null, logTail: [] })

  let servedPort = 0
  staticServer = createServer((req, res) => {
    if (!staticHostAllowed(req.headers.host, servedPort)) {
      res.writeHead(403)
      res.end('Forbidden')
      return
    }
    const rel = decodeURIComponent((req.url ?? '/').split('?')[0])
    // normalize + prefix check keeps requests inside the workspace root
    const resolved = normalize(join(workspacePath, rel))
    if (resolved !== workspacePath && !resolved.startsWith(workspacePath + sep)) {
      res.writeHead(403)
      res.end()
      return
    }
    let file = resolved
    try {
      if (statSync(file).isDirectory()) file = join(file, 'index.html')
      statSync(file)
    } catch {
      res.writeHead(404)
      res.end('Not found')
      return
    }
    res.writeHead(200, {
      'content-type': CONTENT_TYPES[extname(file).toLowerCase()] ?? 'application/octet-stream',
      'cache-control': 'no-store'
    })
    createReadStream(file).pipe(res)
  })

  await new Promise<void>((resolve) => staticServer?.listen(0, '127.0.0.1', () => resolve()))
  if (gen !== generation) return getDevServerStatus()
  const address = staticServer?.address()
  servedPort = address && typeof address === 'object' ? address.port : 0
  const url = servedPort ? `http://127.0.0.1:${servedPort}` : null
  push({
    state: url ? 'running' : 'error',
    url,
    logTail: url ? [`Serving ${workspacePath}`] : ['Static server failed to bind']
  })
  return getDevServerStatus()
}

export async function startDevServer(mode: 'script' | 'static'): Promise<DevServerStatus> {
  const workspace = getCurrentWorkspace()
  if (!workspace || !existsSync(workspace.path)) {
    push({ state: 'error', logTail: ['No open workspace'] })
    return getDevServerStatus()
  }
  await stopDevServer()
  return mode === 'script' ? startScript(workspace.path) : startStatic(workspace.path)
}

export async function stopDevServer(): Promise<DevServerStatus> {
  generation += 1
  if (child) {
    const dying = child
    child = null
    try {
      if (dying.pid) process.kill(-dying.pid, 'SIGTERM')
    } catch {
      dying.kill('SIGTERM')
    }
  }
  if (staticServer) {
    const closing = staticServer
    staticServer = null
    await new Promise<void>((resolve) => closing.close(() => resolve()))
  }
  push({ state: 'stopped', url: null })
  return getDevServerStatus()
}

/** Register the dev-servers domain with webdeck-core (P1). initDevServers keeps
 *  a window handle and stays shell-side. */
export function registerDevServersRpc(): void {
  core.register(IpcChannels.devServerStart, (mode) =>
    startDevServer(mode === 'script' ? 'script' : 'static')
  )
  core.register(IpcChannels.devServerStop, () => stopDevServer())
  core.register(IpcChannels.devServerStatus, () => getDevServerStatus())
}
