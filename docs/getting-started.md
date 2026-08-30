# Getting Started

Arcwel WebDeck is a browser first. You browse the web full-screen, and when you
need to build something you press **⌘D** and a full IDE — editor, terminal, files,
source control, debugger, and an agent — slides in around the page you're already
looking at. Press ⌘D again and it's a browser again.

This guide gets you from a clone to giving the agent its first task.

## Prerequisites

- **macOS** on Apple Silicon or Intel (the current build targets macOS first).
- **Node.js** 20+ and npm.
- An **Anthropic API key** if you want to use the agent (optional for browsing and
  the IDE). OpenAI and Gemini keys work too.

## Run it

```bash
cd app
npm ci
npm run dev
```

The window opens as a browser. That's the point — WebDeck *is* a real Chromium
browser (tabs, extensions, downloads, permissions, devtools), not a preview pane.

## Your first five minutes

1. **Browse somewhere.** Use the address bar like any browser. Tabs sit inline with
   the window's traffic lights and show real favicons.
2. **Open a project folder.** You'll be prompted, or use the Files block once the
   deck is open. Everything the agent and IDE can touch is scoped to the folders
   you open — see [Permission Modes](permission-modes.md).
3. **Press ⌘D.** The page retreats into a spotlit frame and the **Dev Deck** slides
   in around it. Every panel is a *block* you can drag, stack, split, float into its
   own window, or collapse to the rail. Layouts persist per project.
4. **Add your API key.** Open **Settings → AI** and paste an Anthropic key. It's
   encrypted into the OS keychain (Keychain / libsecret / DPAPI) via `safeStorage`,
   never written as plaintext and never exposed to the page. Or set the
   `ANTHROPIC_API_KEY` environment variable before launching.
5. **Give the agent a task.** In the **Agent** block, describe what you want. The
   agent plans first, shows you the plan, and waits for your approval before doing
   anything. See [Agent Workflows](agent-workflows.md).

## The Dev Deck blocks

| Block | What it does |
| :-- | :-- |
| **Editor** | Code editor on VS Code's own service layer — real config, keybindings, themes, and language intelligence over LSP |
| **Files** | The workspace file tree; open a doc here to see it as a styled [Document Studio](document-studio.md) view |
| **Terminal** | Full terminals, including the live ones the agent runs inside its conversation |
| **Agent** | Mission Control: give tasks, review plans, watch execution |
| **Source Control** | Git status, staged/unstaged diffs, stage/unstage, commit, branch switching |
| **Debug** | Breakpoints, stepping, call stack, variables, watch — via Microsoft's js-debug |
| **Tasks** | Run `package.json` / `tasks.json` scripts; output becomes editor diagnostics |
| **Search** | Workspace-wide search |
| **Preview** | Live dev-server preview |
| **Settings** | Application, AI, Colours, and the VS Code Editor / Keybindings docs |
| **Logs** | App and agent logs |

Layout **presets** — *Browsing*, *Building*, *Debugging* — swap the whole
arrangement at once.

## Keyboard shortcuts

| Shortcut | Action |
| :-- | :-- |
| **⌘D** | Reveal / hide the Dev Deck |
| **⌘T** | New browser tab |
| **⌘W** | Close the active tab |
| **⌘⇧L** | Toggle light / dark theme |
| **⌘0** | Reset page zoom to 100% |

The full set — back/forward/reload, find in page, print, new window, reopen closed
tab, per-tab devtools — is wired into the native application menu (File / Edit /
View / History / Window / Help) and the right-click context menu on any page.

## Verify a build the way CI does

```bash
npm run lint && npm run typecheck && npm test && npm run build && node scripts/smoke.mjs
```

The smoke test drives the real application end to end — browser, deck, editor,
terminal, language server, debugger, source control, tasks, and agent — and is the
check that matters before a push.

## Next

- [Permission Modes](permission-modes.md) — how the agent is gated, and how to
  loosen or tighten it.
- [Agent Workflows](agent-workflows.md) — planning, approval, execution, and
  managing conversations.
- [Document Studio](document-studio.md) — styled Markdown / data documents and
  slide decks.
