import { useMemo, useRef, useState } from 'react'
import { useShellStore } from '@/store'

/**
 * Interactive node-graph view for structured documents (JSON/YAML/TOML):
 * containers become nodes listing their scalar fields, child containers hang
 * to the right (JSON Crack-style left-to-right tree). Pan by dragging, zoom
 * with the wheel, click a node header to collapse its subtree.
 */

type Json = null | boolean | number | string | Json[] | { [key: string]: Json }

const NODE_W = 230
const ROW_H = 18
const HEADER_H = 24
const H_GAP = 70
const V_GAP = 14
const NODE_CAP = 1200

interface GraphNode {
  id: string
  label: string
  badge: string
  rows: { k: string; v: string }[]
  childIds: string[]
  x: number
  y: number
  h: number
}

function preview(value: Json): string {
  if (value === null) return 'null'
  if (typeof value === 'string') return JSON.stringify(value)
  return String(value)
}

function buildNodes(data: Json): {
  nodes: Map<string, GraphNode>
  rootId: string
  truncated: boolean
} {
  const nodes = new Map<string, GraphNode>()
  let truncated = false

  const visit = (label: string, value: Json, path: string): string => {
    const isArray = Array.isArray(value)
    const entries: [string, Json][] = isArray
      ? (value as Json[]).map((v, i): [string, Json] => [String(i), v])
      : value !== null && typeof value === 'object'
        ? Object.entries(value)
        : []
    const rows: { k: string; v: string }[] = []
    const childIds: string[] = []
    const node: GraphNode = {
      id: path,
      label,
      badge: isArray
        ? `[${entries.length}]`
        : value !== null && typeof value === 'object'
          ? `{${entries.length}}`
          : '',
      rows,
      childIds,
      x: 0,
      y: 0,
      h: HEADER_H
    }
    nodes.set(path, node)

    if (value === null || typeof value !== 'object') {
      rows.push({ k: '', v: preview(value) })
    } else {
      for (const [k, v] of entries) {
        if (v !== null && typeof v === 'object') {
          if (nodes.size >= NODE_CAP) {
            truncated = true
            continue
          }
          childIds.push(visit(k, v, isArray ? `${path}[${k}]` : `${path}.${k}`))
        } else {
          rows.push({ k, v: preview(v) })
        }
      }
    }
    node.h = HEADER_H + node.rows.length * ROW_H
    return path
  }

  const rootId = visit('root', data, '$')
  return { nodes, rootId, truncated }
}

/** Left-to-right tree layout; parents center on their children's span. */
function layout(nodes: Map<string, GraphNode>, rootId: string, collapsed: Set<string>): void {
  const place = (id: string, depth: number, top: number): number => {
    const node = nodes.get(id)!
    node.x = depth * (NODE_W + H_GAP)
    const children = collapsed.has(id) ? [] : node.childIds
    if (children.length === 0) {
      node.y = top
      return node.h
    }
    let childTop = top
    for (const childId of children) {
      childTop += place(childId, depth + 1, childTop) + V_GAP
    }
    const span = childTop - V_GAP - top
    node.y = top + Math.max(0, span / 2 - node.h / 2)
    return Math.max(node.h, span)
  }
  place(rootId, 0, 0)
}

const truncate = (s: string, n: number): string => (s.length > n ? s.slice(0, n - 1) + '…' : s)

export function JsonGraph({ data }: { data: unknown }): React.JSX.Element {
  const theme = useShellStore((s) => s.theme)
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set())
  const [view, setView] = useState({ tx: 40, ty: 40, scale: 1 })
  const drag = useRef<{ x: number; y: number; tx: number; ty: number; moved: boolean } | null>(null)
  // Click fires after pointerup (drag.current already null), so the "was
  // this a pan?" answer must survive the pointerup.
  const lastDragMoved = useRef(false)

  const { nodes, rootId, truncated } = useMemo(() => buildNodes(data as Json), [data])
  const visible = useMemo(() => {
    layout(nodes, rootId, collapsed)
    const out: GraphNode[] = []
    const walk = (id: string): void => {
      const node = nodes.get(id)
      if (!node) return
      out.push(node)
      if (!collapsed.has(id)) node.childIds.forEach(walk)
    }
    walk(rootId)
    return out
  }, [nodes, rootId, collapsed])

  const dark = theme === 'dark'
  const c = dark
    ? {
        node: '#0e1420',
        border: '#334155',
        header: '#16202e',
        key: '#7dd3fc',
        val: '#94a3b8',
        label: '#e2e8f0',
        edge: '#334155'
      }
    : {
        node: '#ffffff',
        border: '#cbd5e1',
        header: '#f1f5f9',
        key: '#0369a1',
        val: '#475569',
        label: '#1e293b',
        edge: '#cbd5e1'
      }

  const toggle = (id: string): void => {
    setCollapsed((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  return (
    <div className="json-graph relative h-full overflow-hidden bg-slate-50 dark:bg-[#0b0f14]">
      {truncated && (
        <div className="absolute left-3 top-3 z-10 rounded-md bg-amber-500/10 px-2.5 py-1 text-[11px] text-amber-600 dark:text-amber-400">
          Large document — graph truncated at {NODE_CAP} nodes; use the tree view for the rest.
        </div>
      )}
      <div className="absolute right-3 top-3 z-10 text-[11px] text-slate-400">
        drag to pan · wheel to zoom · click a node to collapse
      </div>
      <svg
        className="h-full w-full cursor-grab active:cursor-grabbing"
        onPointerDown={(e) => {
          drag.current = { x: e.clientX, y: e.clientY, tx: view.tx, ty: view.ty, moved: false }
          lastDragMoved.current = false
          ;(e.target as Element).setPointerCapture?.(e.pointerId)
        }}
        onPointerMove={(e) => {
          if (!drag.current) return
          const dx = e.clientX - drag.current.x
          const dy = e.clientY - drag.current.y
          if (Math.abs(dx) + Math.abs(dy) > 3) drag.current.moved = true
          setView((v) => ({ ...v, tx: drag.current!.tx + dx, ty: drag.current!.ty + dy }))
        }}
        onPointerUp={() => {
          lastDragMoved.current = drag.current?.moved ?? false
          drag.current = null
        }}
        onWheel={(e) => {
          const factor = e.deltaY < 0 ? 1.1 : 1 / 1.1
          setView((v) => ({ ...v, scale: Math.min(2.5, Math.max(0.15, v.scale * factor)) }))
        }}
      >
        <g transform={`translate(${view.tx}, ${view.ty}) scale(${view.scale})`}>
          {visible.map((node) =>
            (collapsed.has(node.id) ? [] : node.childIds).map((childId) => {
              const child = nodes.get(childId)
              if (!child) return null
              const x1 = node.x + NODE_W
              const y1 = node.y + HEADER_H / 2
              const x2 = child.x
              const y2 = child.y + HEADER_H / 2
              const mx = (x1 + x2) / 2
              return (
                <path
                  key={`${node.id}->${childId}`}
                  d={`M ${x1} ${y1} C ${mx} ${y1}, ${mx} ${y2}, ${x2} ${y2}`}
                  fill="none"
                  stroke={c.edge}
                  strokeWidth={1.5}
                />
              )
            })
          )}
          {visible.map((node) => (
            <g
              key={node.id}
              transform={`translate(${node.x}, ${node.y})`}
              onClick={() => {
                if (lastDragMoved.current) return
                if (node.childIds.length > 0) toggle(node.id)
              }}
              style={{ cursor: node.childIds.length > 0 ? 'pointer' : 'default' }}
            >
              <rect width={NODE_W} height={node.h} rx={7} fill={c.node} stroke={c.border} />
              <rect width={NODE_W} height={HEADER_H} rx={7} fill={c.header} />
              <text
                x={10}
                y={16}
                fontSize={12}
                fontWeight={600}
                fill={c.label}
                fontFamily="ui-monospace, Menlo, monospace"
              >
                {truncate(node.label, 20)} {node.badge}
                {collapsed.has(node.id) && node.childIds.length > 0 ? ' ⊕' : ''}
              </text>
              {node.rows.map((row, i) => (
                <text
                  key={i}
                  x={10}
                  y={HEADER_H + (i + 1) * ROW_H - 5}
                  fontSize={11}
                  fontFamily="ui-monospace, Menlo, monospace"
                >
                  {row.k && <tspan fill={c.key}>{truncate(row.k, 14)}: </tspan>}
                  <tspan fill={c.val}>{truncate(row.v, row.k ? 18 : 30)}</tspan>
                </text>
              ))}
            </g>
          ))}
        </g>
      </svg>
    </div>
  )
}
