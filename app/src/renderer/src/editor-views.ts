import { useEffect, useState } from 'react'
import { createInstance } from '@codingame/monaco-vscode-api/services'
import { Registry } from '@codingame/monaco-vscode-api/vscode/vs/platform/registry/common/platform'
import {
  Extensions as ViewExtensions,
  type IViewContainersRegistry,
  type ViewContainer
} from '@codingame/monaco-vscode-api/vscode/vs/workbench/common/views'
import { ViewPaneContainer } from '@codingame/monaco-vscode-api/vscode/vs/workbench/browser/parts/views/viewPaneContainer'
import { Dimension } from '@codingame/monaco-vscode-api/vscode/vs/base/browser/dom'
import { monacoReady } from '@/monaco'
import { onEditorExtensionsChanged } from '@/editor-extensions'

/**
 * Extension view containers as Deck blocks (task 12.8, decision: "no tabs").
 *
 * A VS Code extension contributes *view containers* (GitLens, Docker, TODO
 * Tree…), each holding one or more *views*. In VS Code those live in the
 * sidebar/panel. WebDeck has no sidebar; it has the Deck, where blocks are
 * peers. So each extension view container becomes a block: it appears in
 * Add block under the extension's own title, and inside the block VS Code's
 * own `ViewPaneContainer` renders the container's views exactly as VS Code
 * would — stacked, collapsible panes, no tab strip of ours.
 *
 * Why VS Code's pane machinery rather than our own tabs: the views are VS
 * Code classes (tree views, webview views, custom panes) that only know how to
 * live inside a ViewPaneContainer. Hosting the real thing means every kind of
 * view works, with its own header actions, context menus and state.
 */

export interface ExtensionViewContainer {
  id: string
  title: string
  extensionId?: string
}

function text(value: unknown): string {
  if (typeof value === 'string') return value
  if (value && typeof value === 'object' && 'value' in value) {
    return String((value as { value: unknown }).value)
  }
  return ''
}

function registry(): IViewContainersRegistry {
  return Registry.as<IViewContainersRegistry>(ViewExtensions.ViewContainersRegistry)
}

/** Every view container an installed extension contributes (built-ins excluded). */
export function listExtensionViewContainers(): ExtensionViewContainer[] {
  try {
    return registry()
      .all.filter((c: ViewContainer) => c.extensionId !== undefined)
      .map((c: ViewContainer) => ({
        id: c.id,
        title: text(c.title) || c.id,
        extensionId: c.extensionId ? String(c.extensionId.value) : undefined
      }))
      .sort((a, b) => a.title.localeCompare(b.title))
  } catch {
    // Before the services boot the registry is not there to ask.
    return []
  }
}

/** Fires when the set of extension view containers changes. */
export function onExtensionViewsChanged(listener: () => void): () => void {
  const disposables: Array<() => void> = [onEditorExtensionsChanged(listener)]
  void monacoReady.then(() => {
    try {
      const reg = registry()
      const a = reg.onDidRegister(listener)
      const b = reg.onDidDeregister(listener)
      disposables.push(
        () => a.dispose(),
        () => b.dispose()
      )
    } catch {
      /* registry unavailable — the extensions event still covers installs */
    }
  })
  return () => {
    for (const d of disposables) d()
  }
}

/** The extension view containers, live — for the Add-block menu. */
export function useExtensionViewContainers(): ExtensionViewContainer[] {
  const [containers, setContainers] = useState<ExtensionViewContainer[]>([])
  useEffect(() => {
    let live = true
    const refresh = (): void => {
      if (live) setContainers(listExtensionViewContainers())
    }
    // Populate from a promise callback (never synchronously in the effect),
    // then follow registry/extension changes.
    void monacoReady.then(refresh)
    return () => {
      live = false
    }
  }, [])
  useEffect(() => onExtensionViewsChanged(() => setContainers(listExtensionViewContainers())), [])
  return containers
}

export interface MountedViewContainer {
  layout(width: number, height: number): void
  /** How many of the container's views are showing right now. */
  viewCount(): number
  /** Fires when views are added or removed (e.g. a `when` clause flips). */
  onDidChangeViews(listener: () => void): () => void
  dispose(): void
}

/**
 * Render an extension's view container into `host` using VS Code's own
 * ViewPaneContainer, which picks up the container's registered views itself.
 * Returns null if the container is not registered (extension removed).
 */
export async function mountViewContainer(
  containerId: string,
  host: HTMLElement
): Promise<MountedViewContainer | null> {
  await monacoReady
  if (!registry().all.some((c) => c.id === containerId)) return null
  const pane = await createInstance(ViewPaneContainer, containerId, {
    // A single-view container shows the view's body directly, without a
    // redundant pane header repeating the block title.
    mergeViewWithContainerWhenSingleView: true
  })
  pane.create(host)
  pane.setVisible(true)
  return {
    layout: (width, height) => pane.layout(new Dimension(width, height)),
    viewCount: () => pane.panes.length,
    onDidChangeViews: (listener) => {
      const a = pane.onDidAddViews(listener)
      const b = pane.onDidRemoveViews(listener)
      return () => {
        a.dispose()
        b.dispose()
      }
    },
    dispose: () => {
      pane.setVisible(false)
      pane.dispose()
    }
  }
}
