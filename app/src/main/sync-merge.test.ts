import { describe, it, expect } from 'vitest'
import {
  emptyDoc,
  mergeLocalIntoDoc,
  normalizeDoc,
  sectionsToApply,
  seenFromDoc,
  valueEquals,
  type SyncDoc
} from './sync-merge'

describe('normalizeDoc', () => {
  it('returns an empty doc for junk input', () => {
    expect(normalizeDoc(null).sections).toEqual({})
    expect(normalizeDoc('nope').sections).toEqual({})
    expect(normalizeDoc({ sections: 5 }).sections).toEqual({})
  })

  it('ignores a __proto__ section key (no prototype pollution)', () => {
    // Object literals set the prototype; JSON.parse makes __proto__ an OWN key.
    const raw = JSON.parse(
      '{"sections":{"__proto__":{"value":{"polluted":true},"updatedAt":1},"theme":{"value":"dark","updatedAt":1}}}'
    )
    const doc = normalizeDoc(raw)
    expect(Object.keys(doc.sections)).toEqual(['theme'])
    expect(({} as Record<string, unknown>).polluted).toBeUndefined()
  })

  it('keeps well-formed sections and drops entries without a numeric updatedAt', () => {
    const doc = normalizeDoc({
      sections: {
        theme: { value: 'dark', updatedAt: 100, device: 'mac' },
        broken: { value: 'x' }, // no updatedAt
        alsoBroken: 7
      }
    })
    expect(Object.keys(doc.sections)).toEqual(['theme'])
    expect(doc.sections.theme).toEqual({ value: 'dark', updatedAt: 100, device: 'mac' })
  })
})

describe('valueEquals', () => {
  it('compares structurally and treats undefined as null', () => {
    expect(valueEquals({ a: 1, b: 2 }, { a: 1, b: 2 })).toBe(true)
    expect(valueEquals(['x'], ['x'])).toBe(true)
    expect(valueEquals({ a: 1 }, { a: 2 })).toBe(false)
    expect(valueEquals(undefined, null)).toBe(true)
  })
})

describe('mergeLocalIntoDoc', () => {
  it('adds new sections with the given timestamp and device', () => {
    const { doc, changed } = mergeLocalIntoDoc(emptyDoc(), { theme: 'dark' }, 1000, 'mac')
    expect(changed).toEqual(['theme'])
    expect(doc.sections.theme).toEqual({ value: 'dark', updatedAt: 1000, device: 'mac' })
  })

  it('does NOT bump updatedAt for an unchanged value (no stealing last-writer)', () => {
    const base: SyncDoc = {
      version: 1,
      sections: { theme: { value: 'dark', updatedAt: 500, device: 'other' } }
    }
    const { doc, changed } = mergeLocalIntoDoc(base, { theme: 'dark' }, 9999, 'mac')
    expect(changed).toEqual([])
    expect(doc.sections.theme).toEqual({ value: 'dark', updatedAt: 500, device: 'other' })
  })

  it('bumps updatedAt + device when the local value differs', () => {
    const base: SyncDoc = {
      version: 1,
      sections: { theme: { value: 'dark', updatedAt: 500, device: 'other' } }
    }
    const { doc, changed } = mergeLocalIntoDoc(base, { theme: 'light' }, 9999, 'mac')
    expect(changed).toEqual(['theme'])
    expect(doc.sections.theme).toEqual({ value: 'light', updatedAt: 9999, device: 'mac' })
  })

  it('skips an unsafe __proto__ local key', () => {
    const locals = JSON.parse('{"__proto__":{"x":1},"theme":"dark"}')
    const { doc, changed } = mergeLocalIntoDoc(emptyDoc(), locals, 1, 'd')
    expect(changed).toEqual(['theme'])
    expect(Object.keys(doc.sections)).toEqual(['theme'])
  })

  it('leaves untouched sections intact when merging a different one', () => {
    const base: SyncDoc = {
      version: 1,
      sections: { policy: { value: { mode: 'review' }, updatedAt: 300 } }
    }
    const { doc } = mergeLocalIntoDoc(base, { model: 'claude-opus-5' }, 700, 'mac')
    expect(doc.sections.policy).toEqual({ value: { mode: 'review' }, updatedAt: 300 })
    expect(doc.sections.model.value).toBe('claude-opus-5')
  })
})

describe('sectionsToApply', () => {
  const doc: SyncDoc = {
    version: 1,
    sections: {
      theme: { value: 'dark', updatedAt: 200 },
      model: { value: 'claude-sonnet-5', updatedAt: 400 }
    }
  }

  it('returns sections strictly newer than what we have seen', () => {
    const out = sectionsToApply(doc, { theme: 200, model: 100 })
    expect(out).toEqual([{ key: 'model', value: 'claude-sonnet-5', updatedAt: 400 }])
  })

  it('applies everything when nothing has been seen', () => {
    const out = sectionsToApply(doc, {})
    expect(out.map((s) => s.key).sort()).toEqual(['model', 'theme'])
  })

  it('applies nothing when caught up', () => {
    expect(sectionsToApply(doc, { theme: 200, model: 400 })).toEqual([])
  })
})

describe('two-device convergence (last-writer-wins per section)', () => {
  it('a newer write on device B wins and A applies it, then stops thrashing', () => {
    // Device A wrote theme=dark at t=100.
    let file: SyncDoc = mergeLocalIntoDoc(emptyDoc(), { theme: 'dark' }, 100, 'A').doc
    // Device B pulls (sees dark), then the user on B switches to light at t=200.
    expect(seenFromDoc(file)).toEqual({ theme: 100 })
    file = mergeLocalIntoDoc(file, { theme: 'light' }, 200, 'B').doc
    expect(file.sections.theme).toMatchObject({ value: 'light', updatedAt: 200, device: 'B' })
    // Device A pulls: light is newer than A's seen (100) -> A applies it.
    const toApply = sectionsToApply(file, { theme: 100 })
    expect(toApply).toEqual([{ key: 'theme', value: 'light', updatedAt: 200 }])
    // A now local=light; A's next push must NOT bump the timestamp (converged).
    const after = mergeLocalIntoDoc(file, { theme: 'light' }, 999, 'A')
    expect(after.changed).toEqual([])
  })
})
