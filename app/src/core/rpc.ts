/**
 * webdeck-core — the transport-agnostic request bridge.
 *
 * This is the first stone of the Chromium migration (plan phase P1). Today the
 * agent/IDE logic runs inside Electron's main process and is reached over
 * `ipcMain.handle`. Under the future Chromium fork there is no in-process Node,
 * so the same logic will run as a standalone service (`webdeck-core`) reached
 * over a local socket. The only thing that must change between those two worlds
 * is the *transport* — never the handlers.
 *
 * So handlers register here, by method name, with no idea what carries them. A
 * transport (Electron IPC today, a websocket under Chromium tomorrow) binds the
 * whole registry at once. Nothing in this file imports Electron — it compiles
 * and runs anywhere Node does, which is the point.
 */

/** A request handler: takes the call's arguments, returns a value or a promise. */
export type CoreHandler = (...args: unknown[]) => unknown | Promise<unknown>

/**
 * A way to carry core requests. Electron's IPC is one; a websocket server in
 * webdeck-core will be another. A transport is handed every registered method
 * and decides how to expose it.
 *
 * `handle` is for request/response methods. `notify` — optional — is for
 * fire-and-forget streams (a language-server or debug-adapter message pushed
 * from the renderer, with no reply). A transport that can't stream simply omits
 * it and those methods aren't bound.
 */
export interface CoreTransport {
  handle(method: string, handler: CoreHandler): void
  notify?(method: string, handler: CoreHandler): void
}

/**
 * The registry of core methods.
 *
 * `register` collects handlers (called at module load, before any transport
 * exists); `bind` wires them all onto a transport; `dispatch` invokes one
 * directly, which is what a socket transport calls per incoming message.
 */
export class CoreRegistry {
  private readonly handlers = new Map<string, CoreHandler>()
  private readonly notifiers = new Map<string, CoreHandler>()

  register(method: string, handler: CoreHandler): void {
    if (this.handlers.has(method)) {
      throw new Error(`webdeck-core: duplicate handler for "${method}"`)
    }
    this.handlers.set(method, handler)
  }

  /** A fire-and-forget method (a stream in, no reply). */
  registerNotify(method: string, handler: CoreHandler): void {
    if (this.notifiers.has(method)) {
      throw new Error(`webdeck-core: duplicate notifier for "${method}"`)
    }
    this.notifiers.set(method, handler)
  }

  /** Expose every registered method through a transport. */
  bind(transport: CoreTransport): void {
    for (const [method, handler] of this.handlers) transport.handle(method, handler)
    if (transport.notify) {
      for (const [method, handler] of this.notifiers) transport.notify(method, handler)
    }
  }

  /** Invoke one method by name — the entry point a socket transport uses. */
  async dispatch(method: string, args: readonly unknown[] = []): Promise<unknown> {
    const handler = this.handlers.get(method)
    if (!handler) throw new Error(`webdeck-core: no handler for "${method}"`)
    return handler(...args)
  }

  /** Fire one notifier by name — no reply. */
  notify(method: string, args: readonly unknown[] = []): void {
    const handler = this.notifiers.get(method)
    if (handler) void handler(...args)
  }

  /** The methods currently registered — for diagnostics and the boundary audit. */
  methods(): { request: string[]; notify: string[] } {
    return {
      request: [...this.handlers.keys()].sort(),
      notify: [...this.notifiers.keys()].sort()
    }
  }
}

/** The process-wide core registry. Handlers register onto this. */
export const core = new CoreRegistry()
