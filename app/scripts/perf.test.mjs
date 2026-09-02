import { describe, it, expect } from 'vitest'
import { EXIT_OK, EXIT_THRESHOLD, checkThresholds, processTree, summarize } from './perf.mjs'

// The pure half: tree walking, the memory roll-up, and the threshold verdict.
// The browser launch and ps calls are passed in as data, so nothing here
// touches a process.

const procs = [
  { pid: 10, ppid: 1, rssMb: 200, command: '/x/Arcwel WebDeck --user-data-dir=/p' },
  { pid: 11, ppid: 10, rssMb: 80, command: '/x/Helper --type=renderer --user-data-dir=/p' },
  { pid: 12, ppid: 10, rssMb: 60, command: '/x/Helper --type=gpu-process --user-data-dir=/p' },
  {
    pid: 13,
    ppid: 10,
    rssMb: 40,
    command: '/x/Helper --type=utility --utility-sub-type=network.mojom.NetworkService'
  },
  // spawned WITHOUT --user-data-dir — the reason the walk is by ppid
  { pid: 14, ppid: 10, rssMb: 120, command: '/x/webdeck-core --port=0 --port-file=/t/core.json' },
  { pid: 15, ppid: 14, rssMb: 5, command: '/bin/zsh' },
  { pid: 99, ppid: 1, rssMb: 999, command: 'unrelated' }
]

describe('processTree', () => {
  it('collects the browser and every descendant, including the core and its children', () => {
    const pids = processTree(10, procs)
      .map((p) => p.pid)
      .sort()
    expect(pids).toEqual([10, 11, 12, 13, 14, 15])
  })

  it('classifies processes by role', () => {
    const types = Object.fromEntries(processTree(10, procs).map((p) => [p.pid, p.type]))
    expect(types[10]).toBe('browser')
    expect(types[11]).toBe('renderer')
    expect(types[13]).toBe('utility:network')
    expect(types[14]).toBe('webdeck-core')
  })

  it('never pulls in an unrelated process', () => {
    expect(processTree(10, procs).some((p) => p.pid === 99)).toBe(false)
  })
})

describe('summarize', () => {
  it('sums RSS and breaks it down by type, largest first', () => {
    const s = summarize(processTree(10, procs))
    expect(s.totalMb).toBe(505)
    expect(s.processes).toBe(6)
    expect(Object.keys(s.byType)[0]).toBe('browser')
    expect(s.byType['webdeck-core']).toBe(120)
  })
})

describe('checkThresholds', () => {
  const result = {
    startup: { shellMs: 2500 },
    memory: { settled: { totalMb: 900 }, perTabMb: 45 }
  }

  it('passes when every limit is met or absent', () => {
    expect(checkThresholds(result, {})).toEqual([])
    expect(checkThresholds(result, { startupMs: 3000, rssMb: 1000, tabMb: 50 })).toEqual([])
  })

  it('names each breached limit', () => {
    const breaches = checkThresholds(result, { startupMs: 2000, rssMb: 800, tabMb: 40 })
    expect(breaches).toHaveLength(3)
    expect(breaches[0]).toMatch(/startup 2500 ms > 2000 ms/)
  })

  it('exit codes are distinct', () => {
    expect(EXIT_OK).toBe(0)
    expect(EXIT_THRESHOLD).toBe(1)
  })
})
