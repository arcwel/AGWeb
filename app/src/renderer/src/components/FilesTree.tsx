import { useCallback, useEffect, useRef, useState } from 'react'
import type { FsEntry, RecentProject, WorkspaceInfo } from '@shared/ipc'
import { isDocFile, isSlidesFile, useShellStore } from '@/store'
import { BlockTypeIcon, CloseIcon } from '@/components/icons'
import { SLIDE_TEMPLATES } from '@/slideTemplates'

/**
 * The Files block: a lazy, watcher-refreshed tree of the open workspace.
 * Click a file to open it in the editor. Toolbar creates entries in the
 * selected directory; rows expose rename (inline) and delete on hover.
 */

interface TreeState {
  children: Record<string, FsEntry[]>
  expanded: Set<string>
}

/** Drag-to-move (3.1): a row's workspace-relative path rides the drag. */
const FILE_DRAG_MIME = 'application/x-agweb-file'

const parentOf = (path: string): string =>
  path.includes('/') ? path.slice(0, path.lastIndexOf('/')) : ''

/** A path may not move into itself or its own subtree. */
const isMovableTo = (from: string, toDir: string): boolean =>
  from !== toDir && !toDir.startsWith(`${from}/`) && parentOf(from) !== toDir

export function FilesTree(): React.JSX.Element {
  const workspace = useShellStore((s) => s.workspace)
  if (!workspace) return <NoWorkspace />
  // Keyed by path: switching projects remounts with fresh tree state.
  return <WorkspaceTree key={workspace.path} />
}

function WorkspaceTree(): React.JSX.Element {
  const workspace = useShellStore((s) => s.workspace)!
  const openFileInEditor = useShellStore((s) => s.openFile)
  const openDoc = useShellStore((s) => s.openDoc)
  const newTab = useShellStore((s) => s.newTab)
  // Slide decks (*.slides.md) render as Reveal presentations in a browser
  // tab; other doc-type files (md/json/yaml/csv…) open in Document Studio;
  // everything else opens in the Deck's editor.
  const openFile = (path: string): void => {
    if (isSlidesFile(path)) {
      void window.agweb.slides.open(path).then((result) => {
        if (result.url) newTab(result.url)
      })
    } else if (isDocFile(path)) openDoc(path)
    else openFileInEditor(path)
  }
  const [tree, setTree] = useState<TreeState>({ children: {}, expanded: new Set() })
  const [selectedDir, setSelectedDir] = useState('')
  const [creating, setCreating] = useState<'file' | 'dir' | null>(null)
  const [renaming, setRenaming] = useState<string | null>(null)
  const [nameInput, setNameInput] = useState('')
  const [templatesOpen, setTemplatesOpen] = useState(false)
  const [dropDir, setDropDir] = useState<string | null>(null)
  // Extra folders granted to this session (3B.4). The primary root is not in
  // here — it is the tree above; these are addressed by absolute path.
  const [extraRoots, setExtraRoots] = useState<WorkspaceInfo[]>([])

  // Drag a row onto a directory (or the workspace header for the root) to
  // move it there; fs.rename validates both ends stay inside the workspace.
  const moveTo = async (from: string, toDir: string): Promise<void> => {
    setDropDir(null)
    if (!isMovableTo(from, toDir)) return
    const name = from.split('/').pop() ?? from
    await window.agweb.fs.rename(from, toDir ? `${toDir}/${name}` : name)
  }

  const dropHandlers = (dir: string): React.DOMAttributes<HTMLDivElement> => ({
    onDragOver: (event) => {
      if (!event.dataTransfer.types.includes(FILE_DRAG_MIME)) return
      event.preventDefault()
      event.stopPropagation()
      event.dataTransfer.dropEffect = 'move'
      setDropDir(dir)
    },
    onDragLeave: () => setDropDir((d) => (d === dir ? null : d)),
    onDrop: (event) => {
      event.preventDefault()
      event.stopPropagation()
      const from = event.dataTransfer.getData(FILE_DRAG_MIME)
      if (from) void moveTo(from, dir)
    }
  })

  // New deck from a template: pick a free deck-N.slides.md name in the
  // selected directory, write the template, open it (deck tab + editor rename
  // is a click away in the tree).
  const createDeck = async (content: string): Promise<void> => {
    setTemplatesOpen(false)
    const siblings = new Set((tree.children[selectedDir] ?? []).map((e) => e.name))
    let name = 'deck.slides.md'
    for (let n = 2; siblings.has(name); n++) name = `deck-${n}.slides.md`
    const rel = selectedDir ? `${selectedDir}/${name}` : name
    const result = await window.agweb.fs.write(rel, content)
    if (!result.error) openFile(rel)
  }

  const refreshRoots = useCallback(async (): Promise<void> => {
    const roots = await window.agweb.workspaceRoots()
    // Drop the primary: the main tree already is it.
    setExtraRoots(roots.slice(1))
  }, [])

  useEffect(() => {
    // Guarded and awaited, so the state write happens after the IPC round trip
    // rather than synchronously inside the effect.
    let live = true
    void window.agweb.workspaceRoots().then((roots) => {
      if (live) setExtraRoots(roots.slice(1))
    })
    return () => {
      live = false
    }
  }, [])

  const loadDir = useCallback(async (dir: string): Promise<FsEntry[]> => {
    const entries = await window.agweb.fs.list(dir)
    setTree((t) => ({ ...t, children: { ...t.children, [dir]: entries } }))
    return entries
  }, [])

  // Mirror of tree.expanded readable from the watcher callback.
  const expandedRef = useRef<Set<string>>(new Set())

  // Root load + watcher-driven refresh of every expanded directory. loadDir
  // awaits IPC before setting state, so these calls never set state
  // synchronously within the effect.
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void loadDir('')
    return window.agweb.fs.onChanged(() => {
      void loadDir('')
      for (const dir of expandedRef.current) void loadDir(dir)
    })
  }, [loadDir])

  const toggleDir = (path: string): void => {
    setSelectedDir(path)
    setTree((t) => {
      const expanded = new Set(t.expanded)
      if (expanded.has(path)) expanded.delete(path)
      else {
        expanded.add(path)
        if (!t.children[path]) void loadDir(path)
      }
      expandedRef.current = expanded
      return { ...t, expanded }
    })
  }

  const submitCreate = async (): Promise<void> => {
    const name = nameInput.trim()
    if (name && creating) {
      const rel = selectedDir ? `${selectedDir}/${name}` : name
      const result = await window.agweb.fs.create(rel, creating)
      if (!result.error && creating === 'file') openFile(rel)
    }
    setCreating(null)
    setNameInput('')
  }

  const submitRename = async (oldPath: string): Promise<void> => {
    const name = nameInput.trim()
    if (name) {
      const parent = oldPath.includes('/') ? oldPath.slice(0, oldPath.lastIndexOf('/')) : ''
      await window.agweb.fs.rename(oldPath, parent ? `${parent}/${name}` : name)
    }
    setRenaming(null)
    setNameInput('')
  }

  const remove = async (path: string): Promise<void> => {
    if (await window.agweb.confirm(`Delete ${path}? This cannot be undone.`)) {
      await window.agweb.fs.remove(path)
    }
  }

  const renderEntries = (dir: string, depth: number): React.JSX.Element[] => {
    const entries = tree.children[dir] ?? []
    return entries.map((entry) => {
      const path = dir ? `${dir}/${entry.name}` : entry.name
      const isExpanded = tree.expanded.has(path)
      return (
        <div key={path}>
          {renaming === path ? (
            <input
              autoFocus
              value={nameInput}
              onChange={(e) => setNameInput(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && void submitRename(path)}
              onBlur={() => setRenaming(null)}
              className="mx-1 my-0.5 w-11/12 rounded border border-sky-500 bg-transparent px-1.5 py-0.5 text-xs outline-none"
              style={{ marginLeft: depth * 14 + 4 }}
            />
          ) : (
            <div
              draggable
              onDragStart={(event) => {
                event.dataTransfer.setData(FILE_DRAG_MIME, path)
                event.dataTransfer.effectAllowed = 'move'
              }}
              {...(entry.kind === 'dir' ? dropHandlers(path) : {})}
              onClick={() => (entry.kind === 'dir' ? toggleDir(path) : openFile(path))}
              className={`group flex cursor-pointer items-center gap-1.5 rounded px-1.5 py-1 text-xs hover:bg-slate-100 dark:hover:bg-slate-800 ${
                selectedDir === path ? 'bg-slate-100 dark:bg-slate-800' : ''
              } ${dropDir === path ? 'ring-1 ring-inset ring-sky-500' : ''}`}
              style={{ paddingLeft: depth * 14 + 6 }}
            >
              <span className="w-3 text-[10px] text-slate-400">
                {entry.kind === 'dir' ? (isExpanded ? '▾' : '▸') : ''}
              </span>
              <span className="truncate text-slate-700 dark:text-slate-300">{entry.name}</span>
              <span className="ml-auto hidden shrink-0 items-center gap-1 group-hover:flex">
                <button
                  onClick={(e) => {
                    e.stopPropagation()
                    setRenaming(path)
                    setNameInput(entry.name)
                  }}
                  className="rounded p-0.5 text-slate-400 hover:text-sky-500"
                  aria-label={`Rename ${entry.name}`}
                >
                  <BlockTypeIcon type="editor" size={11} />
                </button>
                <button
                  onClick={(e) => {
                    e.stopPropagation()
                    void remove(path)
                  }}
                  className="rounded p-0.5 text-slate-400 hover:text-red-500"
                  aria-label={`Delete ${entry.name}`}
                >
                  <CloseIcon size={11} />
                </button>
              </span>
            </div>
          )}
          {entry.kind === 'dir' && isExpanded && renderEntries(path, depth + 1)}
        </div>
      )
    })
  }

  return (
    <div className="flex h-full flex-col text-xs">
      <div
        {...dropHandlers('')}
        className={`flex flex-none items-center gap-1 border-b border-slate-200 px-2 py-1.5 dark:border-slate-800 ${
          dropDir === '' ? 'bg-sky-500/10' : ''
        }`}
      >
        <span className="truncate font-semibold text-slate-600 dark:text-slate-300">
          {workspace.name}
          {selectedDir ? ` / ${selectedDir}` : ''}
        </span>
        <button
          onClick={() => {
            setCreating('file')
            setNameInput('')
          }}
          className="ml-auto rounded border border-slate-300 px-1.5 py-0.5 text-[10px] font-semibold text-slate-500 hover:bg-slate-100 dark:border-slate-600 dark:hover:bg-slate-800"
          aria-label="New file"
        >
          + file
        </button>
        <button
          onClick={() => {
            setCreating('dir')
            setNameInput('')
          }}
          className="rounded border border-slate-300 px-1.5 py-0.5 text-[10px] font-semibold text-slate-500 hover:bg-slate-100 dark:border-slate-600 dark:hover:bg-slate-800"
          aria-label="New folder"
        >
          + dir
        </button>
        <div className="relative">
          <button
            onClick={() => setTemplatesOpen((o) => !o)}
            className="rounded border border-slate-300 px-1.5 py-0.5 text-[10px] font-semibold text-slate-500 hover:bg-slate-100 dark:border-slate-600 dark:hover:bg-slate-800"
            aria-label="New slide deck"
          >
            + deck
          </button>
          {templatesOpen && (
            <div
              data-testid="deck-templates"
              className="absolute right-0 top-6 z-50 w-52 overflow-hidden rounded-lg border border-slate-200 bg-white shadow-xl dark:border-slate-700 dark:bg-[#0e1420]"
            >
              {SLIDE_TEMPLATES.map((template) => (
                <button
                  key={template.id}
                  data-testid={`deck-template-${template.id}`}
                  onClick={() => void createDeck(template.content)}
                  className="flex w-full flex-col gap-0.5 px-3 py-2 text-left hover:bg-slate-100 dark:hover:bg-slate-800"
                >
                  <span className="text-xs font-semibold">{template.label}</span>
                  <span className="text-[10px] text-slate-500">{template.hint}</span>
                </button>
              ))}
            </div>
          )}
        </div>
      </div>
      {creating && (
        <input
          autoFocus
          value={nameInput}
          placeholder={creating === 'file' ? 'new-file.ts' : 'new-folder'}
          onChange={(e) => setNameInput(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && void submitCreate()}
          onBlur={() => setCreating(null)}
          className="mx-2 mt-1.5 rounded border border-sky-500 bg-transparent px-1.5 py-1 text-xs outline-none"
        />
      )}
      <div className="min-h-0 flex-1 overflow-y-auto p-1.5">
        {renderEntries('', 0)}

        {extraRoots.map((root) => (
          <div
            key={root.path}
            className="mt-2 border-t border-slate-200 pt-1 dark:border-slate-800"
          >
            <div className="group flex items-center gap-1 px-1 py-0.5">
              <button
                onClick={() => {
                  setTree((t) => {
                    const expanded = new Set(t.expanded)
                    if (expanded.has(root.path)) expanded.delete(root.path)
                    else {
                      expanded.add(root.path)
                      void loadDir(root.path)
                    }
                    return { ...t, expanded }
                  })
                }}
                className="min-w-0 flex-1 truncate text-left font-semibold text-slate-600 dark:text-slate-300"
                title={root.path}
              >
                {tree.expanded.has(root.path) ? '▾' : '▸'} {root.name}
              </button>
              <button
                onClick={() => void window.agweb.removeWorkspaceRoot(root.path).then(refreshRoots)}
                className="rounded px-1 text-[10px] text-slate-400 opacity-0 hover:text-rose-500 group-hover:opacity-100"
                title="Revoke this folder for the rest of the session"
                aria-label={`Revoke ${root.name}`}
              >
                ×
              </button>
            </div>
            {tree.expanded.has(root.path) && renderEntries(root.path, 1)}
          </div>
        ))}

        <button
          onClick={() => void window.agweb.addWorkspaceRoot().then(refreshRoots)}
          className="mt-2 w-full rounded border border-dashed border-slate-300 px-2 py-1 text-[10px] font-semibold text-slate-400 hover:border-slate-400 hover:text-slate-600 dark:border-slate-700 dark:hover:text-slate-300"
          title="Grant another folder to this session. Not remembered after a restart."
          data-testid="add-workspace-root"
        >
          + folder
        </button>
      </div>
    </div>
  )
}

function NoWorkspace(): React.JSX.Element {
  const workspace = useShellStore((s) => s.workspace)
  const setWorkspace = useShellStore((s) => s.setWorkspace)
  const [recent, setRecent] = useState<RecentProject[]>([])

  useEffect(() => {
    void window.agweb.getRecentProjects().then(setRecent)
  }, [workspace])

  return (
    <div className="flex h-full flex-col gap-2 overflow-y-auto p-3 text-xs">
      <button
        onClick={() =>
          void window.agweb.openWorkspace().then((ws) => {
            if (ws) setWorkspace(ws)
          })
        }
        className="rounded-md bg-sky-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-sky-500"
      >
        Open Project Folder…
      </button>
      <div className="text-slate-500">No project open.</div>
      {recent.length > 0 && (
        <>
          <div className="mt-1 font-semibold uppercase tracking-wide text-slate-500">Recent</div>
          {recent.slice(0, 6).map((project) => (
            <button
              key={project.path}
              onClick={() => void window.agweb.openWorkspacePath(project.path)}
              className="truncate rounded px-1.5 py-1 text-left text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800"
              title={project.path}
            >
              {project.name}
            </button>
          ))}
        </>
      )}
    </div>
  )
}
