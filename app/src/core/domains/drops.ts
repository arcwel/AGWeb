import { mkdirSync, writeFileSync, readdirSync, statSync, rmSync } from 'node:fs'
import { join, basename, extname } from 'node:path'
import { randomBytes } from 'node:crypto'
import { Buffer } from 'node:buffer'
import { IpcChannels, isDocFile } from '@shared/ipc'
import { coreEnv } from '../env'
import { core } from '../rpc'
import { asString } from '../coerce'
import { grantFile } from './workspace'

/**
 * Files dropped onto the shell, staged where the browser will open them.
 *
 * A page handed a dropped file gets its bytes, never its path — and the
 * browser refuses to navigate to a path the page names, because the page can
 * read a tab back (GetPageText), which would turn "name a file" into "read any
 * file". So the bytes come here instead: the core writes them into one
 * directory inside its user data dir, and the browser opens files there by a
 * relative name it re-validates. Chromium's own viewers then render them,
 * which for a PDF means its PDF viewer with annotation.
 *
 * Each drop gets its OWN subdirectory rather than a name prefix, so the file
 * keeps the name the user dropped — that name is what the PDF viewer puts in
 * its title bar, and "mtn0crbu-invoice.pdf" is not the file they dropped.
 *
 * A DOCUMENT (markdown, JSON, YAML, CSV, …) does not go to the browser at all.
 * Chromium has no reader for those: markdown and JSON render as raw text in a
 * <pre>, and CSV and YAML are not rendered at all, they are downloaded. WebDeck
 * has the reader — Document Studio — so a dropped document is granted to the
 * file layer and opened there instead. The grant is one file, session-only,
 * and always a file this module just wrote.
 *
 * The directory is a staging area, not storage: it is trimmed on every write.
 */
const DIR_NAME = 'WebDeck Drops'
/** Larger than any document worth previewing inline. */
const MAX_BYTES = 128 * 1024 * 1024
/** Keep the newest few; a drop directory is not a downloads folder. */
const KEEP = 12

function dropDir(): string {
  const dir = join(coreEnv().userDataDir, DIR_NAME)
  mkdirSync(dir, { recursive: true })
  return dir
}

/** A file name safe to write and to hand back: no path, no separators. */
export function safeDropName(raw: string): string {
  // Backslashes first: they are ordinary filename characters on POSIX, so
  // basename() leaves "..\\..\\win.ini" intact and the result keeps a parent
  // reference. Windows is on the roadmap; a name that is safe on one platform
  // and not the other is not safe.
  const flattened = basename(raw.replace(/\\/g, '/'))
  const base = flattened
    .replace(/[^\w.-]+/g, '_')
    // No run of dots survives, so no part of the name can read as "parent".
    .replace(/\.{2,}/g, '.')
    .trim()
  const ext = extname(base).slice(0, 12)
  const stem = base.slice(0, base.length - ext.length).slice(0, 80) || 'file'
  return `${stem}${ext}`
}

/**
 * The folder one drop lands in. Time-ordered so trimming keeps the newest, and
 * salted so two drops in the same millisecond cannot land on each other.
 */
function stageName(): string {
  return `${Date.now().toString(36)}-${randomBytes(3).toString('hex')}`
}

/** Trim the staging area to the newest KEEP drops. */
function trim(dir: string): void {
  try {
    const stages = readdirSync(dir)
      .map((name) => ({ name, at: statSync(join(dir, name)).mtimeMs }))
      .sort((a, b) => b.at - a.at)
    for (const stage of stages.slice(KEEP)) {
      try {
        rmSync(join(dir, stage.name), { recursive: true, force: true })
      } catch {
        // A file still open is not worth failing a drop over.
      }
    }
  } catch {
    // An unreadable directory just means nothing gets trimmed.
  }
}

/**
 * What a dropped file became.
 *
 * `name` is the `<stage>/<name>` the browser opens it by — two bare segments,
 * which the browser re-validates before it navigates. `docPath` is set instead
 * for a document, and is the absolute path Document Studio reads.
 */
export interface StagedDrop {
  name?: string
  docPath?: string
  error?: string
}

/** Write one dropped file and say how it should be opened. */
export function writeDroppedFile(name: string, base64: string): StagedDrop {
  const tooLarge = { error: `That file is larger than ${Math.round(MAX_BYTES / 1024 / 1024)} MB.` }
  // Measure the ENCODED string first. Decoding to find out how big it is means
  // materialising whatever was sent before refusing it, and this handler is a
  // registered RPC, so its argument does not have to have come from a file the
  // renderer measured. Base64 is four characters per three bytes.
  if (base64.length > Math.ceil(MAX_BYTES / 3) * 4 + 4) return tooLarge
  let bytes: Buffer
  try {
    bytes = Buffer.from(base64, 'base64')
  } catch {
    return { error: 'That file could not be read.' }
  }
  if (bytes.length === 0) return { error: 'That file was empty.' }
  if (bytes.length > MAX_BYTES) return tooLarge
  try {
    const dir = dropDir()
    const stage = stageName()
    const safe = safeDropName(name)
    mkdirSync(join(dir, stage), { recursive: true })
    const full = join(dir, stage, safe)
    writeFileSync(full, bytes)
    trim(dir)
    if (isDocFile(safe)) {
      grantFile(full)
      return { docPath: full }
    }
    return { name: `${stage}/${safe}` }
  } catch (error) {
    return { error: error instanceof Error ? error.message : String(error) }
  }
}

/**
 * Re-grant the documents still staged from a previous run.
 *
 * A restored tab strip can hold a doc tab for a file dropped last session.
 * Grants do not persist, so without this the tab would reopen on a file it is
 * no longer allowed to read. These are files this module wrote, in a directory
 * it owns and trims to a dozen, so re-granting them widens nothing beyond what
 * the drop already decided.
 */
function grantStagedDocuments(): void {
  try {
    const dir = dropDir()
    for (const stage of readdirSync(dir)) {
      for (const file of readdirSync(join(dir, stage))) {
        if (isDocFile(file)) grantFile(join(dir, stage, file))
      }
    }
  } catch {
    // Nothing staged, or a stage that is not a directory: nothing to grant.
  }
}

export function registerDropsRpc(): void {
  grantStagedDocuments()
  core.register(IpcChannels.dropsWrite, (name, base64) =>
    writeDroppedFile(asString(name) ?? 'file', asString(base64) ?? '')
  )
}
