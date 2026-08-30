/**
 * Parse an exported bookmarks file into a flat {url, title} list.
 *
 * Handles the two formats browsers export: the Netscape bookmark HTML that
 * Chrome, Firefox, Edge and Safari all produce ("Export bookmarks"), and
 * Chrome's own `Bookmarks` JSON file. Folder structure is flattened — WebDeck
 * keeps a single list per profile.
 */

export interface ImportedBookmark {
  url: string
  title: string
}

function isWebUrl(url: string): boolean {
  return /^https?:\/\//i.test(url)
}

/** Netscape bookmark HTML: every `<A HREF>` is a bookmark. */
function parseHtml(html: string): ImportedBookmark[] {
  const doc = new DOMParser().parseFromString(html, 'text/html')
  return [...doc.querySelectorAll('a[href]')]
    .map((a) => ({ url: a.getAttribute('href') ?? '', title: (a.textContent ?? '').trim() }))
    .filter((b) => isWebUrl(b.url))
    .map((b) => ({ url: b.url, title: b.title || b.url }))
}

/** Chrome's `Bookmarks` JSON: a tree of folders and `type: "url"` nodes. */
function parseChromeJson(text: string): ImportedBookmark[] {
  const out: ImportedBookmark[] = []
  const walk = (node: unknown): void => {
    if (!node || typeof node !== 'object') return
    const n = node as { type?: string; url?: string; name?: string; children?: unknown[] }
    if (n.type === 'url' && n.url && isWebUrl(n.url)) {
      out.push({ url: n.url, title: n.name || n.url })
    }
    if (Array.isArray(n.children)) n.children.forEach(walk)
  }
  try {
    const data = JSON.parse(text) as { roots?: Record<string, unknown> }
    Object.values(data.roots ?? {}).forEach(walk)
  } catch {
    // Not valid JSON — the caller will have tried HTML instead.
  }
  return out
}

export function parseBookmarks(text: string): ImportedBookmark[] {
  return text.trim().startsWith('{') ? parseChromeJson(text) : parseHtml(text)
}
