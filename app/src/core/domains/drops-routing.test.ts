import { describe, it, expect, afterAll } from 'vitest'
import { Buffer } from 'node:buffer'
import { existsSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { setCoreEnv } from '../env'

const dir = join(tmpdir(), `wd-drops-routing-${process.pid}`)
setCoreEnv({
  userDataDir: dir,
  homeDir: dir,
  appDir: dir,
  secrets: {
    isAvailable: () => false,
    encryptString: (s) => Buffer.from(s),
    decryptString: (b) => b.toString()
  }
})

const { writeDroppedFile } = await import('./drops')
const { readFile } = await import('./fs')
const { isGrantedFile } = await import('./workspace')

afterAll(() => rmSync(dir, { recursive: true, force: true }))

const drop = (name: string, body: string): ReturnType<typeof writeDroppedFile> =>
  writeDroppedFile(name, Buffer.from(body, 'utf8').toString('base64'))

/**
 * Chromium has no reader for a document: markdown and JSON come out as raw
 * text, and CSV and YAML are not shown at all, they are downloaded. So a
 * dropped document must not be handed to the browser — it goes to Document
 * Studio, which needs a read grant on that one file.
 */
describe('a dropped document', () => {
  it('is routed to Document Studio, not to the browser', () => {
    for (const name of ['notes.md', 'data.json', 'conf.yaml', 'rows.csv', 'feed.xml']) {
      const staged = drop(name, 'x')
      expect(staged.error).toBeUndefined()
      expect(staged.docPath, `${name} should open as a document`).toBeTruthy()
      expect(staged.name, `${name} should not go to the browser`).toBeUndefined()
    }
  })

  it('keeps the name the user dropped', () => {
    const staged = drop('Quarterly Report.md', '# hi')
    expect(staged.docPath?.endsWith('/Quarterly_Report.md')).toBe(true)
  })

  it('is granted, so Document Studio can read it with no project open', async () => {
    const staged = drop('readme.md', '# Heading\n')
    expect(isGrantedFile(staged.docPath ?? '')).toBe(true)
    // No workspace has been opened in this test at all.
    const read = await readFile(staged.docPath ?? '')
    expect(read.content).toBe('# Heading\n')
  })

  it('grants that file and nothing beside it', async () => {
    const staged = drop('one.md', 'first')
    const sibling = join(staged.docPath!.slice(0, staged.docPath!.lastIndexOf('/')), 'other.md')
    expect(isGrantedFile(sibling)).toBe(false)
    expect((await readFile('/etc/hosts')).error).toBeTruthy()
  })
})

/** Everything Chromium does render properly still goes to Chromium. */
describe('a dropped file the browser can render', () => {
  it('goes to the browser by staged name', () => {
    for (const name of ['report.pdf', 'photo.png', 'page.html', 'notes.txt']) {
      const staged = drop(name, 'x')
      expect(staged.name, `${name} should go to the browser`).toBeTruthy()
      expect(staged.docPath).toBeUndefined()
      expect(staged.name?.split('/')).toHaveLength(2)
    }
  })

  it('is not granted to the file layer', () => {
    const staged = drop('report.pdf', 'x')
    expect(existsSync(dir)).toBe(true)
    expect(isGrantedFile(staged.name ?? '')).toBe(false)
  })
})

/**
 * The staging RPC is registered, so its argument is not necessarily a file the
 * renderer already measured. The cap has to hold on what was actually sent.
 */
describe('the size cap', () => {
  it('refuses an oversized payload without decoding it first', () => {
    // 129 MB of base64, which would be ~96 MB decoded. Refused on the encoded
    // length, so nothing this large is ever materialised.
    const huge = 'A'.repeat(200 * 1024 * 1024)
    const staged = writeDroppedFile('big.pdf', huge)
    expect(staged.error).toMatch(/larger than/)
    expect(staged.name).toBeUndefined()
    expect(staged.docPath).toBeUndefined()
  })

  it('still refuses an empty file', () => {
    expect(writeDroppedFile('empty.pdf', '').error).toBe('That file was empty.')
  })
})

/**
 * The staging area is a staging area, not a downloads folder, and the grants
 * over it have to survive the core restarting under a restored tab strip.
 */
describe('the staging area', () => {
  it('keeps only the newest dozen drops', async () => {
    const { readdirSync } = await import('node:fs')
    const { join } = await import('node:path')
    const stagingRoot = join(dir, 'WebDeck Drops')
    const kept: string[] = []
    for (let i = 0; i < 15; i++) {
      const staged = drop(`file-${i}.pdf`, `body ${i}`)
      kept.push(staged.name!.split('/')[0])
      // Distinct mtimes, so "newest" is well defined rather than arbitrary.
      await new Promise((r) => setTimeout(r, 5))
    }
    const remaining = readdirSync(stagingRoot)
    expect(remaining.length).toBeLessThanOrEqual(12)
    // The three oldest are gone and the newest is still there.
    expect(remaining).not.toContain(kept[0])
    expect(remaining).toContain(kept[kept.length - 1])
  })

  it('re-grants staged documents when the core starts again', async () => {
    const { openWorkspacePath } = await import('./workspace')
    const { registerDropsRpc } = await import('./drops')
    const staged = drop('restored.md', '# still readable')
    expect(isGrantedFile(staged.docPath!)).toBe(true)

    // Grants do not persist. Opening a project drops the previous session's,
    // which is the same state the core comes up in after a restart.
    openWorkspacePath(dir)
    expect(isGrantedFile(staged.docPath!)).toBe(false)

    // Startup walks the staging area and grants what is still there, so a
    // restored doc tab opens instead of reporting a file it may not read.
    registerDropsRpc()
    expect(isGrantedFile(staged.docPath!)).toBe(true)
    expect((await readFile(staged.docPath!)).content).toBe('# still readable')
  })
})
