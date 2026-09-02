/// <reference lib="dom" />
/**
 * Document Studio exports, done the way a browser does them.
 *
 * Under Electron this went to the main process: a native save dialog, then
 * `fsp.writeFile` or `printToPDF` in a hidden window. On the fork WebDeck *is*
 * a page in a browser, and the browser already knows how to save a file and
 * print to PDF — with the user's own download location, their print settings,
 * and a preview. Routing that back through a service would be reimplementing
 * the host badly.
 *
 * So there is no core round-trip here at all: HTML becomes a download, and PDF
 * becomes Chromium's print preview with Save as PDF already selected.
 */

export interface ExportResult {
  path?: string
  error?: string
}

/** Hand `contents` to the browser as a download. */
function download(contents: BlobPart, filename: string, type: string): void {
  const url = URL.createObjectURL(new Blob([contents], { type }))
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = filename
  document.body.appendChild(anchor)
  anchor.click()
  anchor.remove()
  // Give the download a moment to start before the URL is invalidated —
  // revoking synchronously can cancel it.
  setTimeout(() => URL.revokeObjectURL(url), 10_000)
}

export function exportHtml(html: string, suggestedName: string): ExportResult {
  try {
    download(html, suggestedName, 'text/html;charset=utf-8')
    // The browser owns the destination, so there is no path to report back.
    // Saying "Downloaded" rather than inventing one keeps the toast honest.
    return { path: `${suggestedName} (downloaded)` }
  } catch (err) {
    return { error: `could not export: ${(err as Error).message}` }
  }
}

/**
 * Print the standalone document to PDF via the browser's own print preview.
 *
 * An offscreen iframe rather than a popup: a popup would be blocked, and the
 * print dialog belongs to the document being printed, so the iframe's own
 * `print()` is what gives the user the right page — their margins, their scale,
 * their choice of printer or Save as PDF.
 */
export function exportPdf(html: string, suggestedName: string): Promise<ExportResult> {
  return new Promise((resolve) => {
    const frame = document.createElement('iframe')
    // Offscreen rather than display:none — a hidden frame does not lay out, and
    // an unlaid-out document prints blank.
    frame.setAttribute('aria-hidden', 'true')
    frame.style.cssText =
      'position:fixed;left:-10000px;top:0;width:816px;height:1056px;border:0;visibility:hidden;'
    // The document is rendered only to be printed; it never needs script, and
    // this is user content, so close that door as the Electron path did.
    frame.setAttribute('sandbox', 'allow-same-origin allow-modals')

    let settled = false
    const finish = (result: ExportResult): void => {
      if (settled) return
      settled = true
      // Leave the frame up briefly: removing it while the print dialog is open
      // tears down the document being printed.
      setTimeout(() => frame.remove(), 60_000)
      resolve(result)
    }

    frame.onload = (): void => {
      try {
        const win = frame.contentWindow
        if (!win) {
          finish({ error: 'could not open a print view' })
          return
        }
        win.document.title = suggestedName.replace(/\.pdf$/i, '')
        win.focus()
        win.print()
        finish({ path: `${suggestedName} (via print to PDF)` })
      } catch (err) {
        finish({ error: `could not print: ${(err as Error).message}` })
      }
    }

    frame.srcdoc = html
    document.body.appendChild(frame)
    // If the frame never loads, do not leave the caller waiting forever.
    setTimeout(() => finish({ error: 'the print view did not load' }), 20_000)
  })
}

/**
 * PNG capture is not implemented on this host.
 *
 * Electron captured the live window region with `webContents.capturePage`. A
 * page cannot photograph itself — there is no browser API for it — and the
 * honest options (rasterising the DOM by hand, or asking the core to re-render
 * the document in a tab and screenshot it) are real work rather than a shim.
 * Returning a fake success here would put "Exported foo.png" in the UI with no
 * file anywhere, so it says what is true instead.
 */
export function exportCapture(suggestedName: string): ExportResult {
  return {
    error: `PNG export is not available in the browser build yet — use HTML or PDF for ${suggestedName}.`
  }
}
