/**
 * DAP client (task 12.4).
 *
 * A small, explicit client rather than a library: the Debug Adapter Protocol
 * is request/response plus events over one JSON envelope, and the surface this
 * app needs is a dozen commands. `@vscode/debugadapter` is for *writing*
 * adapters, not driving them, so there is nothing to reuse there.
 *
 * **js-debug is a parent/child debugger**, and that shapes this whole module.
 * The connection that handles `launch` never owns the debuggee: it sends a
 * `startDebugging` reverse request asking us to open a second session, and it
 * is that child which hits breakpoints and has a stack. So every request is
 * addressed to a session id, and breakpoints are re-sent to each new child.
 * A client that ignores `startDebugging` runs the program and stops nowhere.
 */

export interface DapMessage {
  seq: number
  type: 'request' | 'response' | 'event'
  command?: string
  event?: string
  body?: unknown
  arguments?: unknown
  request_seq?: number
  success?: boolean
  message?: string
}

export interface StackFrame {
  id: number
  name: string
  line: number
  column: number
  source?: { path?: string; name?: string }
}

export interface Variable {
  name: string
  value: string
  variablesReference: number
}

/** Events carry the session they came from, so the UI can follow the child. */
type EventHandler = (event: string, body: unknown, sessionId: string) => void

let seq = 1
const pending = new Map<number, { resolve: (body: unknown) => void; reject: (e: Error) => void }>()
const handlers = new Set<EventHandler>()
let subscribed = false

/** Breakpoints for the run, re-applied to every child session that appears. */
let sessionBreakpoints: Record<string, number[]> = {}
let childCount = 0

function ensureSubscribed(): void {
  if (subscribed) return
  subscribed = true

  window.agweb.debug.onMessage((payload) => {
    const { sessionId, message } = payload as { sessionId: string; message: DapMessage }

    if (message.type === 'response') {
      const waiter =
        message.request_seq !== undefined ? pending.get(message.request_seq) : undefined
      if (!waiter) return
      pending.delete(message.request_seq as number)
      if (message.success === false) waiter.reject(new Error(message.message ?? 'request failed'))
      else waiter.resolve(message.body)
      return
    }

    if (message.type === 'request') {
      void handleReverseRequest(sessionId, message)
      return
    }

    if (message.type === 'event' && message.event) {
      for (const handler of handlers) handler(message.event, message.body, sessionId)
    }
  })

  window.agweb.debug.onExit(() => {
    for (const waiter of pending.values()) waiter.reject(new Error('the debug adapter exited'))
    pending.clear()
    for (const handler of handlers) handler('terminated', undefined, 'root')
  })
}

/**
 * Requests the *adapter* sends *us*.
 *
 * `startDebugging` is the one that matters: answer it, open the child
 * connection, and configure it. `runInTerminal` is answered as unsupported —
 * we launch with an internal console, so it should never arrive.
 */
async function handleReverseRequest(sessionId: string, message: DapMessage): Promise<void> {
  if (message.command !== 'startDebugging') {
    respond(sessionId, message, false)
    return
  }

  const args = message.arguments as { configuration?: Record<string, unknown> } | undefined
  const childId = `child-${++childCount}`

  // Acknowledge before configuring: js-debug waits for this response before it
  // will accept the child's connection.
  respond(sessionId, message, true)

  const attached = await window.agweb.debug.attachChild(childId)
  if (attached.error) return

  await request(childId, 'initialize', {
    clientID: 'agweb',
    adapterID: 'pwa-node',
    pathFormat: 'path',
    linesStartAt1: true,
    columnsStartAt1: true,
    supportsConfigurationDoneRequest: true,
    supportsStartDebuggingRequest: true
  }).catch(() => undefined)

  // The configuration comes back verbatim — it carries __pendingTargetId,
  // which is how js-debug matches this connection to the target it spawned.
  void request(childId, 'launch', { ...(args?.configuration ?? {}) }).catch(() => undefined)

  await applyBreakpoints(childId)
  await request(childId, 'configurationDone').catch(() => undefined)
}

function respond(sessionId: string, message: DapMessage, success: boolean): void {
  window.agweb.debug.send(sessionId, {
    seq: seq++,
    type: 'response',
    request_seq: message.seq,
    command: message.command,
    success
  })
}

async function applyBreakpoints(sessionId: string): Promise<void> {
  for (const [path, lines] of Object.entries(sessionBreakpoints)) {
    if (!lines.length) continue
    await request(sessionId, 'setBreakpoints', {
      source: { path },
      breakpoints: lines.map((line) => ({ line }))
    }).catch(() => undefined)
  }
}

export function onDebugEvent(handler: EventHandler): () => void {
  ensureSubscribed()
  handlers.add(handler)
  return () => {
    handlers.delete(handler)
  }
}

/** Send a DAP request to one session and wait for its response. */
export function request<T = unknown>(
  sessionId: string,
  command: string,
  args?: unknown
): Promise<T> {
  ensureSubscribed()
  const id = seq++
  return new Promise<T>((resolve, reject) => {
    pending.set(id, { resolve: resolve as (body: unknown) => void, reject })
    window.agweb.debug.send(sessionId, {
      seq: id,
      type: 'request',
      command,
      arguments: args
    })
  })
}

/**
 * Bring up a session and run.
 *
 * Order is the protocol's: `initialize`, breakpoints once the adapter reports
 * `initialized`, then `configurationDone`. Sending breakpoints earlier loses
 * them. The root session then hands off to a child via `startDebugging`.
 */
export async function launch(
  program: string,
  cwd: string,
  breakpoints: Record<string, number[]>
): Promise<{ error?: string }> {
  sessionBreakpoints = breakpoints
  childCount = 0

  const started = await window.agweb.debug.start()
  if (started.error) return started

  const configured = new Promise<void>((resolve) => {
    const off = onDebugEvent(async (event, _body, sessionId) => {
      if (event !== 'initialized' || sessionId !== 'root') return
      off()
      await applyBreakpoints('root')
      await request('root', 'configurationDone').catch(() => undefined)
      resolve()
    })
  })

  try {
    await request('root', 'initialize', {
      clientID: 'agweb',
      adapterID: 'pwa-node',
      pathFormat: 'path',
      linesStartAt1: true,
      columnsStartAt1: true,
      supportsConfigurationDoneRequest: true,
      // Without this the adapter will not use the parent/child flow at all.
      supportsStartDebuggingRequest: true
    })
    // Not awaited before configurationDone: js-debug resolves `launch` only
    // after configuration completes, so awaiting here would deadlock.
    const launched = request('root', 'launch', {
      type: 'pwa-node',
      request: 'launch',
      name: 'Debug current file',
      program,
      cwd,
      console: 'internalConsole',
      internalConsoleOptions: 'neverOpen',
      sourceMaps: true
    })
    await configured
    await launched
    return {}
  } catch (error) {
    return { error: error instanceof Error ? error.message : String(error) }
  }
}

export async function stackTrace(sessionId: string, threadId: number): Promise<StackFrame[]> {
  const body = await request<{ stackFrames?: StackFrame[] }>(sessionId, 'stackTrace', {
    threadId,
    startFrame: 0,
    levels: 20
  }).catch(() => ({ stackFrames: [] }))
  return body.stackFrames ?? []
}

export async function scopeVariables(sessionId: string, frameId: number): Promise<Variable[]> {
  const scopes = await request<{ scopes?: Array<{ name: string; variablesReference: number }> }>(
    sessionId,
    'scopes',
    { frameId }
  ).catch(() => ({ scopes: [] }))

  const out: Variable[] = []
  // Locals only: the global scope is thousands of entries and is never what
  // someone stopped at a breakpoint is looking for.
  for (const scope of (scopes.scopes ?? []).slice(0, 1)) {
    const body = await request<{ variables?: Variable[] }>(sessionId, 'variables', {
      variablesReference: scope.variablesReference
    }).catch(() => ({ variables: [] }))
    out.push(...(body.variables ?? []))
  }
  return out
}

/** Evaluate a watch expression in the stopped frame. */
export async function evaluate(
  sessionId: string,
  expression: string,
  frameId?: number
): Promise<string> {
  try {
    const body = await request<{ result?: string }>(sessionId, 'evaluate', {
      expression,
      frameId,
      context: 'watch'
    })
    return body.result ?? ''
  } catch (error) {
    return error instanceof Error ? error.message : String(error)
  }
}

export const control = {
  continue: (sessionId: string, threadId: number) => request(sessionId, 'continue', { threadId }),
  next: (sessionId: string, threadId: number) => request(sessionId, 'next', { threadId }),
  stepIn: (sessionId: string, threadId: number) => request(sessionId, 'stepIn', { threadId }),
  stepOut: (sessionId: string, threadId: number) => request(sessionId, 'stepOut', { threadId }),
  stop: async (): Promise<void> => {
    await request('root', 'disconnect', { terminateDebuggee: true }).catch(() => undefined)
    await window.agweb.debug.stop()
  }
}
