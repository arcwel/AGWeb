/**
 * The dialogs Electron gave us, done with what a browser actually has.
 *
 * `dialog.showOpenDialog` returns a filesystem PATH, and the core works in
 * paths — it reads the file itself. A browser hands back file CONTENT instead,
 * through `<input type="file">`, and deliberately never reveals where the file
 * came from. So these are not one-to-one ports: where the difference matters,
 * the honest move is to say what this host can do rather than fake a path.
 *
 * `confirm()` is the exception — it is the same dialog Electron was wrapping.
 */

export interface PickResult {
  /** Paths chosen, when the host can report them. Empty when cancelled. */
  paths?: string[]
  /** File contents, when the host can only hand back the bytes. */
  files?: { name: string; text: string }[]
  error?: string
}

/** Native confirm — the browser's own, which is what Electron's wrapped. */
export function confirmDialog(message: string): boolean {
  return window.confirm(message)
}

/** Open the browser's file chooser and read what the user picked. */
function chooseFiles(accept: string, multiple: boolean): Promise<PickResult> {
  return new Promise((resolve) => {
    const input = document.createElement('input')
    input.type = 'file'
    input.accept = accept
    input.multiple = multiple
    input.style.cssText = 'position:fixed;left:-10000px;'

    let settled = false
    const finish = (result: PickResult): void => {
      if (settled) return
      settled = true
      input.remove()
      resolve(result)
    }

    input.onchange = async (): Promise<void> => {
      const list = [...(input.files ?? [])]
      if (!list.length) {
        finish({ files: [] })
        return
      }
      try {
        const files = await Promise.all(
          list.map(async (file) => ({ name: file.name, text: await file.text() }))
        )
        finish({ files })
      } catch (err) {
        finish({ error: `could not read the file: ${(err as Error).message}` })
      }
    }
    // There is no cancel event on a file input. A cancelled chooser simply
    // never fires change, so resolve empty when focus comes back without one —
    // otherwise the caller waits forever on a dialog the user dismissed.
    window.addEventListener('focus', () => setTimeout(() => finish({ files: [] }), 500), {
      once: true
    })

    document.body.appendChild(input)
    input.click()
  })
}

/** Import a JSON document (settings, bookmarks, a sync file). */
export function pickJsonFile(): Promise<PickResult> {
  return chooseFiles('application/json,.json', false)
}

/**
 * Paths, for the agent's attachment picker and anything else that needs a
 * location on disk rather than bytes.
 *
 * A browser will not tell a page where a file lives, by design, and inventing
 * a path here would send the core looking for something that is not there. The
 * caller is told plainly so it can offer a path box instead — which is what the
 * start page already does for opening a project.
 */
export function pickPaths(): PickResult {
  return {
    error:
      'This build cannot open a file browser that reports paths. Type or paste the path instead.'
  }
}

/**
 * Refuse a channel whose answer has nowhere to say "this host cannot".
 *
 * `pickPaths` above can report a failure because its result carries an `error`.
 * `workspace:open` answers with a workspace or `null`, and
 * `app-settings:choose-download-dir` answers with the settings — in both, the
 * only value left to return is the one that means *the user cancelled*. A
 * caller reading that carries on as though nothing had gone wrong, which is the
 * silent no-op this migration keeps having to undo. A rejection is the one
 * answer that cannot be mistaken for success.
 *
 * Reaching one of these is a wiring bug, not a normal path: the UI on this host
 * reads `host.canPickPaths` / `host.ownsBrowserFeatures` and offers the
 * alternative named in the message rather than calling at all.
 */
export function unavailableHere(message: string): Promise<never> {
  return Promise.reject(new Error(message))
}
