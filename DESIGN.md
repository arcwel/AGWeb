# AGWeb Design Direction — Browser-First & the Dev Deck

Design canvas (mockups + interactive reveal prototype): https://claude.ai/code/artifact/aeb15107-803d-4e35-a6f2-25293afddcbc
Working design sources live in `design/` (`*.dc.html` + `canvas.json`).

## Principles

1. **The browser is the product.** Default state is a pure browser: tab strip, toolbar, page. Zero dev chrome. AGWeb must be a great daily browser before it is anything else.
2. **Development is a summonable layer.** All IDE features live in the **Dev Deck** — think Chrome DevTools, but the panels are IDE features. One gesture (`⌘D` / Deck button) reveals it; the same gesture puts it away completely.
3. **Every dev feature is an independent block.** Editor, Terminal, Files, Agents (Mission Control), Logs, Slides — each is a self-contained block that can be hidden, shown, resized, docked anywhere, floated, or collapsed to a rail, independently of the others.

## The Deck reveal (signature animation)

Direction A — "Stage" (the recommended default, prototyped on the canvas):

- The page **scales back into a spotlit stage**: full-bleed viewport animates to a rounded, bordered frame with a soft sky glow and shadow — the page becomes the *subject under inspection*.
- Dev blocks **slide in staggered**: right column (Editor, Files) enters ~70 ms after the stage starts moving; bottom dock (Terminal, Agents) ~140 ms after. Reverse order on hide.
- Timing: 550 ms, easing `cubic-bezier(0.32, 0.72, 0, 1)` (fast start, long settle). A viewport chip ("localhost:5173 · inspecting") fades in on the stage once it lands.
- Direction B — "Overlay": glass blocks (blurred translucent panels) float over the dimmed page. Kept as an alternate: it is also the natural rendering of *floating* blocks within Direction A, so the two compose rather than compete.

## Block anatomy

Header: drag grip · identity (the block tab) + active context (the editor tab shows its current file) · float/re-dock · collapse-to-rail · close.

**Resize (as built):** blocks resize through **shared gutters between zones**, not per-edge handles on each block — a vertical gutter between the right column and the stage, and a horizontal gutter above the bottom dock. Dragging a gutter resizes the adjacent zones and persists per project. This is simpler and less fiddly than per-block edge handles, and it matches how the zones actually compose.

Block states:

- **Docked** — snapped into the right column or bottom dock; shares space with neighbors.
- **Tabbed stack** — drop a block onto another to merge them into one tabbed group (DevTools-style). Tabs drag out to split again; `+` in the strip opens another instance into the group.
- **Floating** — glass panel over the page; free position/size, always on top. Popped out into its **own OS window**, a float renders as a plain native panel on the opaque panel ground — the translucent glass treatment is the in-window overlay, not cross-window OS vibrancy (which is platform-specific and out of scope).
- **On the rail** — collapsed to an icon on the window edge; one click restores it exactly where it was.
- **Closed** — reopen from the Deck menu.

**Multiple instances:** any block type can be opened more than once (Terminal 1, Terminal 2, a second Editor…). Instances are peers — each independently dockable, stackable, floatable.

**Presets:** Browsing (deck hidden) · Building (stage + editor/terminal) · Debugging (stage + terminal/logs/agents). One keystroke swaps the whole layout. Layouts and presets persist per project.

## Detached mode — the IDE as its own window

A pop-out control beside the Deck button **detaches the entire deck into a separate OS window**: files, tabbed editors, stacked terminals, agents — all dev items contained in that one window, laid out like a standard IDE. The browser window simultaneously returns to pure browsing (its Deck button shows a "Deck detached" state). Two apps, two monitors if you like. "Dock back" in the IDE window's titlebar re-merges everything into the single-window Stage layout, restoring each block where it was. Blocks never split across more than these two hosts: attached (inside the browser window) or detached (all together in the IDE window).

## Visual language

Matches the existing shell: `#0b0f14` app ground, `#0e1420` panels, `#1e293b` borders, slate text ramp (`#e2e8f0` / `#94a3b8` / `#64748b`), sky accent (`#38bdf8` on dark, `#0284c7` fills), 10 px block radii, `ui-sans-serif` UI + `ui-monospace` code, 11 px uppercase block titles with 0.06 em tracking. Floating blocks: `rgba(14,20,32,0.88)` + 14 px backdrop blur + `0 24px 56px` shadow.

## Implementation notes

- The stage is the existing `WebContentsView`. During the reveal, the renderer animates the stage placeholder with CSS while the existing ResizeObserver → `setBounds` pipe streams bounds to the native view each frame; if IPC jitter shows, fall back to hiding the view behind a captured snapshot for the 550 ms flight and snapping bounds at the end.
- Deck state machine lives in the shell store: `deck: hidden | revealed | detached`, block *instances* as `{ id, type, zone: right | bottom | floating | rail | closed, groupId, order, size, floatRect }` — a tabbed stack is simply instances sharing a `groupId` with one active tab. Persisted per project.
- Detached mode is a second `BrowserWindow` rendering the same shell store (state synced over IPC or a shared main-process store); heavy block backends (pty sessions, editor models, agent processes) already live in the main process, so blocks re-render in the other window without losing state.
- Blocks are the unit of extension: agent-generated panels (execution reports, diffs) arrive as blocks later.


## Glass tokens (as built)

The design canvas settled the "Glass" direction; these are the tokens the app
actually ships, defined in `app/src/renderer/src/styles.css`.

| Token | Dark | Role |
| :-- | :-- | :-- |
| `--wd-bg` | `#0f1114` | Shell, behind two ambient radial glows (teal top-left, indigo bottom-right) |
| `--wd-text` | `#e6e8ea` | Primary text |
| `--wd-muted` / `--wd-dim` / `--wd-faint` | `#9ba1a8` / `#6b7178` / `#4b5158` | Secondary, tertiary, disabled |
| `--wd-accent` | `#4fd4c4` | The teal. Tailwind's `sky-*` scale is remapped to it, so existing utilities are on-palette |
| `--wd-accent-2` | `#7a8cff` | Indigo, used in the ambient glow and group colours |
| `--wd-glass` / `--wd-glass-border` | `rgba(255,255,255,.055)` / `.09` | The frosted surface (`.glass`, blur 30px, saturate 1.5) |
| `--wd-well` | `rgba(0,0,0,.3)` | Block interiors |

Radii carry the Apple-ish capsule language: chrome `20px`, stage `18px`,
blocks `15px`, pills `13px`, icon buttons `10px` (30×30), inner controls `8px`.

**Dark is the default**, not the OS preference — the palette is the identity
and light mode is a variation on it. Light keeps the same shapes and accent on
paper-coloured surfaces.

**Not yet built from the canvas:** the summonable utilities/favourites bar with
its lock toggle. Bookmarks currently live in a toolbar menu instead.
