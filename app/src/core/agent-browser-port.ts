/**
 * The agent's browser port — the last shell dependency in the agent domain.
 *
 * Driving a browser tab is inherently a *shell* capability: on Electron it's a
 * `WebContentsView`, under the fork it's a real Chromium tab the browser process
 * owns. The agent doesn't care which; it needs "open a tab, click this, read
 * that, screenshot it". So the domain talks to this port and the host supplies
 * the implementation — the in-process Electron module today, a transport proxy
 * to the browser process under the fork.
 *
 * With this seam the agent domain imports no shell module at all, which is what
 * lets it run inside a standalone `webdeck-core`.
 *
 * Unwired, every method throws a clear error rather than silently doing nothing:
 * an agent asked to drive a browser that isn't attached should fail loudly.
 */

export interface AgentBrowserPort {
  openTab(url: string): Promise<string>
  navigate(tabId: string, url: string): Promise<string>
  readPage(tabId: string, selector?: string): Promise<string>
  evaluate(tabId: string, expression: string): Promise<string>
  click(tabId: string, selector: string): Promise<string>
  type(tabId: string, selector: string, text: string): Promise<string>
  waitFor(tabId: string, selector: string, timeoutMs: number): Promise<string>
  capture(tabId: string, selector?: string): Promise<Buffer>
  setViewport(tabId: string, width: number, height: number): string
  recordStart(tabId: string): Promise<string>
  recordStop(tabId: string): Promise<string>
  /** A navigation the policy guard cancelled for this tab, if any (cleared on read). */
  takeBlockedNavigation(tabId: string): string | null
  /** Agent Vision: what the browser itself saw (network + console). */
  visionReport(tabId: string): string
  /** Whether this tab saw any network failure or console error. */
  visionHasProblems(tabId: string): boolean
  /**
   * Release whatever the host is holding: tabs, sockets, and — under the fork —
   * a whole browser process tree and its throwaway profile. Optional because
   * Electron's tabs die with the app; the fork's do not, and a missing shutdown
   * there strands ten processes and a temp directory per agent session.
   */
  shutdown?(): Promise<void>
}

const unattached = (): never => {
  throw new Error('no browser attached to this agent host — browser tools are unavailable')
}

const NULL_PORT: AgentBrowserPort = {
  openTab: unattached,
  navigate: unattached,
  readPage: unattached,
  evaluate: unattached,
  click: unattached,
  type: unattached,
  waitFor: unattached,
  capture: unattached,
  setViewport: unattached,
  recordStart: unattached,
  recordStop: unattached,
  // The two read-only probes degrade quietly: an agent with no browser simply
  // has nothing to report, and neither should abort a run.
  takeBlockedNavigation: () => null,
  visionReport: () => 'No browser attached to this agent host.',
  visionHasProblems: () => false
}

let port: AgentBrowserPort = NULL_PORT

/** Wire the host's browser implementation. Call once at startup. */
export function setAgentBrowserPort(next: AgentBrowserPort): void {
  port = next
}

/** The wired browser port (a throwing stub when no browser is attached). */
export function agentBrowser(): AgentBrowserPort {
  return port
}
