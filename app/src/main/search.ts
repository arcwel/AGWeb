import { spawn } from 'node:child_process'
import { promises as fsp } from 'node:fs'
import { join, relative, sep } from 'node:path'
import { IpcChannels, type SearchHit } from '@shared/ipc'
import { core } from '../core/rpc'
import { asString } from '../core/coerce'
import { getCurrentWorkspace } from './workspace'

/**
 * Project-wide text search. Uses ripgrep when available (fast, gitignore
 * aware); falls back to a pure-Node walk so search works everywhere.
 */

const IGNORED = new Set(['node_modules', '.git', 'out', 'dist', '__pycache__', '.cache'])
const MAX_HITS = 500
const MAX_FILE_BYTES = 1024 * 1024

/** `pinnedRoot` binds the search to a specific workspace (agent sessions); UI
 *  callers omit it and search the live workspace. */
export async function searchWorkspace(
  query: string,
  pinnedRoot?: string | null
): Promise<SearchHit[]> {
  const root = pinnedRoot ?? getCurrentWorkspace()?.path
  if (!root || !query.trim()) return []
  try {
    return await searchWithRipgrep(root, query)
  } catch {
    return searchWithNode(root, query)
  }
}

function searchWithRipgrep(root: string, query: string): Promise<SearchHit[]> {
  return new Promise((resolve, reject) => {
    // stdin must be ignored and a path given explicitly — with a piped stdin
    // and no path, rg searches stdin and blocks forever.
    const rg = spawn(
      'rg',
      ['--json', '--fixed-strings', '--ignore-case', '--max-count', '20', '--', query, '.'],
      { cwd: root, stdio: ['ignore', 'pipe', 'pipe'] }
    )
    const hits: SearchHit[] = []
    let buffer = ''
    rg.on('error', reject) // ENOENT → Node fallback
    rg.stdout.on('data', (chunk: Buffer) => {
      buffer += chunk.toString('utf8')
      const lines = buffer.split('\n')
      buffer = lines.pop() ?? ''
      for (const line of lines) {
        if (hits.length >= MAX_HITS) continue
        try {
          const msg = JSON.parse(line) as {
            type: string
            data?: {
              path?: { text?: string }
              line_number?: number
              lines?: { text?: string }
            }
          }
          if (msg.type !== 'match' || !msg.data?.path?.text) continue
          hits.push({
            path: msg.data.path.text.replace(/^\.\//, ''),
            line: msg.data.line_number ?? 1,
            text: (msg.data.lines?.text ?? '').trim().slice(0, 300)
          })
        } catch {
          // partial line; ignore
        }
      }
    })
    rg.on('close', (code) => {
      // rg exits 1 for "no matches" — that's a valid empty result.
      if (code === 0 || code === 1) resolve(hits)
      else reject(new Error(`rg exited ${code}`))
    })
  })
}

async function searchWithNode(root: string, query: string): Promise<SearchHit[]> {
  const term = query.toLowerCase()
  const hits: SearchHit[] = []

  async function walk(dir: string): Promise<void> {
    if (hits.length >= MAX_HITS) return
    let entries
    try {
      entries = await fsp.readdir(dir, { withFileTypes: true })
    } catch {
      return
    }
    for (const entry of entries) {
      if (hits.length >= MAX_HITS) return
      if (entry.name.startsWith('.') || IGNORED.has(entry.name)) continue
      const full = join(dir, entry.name)
      if (entry.isDirectory()) {
        await walk(full)
      } else if (entry.isFile()) {
        try {
          const stat = await fsp.stat(full)
          if (stat.size > MAX_FILE_BYTES) continue
          const content = await fsp.readFile(full, 'utf8')
          if (content.includes('\0')) continue // binary heuristic
          const lines = content.split('\n')
          let count = 0
          for (let i = 0; i < lines.length && count < 20 && hits.length < MAX_HITS; i++) {
            if (lines[i].toLowerCase().includes(term)) {
              hits.push({
                path: relative(root, full).split(sep).join('/'),
                line: i + 1,
                text: lines[i].trim().slice(0, 300)
              })
              count++
            }
          }
        } catch {
          // unreadable file; skip
        }
      }
    }
  }

  await walk(root)
  return hits
}

/** Register the search domain with webdeck-core (P1). */
export function registerSearchRpc(): void {
  core.register(IpcChannels.searchQuery, (query) => {
    const q = asString(query)
    return q ? searchWorkspace(q) : []
  })
}
