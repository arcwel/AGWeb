import { describe, expect, it } from 'vitest'
import { DOC_EXTENSIONS, EDITOR_EXTENSIONS, isDocFile, isEditorFile } from './ipc'

describe('file kinds a dropped file is routed by', () => {
  it('a document goes to Document Studio, source goes to the editor', () => {
    expect(isDocFile('/x/notes.md')).toBe(true)
    expect(isEditorFile('/x/notes.md')).toBe(false)
    expect(isEditorFile('/x/script.py')).toBe(true)
    expect(isDocFile('/x/script.py')).toBe(false)
  })

  it('leaves what Chromium renders to Chromium', () => {
    for (const path of ['/x/a.pdf', '/x/a.png', '/x/a.html', '/x/a.jpg']) {
      expect(isDocFile(path), path).toBe(false)
      expect(isEditorFile(path), path).toBe(false)
    }
  })

  it('never lists a type on both sides', () => {
    for (const ext of EDITOR_EXTENSIONS) expect(DOC_EXTENSIONS.has(ext), ext).toBe(false)
  })

  it('is case-insensitive on the extension', () => {
    expect(isEditorFile('/x/MAIN.PY')).toBe(true)
    expect(isDocFile('/x/README.MD')).toBe(true)
  })
})
