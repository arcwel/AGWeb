import type { CoreClient } from '../core/transports/ws-client'

/**
 * The page's half of letting the agent act as the user.
 *
 * The agent runs in webdeck-core, a separate process. The user's own tabs are
 * reachable only from inside the browser — and this page is the only part of
 * WebDeck that lives there. So the core calls us (reverse RPC over the socket
 * it already serves), and we forward to the browser process over Mojo, which
 * drives the tab with in-process DevTools protocol.
 *
 *     agent → core → [socket] → this page → [Mojo] → browser → tab
 *
 * The long way round buys the thing that matters: no debugging port. The
 * alternative — --remote-debugging-port against the user's real session — is
 * unauthenticated total control of their browser for any local process, which
 * is why upstream blocked it on the default profile.
 *
 * Mojo is unavailable when this bundle runs anywhere but the fork (the Electron
 * host, a plain browser, a test). Every method then fails with a clear reason
 * rather than pretending, because the agent reports what these calls return.
 */

/** Methods the core invokes on us. Kept in one place so both ends agree. */
export const AGENT_TAB_METHODS = {
  open: 'agent-tabs:open',
  send: 'agent-tabs:send',
  close: 'agent-tabs:close'
} as const

/** The channel protocol events travel back on, core-ward. */
export const AGENT_TAB_EVENT = 'agent-tabs:event'

/** The subset of the generated Mojo remote this module uses. */
interface AgentTabsClientReceiver {
  $: { bindNewPipeAndPassRemote(): unknown }
  onEvent: unknown
}

interface AgentTabsRemote {
  setClient(client: unknown): void
  openTab(url: string): Promise<{ tabId: string; error: string }>
  sendCommand(
    tabId: string,
    method: string,
    paramsJson: string
  ): Promise<{ resultJson: string; error: string }>
  closeTab(tabId: string): Promise<void>
}

let remote: AgentTabsRemote | null = null
let unavailable: string | null = null

/**
 * Where the transpiled Mojo bindings are served from. A static asset, not a
 * module in this bundle: the generated code imports `//resources/mojo/...`,
 * which exists only for a WebUI page inside the browser, so it cannot go
 * through Vite or tsc on any other host. `scripts/gen-mojo-bindings.mjs`
 * produces it.
 *
 * ABSOLUTE from the WebUI root ("/mojo/…"), NOT relative ("./mojo/…"): the code
 * that imports this is bundled into assets/index.js, so a relative specifier
 * resolves to chrome://webdeck/assets/mojo/… — which 404s (the file is served
 * at chrome://webdeck/mojo/…). The leading slash pins it to the origin root.
 */
const BINDINGS_URL = '/mojo/webdeck.mojom-webui.js'

/**
 * Resolve the browser-process interface, once.
 *
 * The specifier is held in a variable so neither the bundler nor the type
 * checker tries to follow it — the browser resolves it at runtime, and only
 * the fork can.
 */
async function getRemote(): Promise<AgentTabsRemote> {
  if (remote) return remote
  if (unavailable) throw new Error(unavailable)
  try {
    const mod = (await import(/* @vite-ignore */ BINDINGS_URL)) as {
      AgentTabs: { getRemote(): AgentTabsRemote }
    }
    remote = mod.AgentTabs.getRemote()
    return remote
  } catch (err) {
    unavailable =
      'the agent cannot reach the browser on this host — session-mode browsing ' +
      `needs the Arcwel WebDeck build (${(err as Error).message})`
    // Keep the original: "Mojo is not defined" and "failed to fetch the
    // bindings" are different problems with the same symptom, and the second
    // one is a packaging bug worth being able to see.
    throw new Error(unavailable, { cause: err })
  }
}

/**
 * Serve the agent's tab operations to the core.
 *
 * Errors are THROWN rather than returned: the reverse-RPC layer turns a
 * rejection into an error the agent sees, while a resolved value it cannot
 * interpret would read as success — and an agent that believes it clicked
 * something it did not will report work it never did.
 */
/**
 * Forward the browser's protocol events to the core.
 *
 * Without this the core receives nothing, and two things it believes it has
 * silently do not exist: the navigation guard never sees a redirect, and Agent
 * Vision reports "no problems" for every page — including pages that failed.
 * That is worse than having neither, because the agent is told to call
 * browser_inspect before concluding success, and would have been reading a
 * clean bill of health that was really just an empty one.
 */
function forwardEvents(client: CoreClient, api: AgentTabsRemote): void {
  if (eventsBound) return
  eventsBound = true
  void (async () => {
    try {
      const mod = (await import(/* @vite-ignore */ BINDINGS_URL)) as {
        AgentTabsClientReceiver: new (impl: {
          onEvent(tabId: string, method: string, paramsJson: string): void
          onDetached(tabId: string): void
        }) => AgentTabsClientReceiver
      }
      const receiver = new mod.AgentTabsClientReceiver({
        onEvent(tabId: string, method: string, paramsJson: string) {
          void client.notify(AGENT_TAB_EVENT, tabId, method, paramsJson)
        },
        onDetached(tabId: string) {
          void client.notify(AGENT_TAB_EVENT, tabId, 'WebDeck.tabDetached', '{}')
        }
      })
      api.setClient(receiver.$.bindNewPipeAndPassRemote())
    } catch {
      // Leave eventsBound set: retrying per call would spam a failure the user
      // cannot act on. The core surfaces the consequence instead.
      eventsBound = false
    }
  })()
}

let eventsBound = false

export function serveAgentTabs(client: CoreClient): void {
  client.serve(AGENT_TAB_METHODS.open, async (url) => {
    const api = await getRemote()
    // Bind the event pipe before the first tab exists, so the page's own load
    // requests and console output are recorded rather than only what follows.
    forwardEvents(client, api)
    const { tabId, error } = await api.openTab(String(url))
    if (error) throw new Error(error)
    return tabId
  })

  client.serve(AGENT_TAB_METHODS.send, async (tabId, method, paramsJson) => {
    const api = await getRemote()
    const { resultJson, error } = await api.sendCommand(
      String(tabId),
      String(method),
      typeof paramsJson === 'string' ? paramsJson : JSON.stringify(paramsJson ?? {})
    )
    if (error) throw new Error(error)
    return resultJson
  })

  client.serve(AGENT_TAB_METHODS.close, async (tabId) => {
    const api = await getRemote()
    await api.closeTab(String(tabId))
    return true
  })
}
