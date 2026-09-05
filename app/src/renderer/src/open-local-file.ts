import { browserPrefs } from '../../webui/shell'
import { isDocFile, isEditorFile } from '@shared/ipc'
import { useShellStore } from '@/store'

/**
 * Local files, opened where they live.
 *
 * There are three ways one arrives — dropped on the window, picked in the
 * browser's open panel, clicked in the Files block — and they all end in the
 * same place: a path the core reads and Document Studio renders. Nothing is
 * copied and nothing is posted through the socket as bytes, so a 200 MB CSV
 * costs what reading a file costs.
 *
 * The page is not trusted with the path, it only carries it. A page can name
 * any path it likes; what makes one openable is the BROWSER's signature over
 * it, made when the user picked or dropped the file, with a key the page never
 * holds. The core checks that signature before it grants anything. Files
 * inside an open project need no signature — the project is the grant.
 */

/** Hand the core a path the browser signed, and open it in Document Studio. */
export async function openSignedDocument(file: {
  path: string
  auth: string
}): Promise<{ ok: boolean; error?: string }> {
  const granted = await window.agweb.files.openSigned(file.path, file.auth)
  if (!granted.path) {
    return { ok: false, error: granted.error ?? 'That file could not be opened.' }
  }
  // Everything WebDeck reads opens on the stage, in Document Studio: a
  // document in its styled view, source and plain text in the source view.
  // Nothing opens Deck blocks on its own — the reader's "Open in Editor" is
  // the user's call. The browser only signs types on one of the two lists,
  // so anything else here means the lists fell out of step with
  // webdeck_shell.cc; say so rather than open nothing.
  if (isDocFile(granted.path) || isEditorFile(granted.path)) {
    useShellStore.getState().openDoc(granted.path)
    return { ok: true }
  }
  return { ok: false, error: `WebDeck has no reader for ${granted.path.split('/').pop()}.` }
}

/**
 * Show the browser's open panel and open what the user picked.
 *
 * Anything Chromium renders is navigated to in a tab minted here. A document
 * comes back as a signed path instead and needs no tab of its own, so the
 * placeholder goes away again.
 *
 * A cancelled panel returns `{ ok: false }` with no error: nothing went wrong.
 */
export async function openFileFromPicker(): Promise<{ ok: boolean; error?: string }> {
  const tabId = useShellStore.getState().newTab()
  try {
    await ensureTabView(tabId)
    const picked = await browserPrefs.openLocalFile(tabId)
    if (picked.document) {
      // The tab was only ever somewhere for the browser to navigate into.
      useShellStore.getState().closeTab(tabId)
      return openSignedDocument(picked.document)
    }
    if (!picked.navigated) {
      useShellStore.getState().closeTab(tabId)
      return { ok: false }
    }
    return { ok: true }
  } catch (error) {
    useShellStore.getState().closeTab(tabId)
    return { ok: false, error: error instanceof Error ? error.message : String(error) }
  }
}

/**
 * Give a shell tab its browser view before asking the browser to load into it.
 *
 * A fresh tab is a strip entry with no WebContents behind it. Ask the browser
 * to open a file in one and the id maps to nothing, so it loads into whatever
 * tab is active instead — which is how a picked PDF once navigated the page
 * the user was already reading.
 */
export async function ensureTabView(tabId: string): Promise<void> {
  const { tabs, markTabHasContent } = useShellStore.getState()
  const tab = tabs.find((t) => t.id === tabId)
  if (tab && !tab.hasContent) {
    await window.agweb.browser.create(tabId)
    markTabHasContent(tabId)
  }
}
