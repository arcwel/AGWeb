import { createServer } from 'node:http'
import type { Server } from 'node:http'
import { createReadStream, readFileSync, statSync } from 'node:fs'
import { basename, dirname, extname, join, normalize, sep } from 'node:path'
import { IpcChannels } from '@shared/ipc'
import { core } from '../core/rpc'
import { asString } from '../core/coerce'
import { getCurrentWorkspace } from './workspace'

/**
 * Reveal.js slide runtime (Phase 4.4). Decks are plain markdown files named
 * *.slides.md — `---` starts a new slide, `--` a vertical one. A lazy local
 * server renders them with Reveal's markdown plugin and live-reloads the
 * deck when the file changes on disk, so editor saves re-render instantly.
 */

const REVEAL_DIST = join(dirname(require.resolve('reveal.js')), '.')

let server: Server | null = null
let baseUrl: string | null = null
let boundPort = 0

/**
 * Loopback binding stops remote traffic but not DNS rebinding: a page on
 * evil.example can re-point that name at 127.0.0.1 and read our responses
 * same-origin. Requiring a literal-loopback Host defeats it, because the
 * rebound request still carries the attacker's hostname (P1-2).
 */
function hostAllowed(header: string | undefined): boolean {
  if (!header) return false
  const host = header.toLowerCase()
  return (
    host === `127.0.0.1:${boundPort}` ||
    host === `localhost:${boundPort}` ||
    host === `[::1]:${boundPort}`
  )
}

/** HTML-escape text interpolated into generated pages (P1-3). */
function esc(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

const CONTENT_TYPES: Record<string, string> = {
  '.html': 'text/html',
  '.js': 'text/javascript',
  '.mjs': 'text/javascript',
  '.css': 'text/css',
  '.md': 'text/plain; charset=utf-8',
  '.woff2': 'font/woff2'
}

export function isSlidesPath(rel: string): boolean {
  return /\.slides\.md$/i.test(rel)
}

/** Workspace-relative deck path → absolute file, or null if outside/invalid. */
function deckFile(rel: string): string | null {
  const workspace = getCurrentWorkspace()
  if (!workspace || !isSlidesPath(rel)) return null
  const resolved = normalize(join(workspace.path, rel))
  if (!resolved.startsWith(workspace.path + sep)) return null
  // The deck must actually exist: without this any *.slides.md-suffixed path
  // renders the shell, turning the whole tree into an injection namespace.
  try {
    if (!statSync(resolved).isFile()) return null
  } catch {
    return null
  }
  return resolved
}

function deckHtml(rel: string): string {
  const raw = `/raw/${encodeURIComponent(rel)}`
  const mtime = `/mtime/${encodeURIComponent(rel)}`
  const encoded = encodeURIComponent(rel)
  return `<!doctype html>
<html><head>
<meta charset="utf-8" />
<title>${esc(basename(rel))}</title>
<link rel="stylesheet" href="/reveal/reset.css" />
<link rel="stylesheet" href="/reveal/reveal.css" />
<link rel="stylesheet" href="/reveal/theme/black.css" />
<link rel="stylesheet" href="/reveal/plugin/highlight/monokai.css" />
<style>
  .agweb-export { position: fixed; top: 10px; right: 12px; z-index: 40;
    display: flex; gap: 6px; opacity: 0.25; transition: opacity 0.15s; }
  .agweb-export:hover { opacity: 1; }
  .agweb-export a { color: #ddd; background: rgba(30,30,30,0.8);
    border: 1px solid #555; border-radius: 6px; padding: 3px 8px;
    font: 600 11px sans-serif; text-decoration: none; }
</style>
</head><body>
<div class="agweb-export">
  <a href="/export/html/${encoded}" download>Export HTML</a>
  <a href="/export/json/${encoded}" download>Export JSON</a>
</div>
<div class="reveal"><div class="slides">
  <section data-markdown="${raw}"
    data-separator="^\\r?\\n---\\r?\\n$"
    data-separator-vertical="^\\r?\\n--\\r?\\n$"></section>
</div></div>
<script src="/reveal/reveal.js"></script>
<script src="/reveal/plugin/markdown.js"></script>
<script src="/reveal/plugin/highlight.js"></script>
<script>
  Reveal.initialize({ hash: true, plugins: [RevealMarkdown, RevealHighlight] })
  let last = null
  setInterval(async () => {
    try {
      const res = await fetch('${mtime}')
      const { mtime } = await res.json()
      if (last !== null && mtime !== last) location.reload()
      last = mtime
    } catch {
      /* server gone — stop reloading silently */
    }
  }, 700)
</script>
</body></html>`
}

/* ---- Export pipeline (Phase 4.6) ---- */

interface DeckSlide {
  markdown: string
  vertical: string[]
}

/** Split deck markdown into its slide structure (`---` horizontal, `--` vertical). */
function parseDeck(markdown: string): { title: string; slides: DeckSlide[] } {
  const slides = markdown.split(/\r?\n---\r?\n/).map((horizontal) => {
    const [first, ...vertical] = horizontal.split(/\r?\n--\r?\n/)
    return { markdown: first.trim(), vertical: vertical.map((v) => v.trim()) }
  })
  const title = /^#\s+(.+)$/m.exec(markdown)?.[1]?.trim() ?? 'Untitled deck'
  return { title, slides }
}

function revealAsset(rel: string): string {
  // `</script` inside JS strings/regexes becomes `<\/script` — identical
  // semantics, safe to inline into a script tag.
  return readFileSync(join(REVEAL_DIST, rel), 'utf8').replace(/<\/script/g, '<\\/script')
}

/** One self-contained HTML file: reveal runtime + styles + markdown inlined. */
function bundleHtml(rel: string, markdown: string): string {
  const { title } = parseDeck(markdown)
  const template = markdown.replace(/<\/script/g, '<\\/script')
  return `<!doctype html>
<html><head>
<meta charset="utf-8" />
<title>${esc(title)}</title>
<style>${revealAsset('reset.css')}</style>
<style>${revealAsset('reveal.css')}</style>
<style>${revealAsset('theme/black.css')}</style>
<style>${revealAsset('plugin/highlight/monokai.css')}</style>
</head><body>
<div class="reveal"><div class="slides">
  <section data-markdown
    data-separator="^\\r?\\n---\\r?\\n$"
    data-separator-vertical="^\\r?\\n--\\r?\\n$">
    <script type="text/template">${template}</script>
  </section>
</div></div>
<script>${revealAsset('reveal.js')}</script>
<script>${revealAsset('plugin/markdown.js')}</script>
<script>${revealAsset('plugin/highlight.js')}</script>
<script>Reveal.initialize({ hash: true, embedded: false, plugins: [RevealMarkdown, RevealHighlight] })</script>
</body></html>
<!-- Exported from Arcwel WebDeck — source: ${basename(rel)} -->`
}

function handle(url: string, res: import('node:http').ServerResponse, hostHeader?: string): void {
  if (!hostAllowed(hostHeader)) {
    res.writeHead(403)
    res.end('Forbidden')
    return
  }
  const [route, ...restParts] = url.replace(/^\//, '').split('/')
  const rest = decodeURIComponent(restParts.join('/')).split('?')[0]

  if (route === 'deck') {
    if (!deckFile(rest)) {
      res.writeHead(404)
      res.end('Unknown deck')
      return
    }
    res.writeHead(200, { 'content-type': 'text/html', 'cache-control': 'no-store' })
    res.end(deckHtml(rest))
    return
  }

  if (route === 'raw' || route === 'mtime') {
    const file = deckFile(rest)
    if (!file) {
      res.writeHead(404)
      res.end()
      return
    }
    try {
      if (route === 'mtime') {
        res.writeHead(200, { 'content-type': 'application/json', 'cache-control': 'no-store' })
        res.end(JSON.stringify({ mtime: statSync(file).mtimeMs }))
      } else {
        res.writeHead(200, { 'content-type': CONTENT_TYPES['.md'], 'cache-control': 'no-store' })
        res.end(readFileSync(file, 'utf8'))
      }
    } catch {
      res.writeHead(404)
      res.end()
    }
    return
  }

  if (route === 'export') {
    const [kind, ...pathParts] = restParts
    const deckRel = decodeURIComponent(pathParts.join('/')).split('?')[0]
    const file = deckFile(deckRel)
    if (!file || (kind !== 'html' && kind !== 'json')) {
      res.writeHead(404)
      res.end()
      return
    }
    try {
      const markdown = readFileSync(file, 'utf8')
      const stem = basename(deckRel).replace(/\.slides\.md$/i, '')
      if (kind === 'json') {
        res.writeHead(200, {
          'content-type': 'application/json',
          'content-disposition': `attachment; filename="${stem}.deck.json"`
        })
        res.end(JSON.stringify({ source: basename(deckRel), ...parseDeck(markdown) }, null, 2))
      } else {
        res.writeHead(200, {
          'content-type': 'text/html',
          'content-disposition': `attachment; filename="${stem}.html"`
        })
        res.end(bundleHtml(deckRel, markdown))
      }
    } catch {
      res.writeHead(500)
      res.end()
    }
    return
  }

  if (route === 'reveal') {
    const file = normalize(join(REVEAL_DIST, rest))
    if (!file.startsWith(REVEAL_DIST + sep)) {
      res.writeHead(403)
      res.end()
      return
    }
    try {
      statSync(file)
    } catch {
      res.writeHead(404)
      res.end()
      return
    }
    res.writeHead(200, {
      'content-type': CONTENT_TYPES[extname(file).toLowerCase()] ?? 'application/octet-stream'
    })
    createReadStream(file).pipe(res)
    return
  }

  res.writeHead(404)
  res.end()
}

async function ensureServer(): Promise<string> {
  if (server && baseUrl) return baseUrl
  server = createServer((req, res) => handle(req.url ?? '/', res, req.headers.host))
  await new Promise<void>((resolve) => server?.listen(0, '127.0.0.1', () => resolve()))
  const address = server?.address()
  boundPort = address && typeof address === 'object' ? address.port : 0
  baseUrl = boundPort ? `http://127.0.0.1:${boundPort}` : null
  if (!baseUrl) throw new Error('slide server failed to bind')
  return baseUrl
}

export async function openSlides(rel: string): Promise<{ url?: string; error?: string }> {
  if (!deckFile(rel)) return { error: 'Not a *.slides.md file in the open workspace' }
  const base = await ensureServer()
  return { url: `${base}/deck/${encodeURIComponent(rel)}` }
}

export function stopSlideServer(): void {
  server?.close()
  server = null
  baseUrl = null
}

/**
 * Register the slide runtime behind webdeck-core. `slidesOpen` is pure Node —
 * it spins up the loopback reveal server and hands back a URL — so it moves off
 * direct Electron IPC with the other CORE domains. The renderer opens the
 * returned URL in a browser tab; that tab-open is the only shell-side step, and
 * it already happens on the renderer with this return value.
 */
export function registerSlidesRpc(): void {
  core.register(IpcChannels.slidesOpen, (rel) => {
    const r = asString(rel)
    return r ? openSlides(r) : { error: 'bad arguments' }
  })
}
