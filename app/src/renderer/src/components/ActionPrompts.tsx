import { useEffect, useState } from 'react'
import type { PolicyPromptInfo } from '@shared/ipc'

/**
 * Pending policy prompts (task 11.11).
 *
 * These used to render as a shell-wide banner above the stage. They now live
 * in the transcript of the session that raised them, because the decision is
 * about *that* agent's next action — a banner detached from the conversation
 * made the user answer a question whose context was elsewhere.
 *
 * The subscription is module-level so several session cards can read the same
 * queue without each opening its own IPC listener.
 */

let prompts: PolicyPromptInfo[] = []
const subscribers = new Set<(next: PolicyPromptInfo[]) => void>()
let started = false

function publish(next: PolicyPromptInfo[]): void {
  prompts = next
  for (const notify of subscribers) notify(prompts)
}

function ensureSubscription(): void {
  if (started) return
  started = true
  window.agweb.policy.onPrompt((prompt) => {
    if (prompts.some((p) => p.id === prompt.id)) return
    publish([...prompts, prompt])
  })
}

export function usePolicyPrompts(): {
  promptFor: (sessionId: string) => PolicyPromptInfo | undefined
  respond: (id: string, allow: boolean, always?: boolean) => void
} {
  const [, setLocal] = useState<PolicyPromptInfo[]>(prompts)

  useEffect(() => {
    ensureSubscription()
    const notify = (next: PolicyPromptInfo[]): void => setLocal(next)
    subscribers.add(notify)
    return () => {
      subscribers.delete(notify)
    }
  }, [])

  return {
    // Oldest first: an agent's prompts are answered in the order it asked.
    promptFor: (sessionId) => prompts.find((p) => p.sessionId === sessionId),
    respond: (id, allow, always = false) => {
      void window.agweb.policy.respond(id, allow, always)
      publish(prompts.filter((p) => p.id !== id))
    }
  }
}
