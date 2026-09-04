import { describe, it, expect, beforeEach, afterAll } from 'vitest'
import { createHmac, randomBytes } from 'node:crypto'
import { Buffer } from 'node:buffer'
import { mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { setCoreEnv } from '../env'

/**
 * A local file opens where it lives, and the page carries its path.
 *
 * That is only safe because naming a path is not what opens it. The BROWSER
 * signs the path when the user picks or drops the file, with a key the page
 * never holds, and the core checks that signature before granting anything.
 * These tests pin both halves: a real signature opens the file, and nothing
 * else does.
 */

const dir = join(tmpdir(), `wd-grants-${process.pid}`)
mkdirSync(dir, { recursive: true })
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

const { openSignedPath, isSignedPath } = await import('./file-grants')
const { readFile, writeFile } = await import('./fs')

/** Must match kGrantContext in webdeck_core_service.cc. */
const CONTEXT = 'webdeck-open-file\n'
const KEY = randomBytes(32)

/** What the browser sends: HMAC over the context and the path. */
const sign = (path: string, key = KEY): string =>
  createHmac('sha256', key)
    .update(CONTEXT + path)
    .digest('base64')

const doc = join(dir, 'notes.md')
writeFileSync(doc, '# from the panel\n')

beforeEach(() => {
  process.env.WEBDECK_GRANT_KEY = KEY.toString('base64')
})
afterAll(() => {
  delete process.env.WEBDECK_GRANT_KEY
  rmSync(dir, { recursive: true, force: true })
})

describe('a path the browser signed', () => {
  it('opens, and the core can read it with no project open', async () => {
    const opened = openSignedPath(doc, sign(doc))

    expect(opened.path).toBe(doc)
    expect((await readFile(doc)).content).toBe('# from the panel\n')
  })

  it('is writable, so a document opened from anywhere can be saved', async () => {
    openSignedPath(doc, sign(doc))

    const written = await writeFile(doc, '# edited in place\n')

    expect(written.error).toBeUndefined()
    expect((await readFile(doc)).content).toBe('# edited in place\n')
  })
})

describe('a path the browser did not sign', () => {
  it('is refused, whatever the page claims', async () => {
    const other = join(dir, 'secret.md')
    writeFileSync(other, 'not chosen by anyone\n')

    // Every shape a taken-over page might try: no signature, a signature for a
    // different file, a signature made with the wrong key, and rubbish.
    for (const auth of ['', sign(doc), sign(other, randomBytes(32)), 'AAAA']) {
      expect(openSignedPath(other, auth).path, auth || '(empty)').toBeUndefined()
    }
    expect((await readFile(other)).error).toBeTruthy()
  })

  it('is refused for a relative path or one that is not in plain form', () => {
    expect(openSignedPath('notes.md', sign('notes.md')).error).toBe('That is not a file path.')
    const sneaky = `${dir}/../${dir.split('/').pop()}/notes.md`
    // It resolves to the same file, but signature and grant must be the same
    // string or the check and the grant are about different things.
    expect(openSignedPath(sneaky, sign(sneaky)).error).toMatch(/plain form/)
  })

  it('is refused when no key was given, rather than accepted', () => {
    delete process.env.WEBDECK_GRANT_KEY

    // A core started without the browser can grant nothing at all. Failing
    // closed matters more here than anywhere: the alternative is a core that
    // treats every unsigned path as signed.
    expect(isSignedPath(doc, sign(doc))).toBe(false)
    expect(openSignedPath(doc, sign(doc)).error).toMatch(/did not open/)
  })

  it('is refused when the key is too short to be one of ours', () => {
    process.env.WEBDECK_GRANT_KEY = Buffer.from('short').toString('base64')
    expect(isSignedPath(doc, sign(doc, Buffer.from('short')))).toBe(false)
  })
})
