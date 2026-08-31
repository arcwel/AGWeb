import type { AgentBrowserPort } from '../core/agent-browser-port'
import {
  agentCapture,
  agentClick,
  agentEval,
  agentNavigate,
  agentOpenTab,
  agentReadPage,
  agentRecordStart,
  agentRecordStop,
  agentSetViewport,
  agentType,
  agentWaitFor,
  takeBlockedNavigation
} from './agent-browser'
import { hasVisionProblems, inspectText } from './browser-vision'

/**
 * The Electron implementation of the agent's browser port: the shell drives real
 * `WebContentsView` tabs in-process. Under the Chromium fork this file is
 * replaced by a proxy that forwards the same calls to the browser process over
 * the transport — the agent domain itself doesn't change.
 */
export function electronAgentBrowser(): AgentBrowserPort {
  return {
    openTab: agentOpenTab,
    navigate: agentNavigate,
    readPage: agentReadPage,
    evaluate: agentEval,
    click: agentClick,
    type: agentType,
    waitFor: agentWaitFor,
    capture: agentCapture,
    setViewport: agentSetViewport,
    recordStart: agentRecordStart,
    recordStop: agentRecordStop,
    takeBlockedNavigation,
    visionReport: inspectText,
    visionHasProblems: hasVisionProblems
  }
}
