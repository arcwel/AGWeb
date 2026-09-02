import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join, relative, resolve, sep } from 'node:path'
import extract from 'extract-zip'
import { IpcChannels } from '@shared/ipc'
import type { VsxExtension, VsxInstalled } from '@shared/ipc'
import { core } from '../core/rpc'
import { coreEnv } from '../core/env'
import { asString } from '../core/coerce'
import { checkAction } from './policy'
import { ensureLoopbackOrigin } from './slides'

/**
 * VS Code editor extensions from Open VSX (task 12.8).
 *
 * This is the core half: search the registry, download and unpack a `.vsix`,
 * keep the installed set on disk, and hand the renderer the files an extension
 * needs. The renderer half (`editor-extensions.ts`) registers each installed
 * extension with VS Code's services; extensions that carry code run in the
 * web-worker extension host on the loopback origin, never in the WebUI page.
 *
 * SECURITY (see SECURITY.md, "VS Code extensions"):
 *  - Installation is a `command`-class action through the policy engine, so
 *    Secure mode confirms it and a denied rule blocks it — an extension is
 *    third-party code, and installing one is as consequential as running a
 *    command.
 *  - Downloads come only from open-vsx.org over https, are size-capped, and
 *    are unpacked by extract-zip, which refuses zip-slip entries.
 *  - `vsx:read` is path-contained to the extension's own directory: it must
 *    not become a file-read primitive for the renderer.
 *  - The core never executes anything from an extension. It stores bytes.
 */

const OPEN_VSX = 'https://open-vsx.org/api'
const FETCH_TIMEOUT_MS = 30_000
/** A .vsix larger than this is not an editor extension we want to unpack. */
const MAX_VSIX_BYTES = 64 * 1024 * 1024
/** Single-file cap for what the renderer may pull through vsx:read. */
const MAX_FILE_BYTES = 16 * 1024 * 1024

export function extensionsDir(): string {
  return join(coreEnv().userDataDir, 'editor-extensions')
}

/**
 * "publisher.name" or "publisher.name@1.2.3". Strict on purpose: the pieces
 * become URL segments and a directory name, so nothing but a plain identifier
 * may pass — not a slash, not a dot-dot, not a query string.
 */
export function parseExtensionId(
  id: string
): { namespace: string; name: string; version?: string } | null {
  const m = /^([A-Za-z0-9][\w-]*)\.([A-Za-z0-9][\w-]*)(?:@([\w.-]+))?$/.exec(id.trim())
  if (!m) return null
  return { namespace: m[1], name: m[2], version: m[3] }
}

export function installDirName(namespace: string, name: string, version: string): string {
  return `${namespace}.${name}-${version}`
}

/** Resolve `rel` inside `root`, or null if it would escape (`..`, absolute). */
export function containedPath(root: string, rel: string): string | null {
  const base = resolve(root)
  const abs = resolve(base, rel)
  return abs === base || abs.startsWith(base + sep) ? abs : null
}

async function fetchWithTimeout(url: string): Promise<Response> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS)
  try {
    const res = await fetch(url, { signal: controller.signal, redirect: 'follow' })
    if (!res.ok) throw new Error(`${url} -> HTTP ${res.status}`)
    return res
  } finally {
    clearTimeout(timer)
  }
}

async function fetchJson(url: string): Promise<Record<string, unknown>> {
  const res = await fetchWithTimeout(url)
  return (await res.json()) as Record<string, unknown>
}

async function fetchBytes(url: string, max: number): Promise<Buffer> {
  const res = await fetchWithTimeout(url)
  const declared = Number(res.headers.get('content-length') ?? 0)
  if (declared > max) throw new Error(`download is ${declared} bytes, over the ${max} byte cap`)
  const bytes = Buffer.from(await res.arrayBuffer())
  if (bytes.length > max)
    throw new Error(`download is ${bytes.length} bytes, over the ${max} byte cap`)
  return bytes
}

function str(v: unknown): string {
  return typeof v === 'string' ? v : ''
}

function toVsxExtension(e: Record<string, unknown>): VsxExtension {
  const files = (e.files ?? {}) as Record<string, unknown>
  return {
    id: `${str(e.namespace)}.${str(e.name)}`,
    namespace: str(e.namespace),
    name: str(e.name),
    version: str(e.version),
    displayName: str(e.displayName) || str(e.name),
    description: str(e.description),
    downloadCount: typeof e.downloadCount === 'number' ? e.downloadCount : 0,
    verified: e.verified === true,
    icon: str(files.icon) || undefined
  }
}

export async function searchOpenVsx(query: string): Promise<VsxExtension[]> {
  const q = query.trim()
  if (!q) return []
  const json = await fetchJson(`${OPEN_VSX}/-/search?query=${encodeURIComponent(q)}&size=24`)
  const list = Array.isArray(json.extensions) ? (json.extensions as Record<string, unknown>[]) : []
  return list.map(toVsxExtension)
}

/** Every file under an extension root, as extension-relative posix paths. */
function walk(root: string, dir = root, out: string[] = []): string[] {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name)
    if (entry.isDirectory()) walk(root, full, out)
    else if (entry.isFile()) out.push(relative(root, full).split(sep).join('/'))
  }
  return out
}

function installedRecord(installDir: string): VsxInstalled | null {
  const root = join(installDir, 'extension')
  const manifestPath = join(root, 'package.json')
  if (!existsSync(manifestPath)) return null
  let manifest: Record<string, unknown>
  try {
    manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as Record<string, unknown>
  } catch {
    return null
  }
  const publisher = str(manifest.publisher)
  const name = str(manifest.name)
  if (!publisher || !name) return null
  const nls = readNls(join(root, 'package.nls.json'))
  return {
    id: `${publisher}.${name}`,
    dir: installDir.split(sep).pop() ?? '',
    version: str(manifest.version),
    displayName: resolveNls(str(manifest.displayName), nls) || name,
    description: resolveNls(str(manifest.description), nls),
    manifest,
    files: walk(root)
  }
}

/** The extension's default translations, if it ships any. */
function readNls(path: string): Record<string, string> {
  if (!existsSync(path)) return {}
  try {
    const parsed = JSON.parse(readFileSync(path, 'utf8')) as Record<string, unknown>
    return Object.fromEntries(
      Object.entries(parsed).filter((e): e is [string, string] => typeof e[1] === 'string')
    )
  } catch {
    return {}
  }
}

/**
 * A manifest string is either literal or a `%key%` into package.nls.json —
 * the same convention VS Code resolves before showing a name anywhere.
 * Unknown keys fall back to the raw value rather than an empty label.
 */
export function resolveNls(value: string, nls: Record<string, string>): string {
  const match = /^%(.+)%$/.exec(value)
  if (!match) return value
  return nls[match[1]] ?? value
}

export function listInstalled(): VsxInstalled[] {
  const dir = extensionsDir()
  if (!existsSync(dir)) return []
  return readdirSync(dir, { withFileTypes: true })
    .filter((e) => e.isDirectory())
    .map((e) => installedRecord(join(dir, e.name)))
    .filter((r): r is VsxInstalled => r !== null)
}

export async function installExtension(
  id: string,
  sessionId = 'editor-extensions'
): Promise<VsxInstalled> {
  const parsed = parseExtensionId(id)
  if (!parsed) throw new Error(`not an extension id: "${id}" (expected publisher.name[@version])`)
  const allowed = await checkAction('command', `install editor extension ${id}`, sessionId)
  if (!allowed) throw new Error(`installing ${id} was denied by the policy engine`)

  const { namespace, name } = parsed
  const meta = await fetchJson(
    parsed.version
      ? `${OPEN_VSX}/${namespace}/${name}/${parsed.version}`
      : `${OPEN_VSX}/${namespace}/${name}`
  )
  const version = str(meta.version)
  const download = str(((meta.files ?? {}) as Record<string, unknown>).download)
  if (!version || !download) throw new Error(`Open VSX has no downloadable build for ${id}`)
  // Only the registry itself, over TLS. A metadata document pointing elsewhere
  // is not something to follow.
  if (!download.startsWith('https://open-vsx.org/')) {
    throw new Error(`refusing a download outside open-vsx.org: ${download}`)
  }

  const bytes = await fetchBytes(download, MAX_VSIX_BYTES)
  const tmp = join(tmpdir(), `wd-vsix-${process.pid}-${Date.now()}.vsix`)
  writeFileSync(tmp, bytes)
  const dest = join(extensionsDir(), installDirName(namespace, name, version))
  rmSync(dest, { recursive: true, force: true })
  mkdirSync(dest, { recursive: true })
  try {
    // extract-zip rejects entries that resolve outside `dir` (zip-slip).
    await extract(tmp, { dir: dest })
  } finally {
    rmSync(tmp, { force: true })
  }
  const record = installedRecord(dest)
  if (!record) {
    rmSync(dest, { recursive: true, force: true })
    throw new Error(`${id} unpacked without an extension/package.json — not a VS Code extension`)
  }
  return record
}

export function uninstallExtension(id: string): boolean {
  const parsed = parseExtensionId(id)
  if (!parsed) return false
  const target = `${parsed.namespace}.${parsed.name}`
  let removed = false
  for (const rec of listInstalled()) {
    if (rec.id !== target) continue
    rmSync(join(extensionsDir(), rec.dir), { recursive: true, force: true })
    removed = true
  }
  return removed
}

/**
 * One file of an installed extension, base64 so the renderer can turn it into
 * a data: URI for VS Code's file service. `dirName` is an install directory
 * name (no path separators) and `rel` is contained to that extension's root —
 * this must never read outside `editor-extensions/`.
 */
export function readExtensionFile(dirName: string, rel: string): { base64: string } | null {
  if (!/^[A-Za-z0-9][\w.-]*$/.test(dirName)) return null
  const root = join(extensionsDir(), dirName, 'extension')
  const abs = containedPath(root, rel)
  if (!abs || !existsSync(abs)) return null
  const stat = statSync(abs)
  if (!stat.isFile() || stat.size > MAX_FILE_BYTES) return null
  return { base64: readFileSync(abs).toString('base64') }
}

export function registerVsxRpc(): void {
  core.register(IpcChannels.vsxSearch, (query) => searchOpenVsx(asString(query) ?? ''))
  core.register(IpcChannels.vsxInstall, (id) => installExtension(asString(id) ?? ''))
  core.register(IpcChannels.vsxUninstall, (id) => uninstallExtension(asString(id) ?? ''))
  core.register(IpcChannels.vsxList, () => listInstalled())
  core.register(IpcChannels.vsxRead, (dir, rel) =>
    readExtensionFile(asString(dir) ?? '', asString(rel) ?? '')
  )
  // The origin the extension-host iframe is served from — distinct from
  // chrome://webdeck, which is the whole point.
  core.register(IpcChannels.vsxHostOrigin, () => ensureLoopbackOrigin())
}
