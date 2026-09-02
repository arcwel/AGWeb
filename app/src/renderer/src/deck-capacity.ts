import type { BlockGroup, DockZone } from '@shared/deck'

/**
 * Blocks never sit on top of each other (Anthony, 2026-09-01).
 *
 * A zone holds as many groups (stacks) as fit at the minimum group size —
 * its *capacity*, measured live by the zone view. Past that, a block does not
 * open a new group that would be clipped or scrolled out of sight; it joins the
 * zone's last group as a tab. When capacity shrinks (window resized), surplus
 * groups fold into their neighbour the same way. Every path that creates a
 * group in a dock zone goes through here so the rule cannot be bypassed.
 */

export const UNMEASURED_CAPACITY = 99

/** How many groups fit along `size` px when each needs `minSize` and `gap` between. */
export function capacityFor(size: number, minSize: number, gap: number): number {
  if (!(size > 0) || !(minSize > 0)) return UNMEASURED_CAPACITY
  return Math.max(1, Math.floor((size + gap) / (minSize + gap)))
}

export function zoneGroups(groups: BlockGroup[], zone: DockZone): BlockGroup[] {
  return groups.filter((g) => g.zone === zone)
}

function addTab(group: BlockGroup, blockIds: string[], active: string): BlockGroup {
  return { ...group, blockIds: [...group.blockIds, ...blockIds], activeBlockId: active }
}

/**
 * Put `blockId` into `zone`: a new group (from `fresh`) when one more fits,
 * otherwise a tab in the zone's last group.
 */
export function placeBlock(
  groups: BlockGroup[],
  zone: DockZone,
  blockId: string,
  capacity: number,
  fresh: () => BlockGroup
): BlockGroup[] {
  const inZone = zoneGroups(groups, zone)
  if (inZone.length < capacity || inZone.length === 0) {
    return [...groups, { ...fresh(), zone, blockIds: [blockId], activeBlockId: blockId }]
  }
  const host = inZone[inZone.length - 1]
  return groups.map((g) => (g.id === host.id ? addTab(g, [blockId], blockId) : g))
}

/** Move a whole group into `zone`: kept as a stack if it fits, else merged into the last one. */
export function placeGroup(
  groups: BlockGroup[],
  moved: BlockGroup,
  zone: DockZone,
  capacity: number
): BlockGroup[] {
  const rest = groups.filter((g) => g.id !== moved.id)
  const inZone = zoneGroups(rest, zone)
  if (inZone.length < capacity || inZone.length === 0) return [...rest, { ...moved, zone }]
  const host = inZone[inZone.length - 1]
  return rest.map((g) =>
    g.id === host.id ? addTab(g, moved.blockIds, moved.activeBlockId ?? moved.blockIds[0]) : g
  )
}

/** Fold the zone's surplus groups (last first) into the group before them. */
export function foldZone(groups: BlockGroup[], zone: DockZone, capacity: number): BlockGroup[] {
  let out = groups
  for (;;) {
    const inZone = zoneGroups(out, zone)
    if (inZone.length <= Math.max(1, capacity)) return out
    const last = inZone[inZone.length - 1]
    const host = inZone[inZone.length - 2]
    out = out
      .filter((g) => g.id !== last.id)
      .map((g) =>
        g.id === host.id ? addTab(g, last.blockIds, last.activeBlockId ?? last.blockIds[0]) : g
      )
  }
}

/** Insert `group` at `index`, then fold its zone back within capacity. */
export function insertGroup(
  groups: BlockGroup[],
  group: BlockGroup,
  index: number,
  capacity: number
): BlockGroup[] {
  const at = Math.max(0, Math.min(index, groups.length))
  const inserted = [...groups.slice(0, at), group, ...groups.slice(at)]
  return group.zone === 'floating' ? inserted : foldZone(inserted, group.zone, capacity)
}
