import { browserPrefs } from '../../webui/shell'
import { useShellStore } from '@/store'

/**
 * Open a file dropped onto the shell in a browser tab.
 *
 * A page never learns where a dropped file lives, and the browser will not
 * navigate to a path the page names — so the bytes go to the core, which
 * stages them in one directory, and the browser opens them there by bare name.
 * Chromium's own viewers take it from there, which for a PDF means its PDF
 * viewer, with annotation and printing.
 *
 * Documents are the exception. Chromium has no reader for markdown, JSON, YAML
 * or CSV, so the core grants those to the file layer and they open in Document
 * Studio, which does.
 */
const MAX_BYTES = 128 * 1024 * 1024

/**
 * Give a shell tab its browser view before asking the browser to load into it.
 *
 * A fresh tab is a strip entry with no WebContents behind it. Ask the browser
 * to open a file in one and the id maps to nothing, so it loads into whatever
 * tab is active instead — which is how a dropped PDF ended up navigating the
 * page the user was already reading.
 */
export async function ensureTabView(tabId: string): Promise<void> {
  const { tabs, markTabHasContent } = useShellStore.getState()
  const tab = tabs.find((t) => t.id === tabId)
  if (tab && !tab.hasContent) {
    await window.agweb.browser.create(tabId)
    markTabHasContent(tabId)
  }
}

/**
 * Open a dropped file in a tab of its own.
 *
 * The tab is minted HERE, once the staging result says which kind is needed.
 * Minting it in the drop handler instead left a blank tab behind every time a
 * document opened, because a document opens a doc tab rather than a browser
 * one.
 */
export async function openDroppedFile(file: File): Promise<{ ok: boolean; error?: string }> {
  if (file.size === 0) return { ok: false, error: 'That file was empty.' }
  if (file.size > MAX_BYTES) {
    return { ok: false, error: 'That file is too large to open here.' }
  }
  let base64: string
  try {
    base64 = await toBase64(file)
  } catch {
    return { ok: false, error: 'That file could not be read.' }
  }
  const staged = await window.agweb.drops.write(file.name, base64)
  // A document goes to Document Studio, not to the browser: Chromium shows
  // markdown and JSON as raw text and does not show CSV or YAML at all.
  if (staged.docPath) {
    useShellStore.getState().openDoc(staged.docPath)
    return { ok: true }
  }
  if (!staged.name) return { ok: false, error: staged.error ?? 'That file could not be staged.' }
  const tabId = useShellStore.getState().newTab()
  // Everything after the tab exists is inside the catch. `browser.create`
  // throws when the browser cannot be reached at all, and a throw here used to
  // escape past the `!opened` cleanup and strand the tab: the user saw a new,
  // permanently empty tab and no reason for it.
  try {
    await ensureTabView(tabId)
    const opened = await browserPrefs.openDroppedFile(tabId, staged.name)
    if (!opened) {
      useShellStore.getState().closeTab(tabId)
      return { ok: false, error: 'The browser refused to open that file.' }
    }
    return { ok: true }
  } catch (error) {
    useShellStore.getState().closeTab(tabId)
    return { ok: false, error: error instanceof Error ? error.message : String(error) }
  }
}

/** Base64 without the data: prefix, in chunks so a large file cannot blow the
 *  argument limit of String.fromCharCode. */
async function toBase64(file: File): Promise<string> {
  const bytes = new Uint8Array(await file.arrayBuffer())
  let binary = ''
  for (let i = 0; i < bytes.length; i += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
  }
  return btoa(binary)
}
