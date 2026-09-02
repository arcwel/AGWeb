import { describe, expect, it } from 'vitest'
import type { BlockGroup } from '@shared/deck'
import {
  UNMEASURED_CAPACITY,
  capacityFor,
  foldZone,
  insertGroup,
  placeBlock,
  placeGroup
} from './deck-capacity'

let n = 0
const group = (zone: BlockGroup['zone'], ...blockIds: string[]): BlockGroup => ({
  id: `g${++n}`,
  zone,
  blockIds,
  activeBlockId: blockIds[0]
})
const fresh = (): BlockGroup => group('right')
const ids = (groups: BlockGroup[], zone: BlockGroup['zone']): string[][] =>
  groups.filter((g) => g.zone === zone).map((g) => g.blockIds)

describe('capacityFor', () => {
  it('counts whole groups at the minimum size, gap included', () => {
    // Arrange: 800px column, 260px groups, 6px gaps → 3 fit (3×260 + 2×6 = 792)
    expect(capacityFor(800, 260, 6)).toBe(3)
    expect(capacityFor(790, 260, 6)).toBe(2)
  })
  it('never reports less than one, and stays unmeasured for a zero size', () => {
    expect(capacityFor(100, 260, 6)).toBe(1)
    expect(capacityFor(0, 260, 6)).toBe(UNMEASURED_CAPACITY)
  })
})

describe('placeBlock', () => {
  it('opens a new group while the zone has room', () => {
    const groups = [group('right', 'a')]
    const out = placeBlock(groups, 'right', 'b', 2, fresh)
    expect(ids(out, 'right')).toEqual([['a'], ['b']])
  })

  it('becomes a tab in the last group once the zone is full — never a third stack', () => {
    const groups = [group('right', 'a'), group('right', 'b')]
    const out = placeBlock(groups, 'right', 'c', 2, fresh)
    expect(ids(out, 'right')).toEqual([['a'], ['b', 'c']])
    expect(out[1].activeBlockId).toBe('c')
  })

  it('always opens a group in an empty zone, even at capacity 0', () => {
    expect(ids(placeBlock([], 'bottom', 'a', 0, fresh), 'bottom')).toEqual([['a']])
  })

  it('leaves other zones alone', () => {
    const groups = [group('bottom', 'x'), group('right', 'a')]
    const out = placeBlock(groups, 'right', 'b', 1, fresh)
    expect(ids(out, 'bottom')).toEqual([['x']])
    expect(ids(out, 'right')).toEqual([['a', 'b']])
  })
})

describe('placeGroup', () => {
  it('keeps a moved stack when it fits, merges it when it does not', () => {
    const moved = group('bottom', 'm1', 'm2')
    const groups = [group('right', 'a'), moved]
    expect(ids(placeGroup(groups, moved, 'right', 2), 'right')).toEqual([['a'], ['m1', 'm2']])
    expect(ids(placeGroup(groups, moved, 'right', 1), 'right')).toEqual([['a', 'm1', 'm2']])
  })
})

describe('foldZone', () => {
  it('folds surplus groups into the one before them, last first', () => {
    const groups = [group('right', 'a'), group('right', 'b'), group('right', 'c', 'c2')]
    const out = foldZone(groups, 'right', 1)
    expect(ids(out, 'right')).toEqual([['a', 'b', 'c', 'c2']])
    expect(out[0].activeBlockId).toBe('c')
  })
  it('is a no-op within capacity', () => {
    const groups = [group('right', 'a'), group('right', 'b')]
    expect(foldZone(groups, 'right', 2)).toBe(groups)
  })
})

describe('insertGroup', () => {
  it('inserts at the index then folds the zone', () => {
    const groups = [group('right', 'a'), group('right', 'b')]
    const out = insertGroup(groups, group('right', 'r'), 1, 2)
    expect(ids(out, 'right')).toEqual([['a'], ['r', 'b']])
  })
  it('never folds floating groups', () => {
    const out = insertGroup([group('floating', 'f')], group('floating', 'g'), 9, 1)
    expect(out).toHaveLength(2)
  })
})
