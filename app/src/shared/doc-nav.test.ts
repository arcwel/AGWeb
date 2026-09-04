import { describe, it, expect } from 'vitest'
import { docNavTarget } from './ipc'

/**
 * Browser navigation to a document in the open workspace renders in Document
 * Studio rather than as raw text. The interception was lost when the Electron
 * main process was deleted for the Chromium fork; these cover the decision in
 * its new home, including the cases that must NOT open a local file.
 */
describe('docNavTarget', () => {
  const ws = '/Users/me/project'

  it('returns the workspace-relative path of a document inside the workspace', () => {
    expect(docNavTarget(`file://${ws}/README.md`, ws)).toBe('README.md')
    expect(docNavTarget(`file://${ws}/docs/api.json`, ws)).toBe('docs/api.json')
    expect(docNavTarget(`file://${ws}/data/rows.csv`, ws)).toBe('data/rows.csv')
  })

  it('decodes a percent-escaped path, which is how a browser sends spaces', () => {
    expect(docNavTarget(`file://${ws}/my%20notes.md`, ws)).toBe('my notes.md')
  })

  it('refuses anything outside the workspace', () => {
    expect(docNavTarget('file:///etc/passwd.json', ws)).toBeNull()
    expect(docNavTarget(`file://${ws}/../secrets.md`, ws)).toBeNull()
    expect(docNavTarget('file:///Users/me/project-other/README.md', ws)).toBeNull()
  })

  it('refuses a UNC path, which is not this machine', () => {
    expect(docNavTarget('file://evil.example/project/README.md', ws)).toBeNull()
  })

  it('leaves non-file schemes and non-documents to the browser', () => {
    expect(docNavTarget('https://example.com/README.md', ws)).toBeNull()
    expect(docNavTarget(`file://${ws}/index.html`, ws)).toBeNull()
    expect(docNavTarget(`file://${ws}/photo.png`, ws)).toBeNull()
  })

  it('leaves slide decks to the Reveal.js runtime', () => {
    expect(docNavTarget(`file://${ws}/talk.slides.md`, ws)).toBeNull()
  })

  it('does nothing with no workspace open', () => {
    expect(docNavTarget(`file://${ws}/README.md`, null)).toBeNull()
  })
})
