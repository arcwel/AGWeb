/**
 * The one door through which an HTML *string* may reach a sink on this page.
 *
 * chrome://webdeck runs under `require-trusted-types-for 'script'`, and the
 * default policy (webui/main.tsx) answers for HTML strings by asking here.
 * Everything WebDeck writes itself goes in as nodes, so the answer is
 * normally no — the refusal is the guarantee the CSP directive exists to give.
 *
 * The exception is a library that renders to markup in a scratch element
 * before handing the result back: mermaid does, and it cannot be told not to.
 * So a caller opens the door for the duration of that one render, and only
 * that, with `withHtmlSinksAllowed`. What the library produces is not trusted
 * on the way OUT either — the diagram is parsed through its own inert-parse
 * policy, scrubbed and inserted as nodes (svg-node.ts) — so this allowance
 * covers the library's own scratch write and nothing that reaches the
 * document.
 *
 * Re-entrant, and closed again on the way out whether the render succeeded
 * or threw. Any code running in the same window could write a string to a
 * sink; only the bundle runs on this page, so that is a bug to find, not an
 * attacker to stop.
 */

let openCount = 0

export function htmlSinksAllowed(): boolean {
  return openCount > 0
}

export async function withHtmlSinksAllowed<T>(work: () => Promise<T>): Promise<T> {
  openCount++
  try {
    return await work()
  } finally {
    openCount--
  }
}
