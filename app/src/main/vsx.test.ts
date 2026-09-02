import { describe, it, expect } from 'vitest'
import { containedPath, installDirName, parseExtensionId, resolveNls } from './vsx'

describe('resolveNls', () => {
  const nls = { 'ext.displayName': 'Hex Editor' }
  it('resolves a %key% through package.nls.json', () => {
    expect(resolveNls('%ext.displayName%', nls)).toBe('Hex Editor')
  })
  it('leaves literals and unknown keys as they are', () => {
    expect(resolveNls('Plain Name', nls)).toBe('Plain Name')
    expect(resolveNls('%missing%', nls)).toBe('%missing%')
  })
})

// The pure half: id parsing (which becomes URL segments and a directory name)
// and path containment (which keeps vsx:read inside the extension). Network,
// unpacking and the policy gate are exercised end to end, not here.

describe('parseExtensionId', () => {
  it('accepts publisher.name and an optional @version', () => {
    expect(parseExtensionId('dracula-theme.theme-dracula')).toEqual({
      namespace: 'dracula-theme',
      name: 'theme-dracula',
      version: undefined
    })
    expect(parseExtensionId('ms-python.python@2024.1.0')).toEqual({
      namespace: 'ms-python',
      name: 'python',
      version: '2024.1.0'
    })
  })

  it('rejects anything that could ride into a URL or a path', () => {
    for (const bad of [
      '',
      'noDot',
      'a/b.c',
      '../x.y',
      'a.b/../c',
      'a.b?x=1',
      'a.b@1.0/../..',
      ' a.b c'
    ]) {
      expect(parseExtensionId(bad)).toBeNull()
    }
  })
})

describe('installDirName', () => {
  it('is publisher.name-version', () => {
    expect(installDirName('dracula-theme', 'theme-dracula', '2.25.1')).toBe(
      'dracula-theme.theme-dracula-2.25.1'
    )
  })
})

describe('containedPath', () => {
  const root = '/data/editor-extensions/pub.ext-1.0.0/extension'

  it('resolves paths inside the root', () => {
    expect(containedPath(root, 'package.json')).toBe(`${root}/package.json`)
    expect(containedPath(root, 'themes/dark.json')).toBe(`${root}/themes/dark.json`)
    expect(containedPath(root, '.')).toBe(root)
  })

  it('refuses escapes — dot-dot, absolute, and prefix look-alikes', () => {
    expect(containedPath(root, '../../secrets.json')).toBeNull()
    expect(containedPath(root, '/etc/passwd')).toBeNull()
    expect(containedPath(root, 'a/../../x')).toBeNull()
    // "/data/editor-extensions/pub.ext-1.0.0/extensionEVIL" starts with the
    // root string but is a sibling, not a child.
    expect(containedPath(root, '../extensionEVIL/x')).toBeNull()
  })
})
