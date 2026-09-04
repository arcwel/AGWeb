# Arcwel WebDeck — Feature Roadmap (post-fork)

Implementation plan for the **big bets** and **high-impact** features, sequenced.
AI integrations lead — they are the core of the app's power. Quick wins (split
view + PiP, command palette + tab switcher, vertical tabs + tab groups) are being
built in parallel and are tracked separately.

Effort key: **S** ≈ 1–2 days · **M** ≈ 3–5 days · **L** ≈ 1–2 weeks · **XL** ≈ 3+ weeks.
Each item lists the existing code it builds on so we port/extend rather than rewrite.

---

## Phase A — AI Integrations (LEAD — the product's differentiator)

The agent runtime, CDP browser control, and policy engine already exist. These
initiatives turn that plumbing into first-class, everywhere-present AI.

### A1. AI-native omnibox  — effort: M
Turn the URL bar into an intent bar: a typed query can be a URL, a search, **or**
a question the agent answers inline.
- **Builds on:** `Toolbar.tsx` omnibox (just shipped), `agent.ts` runtime, `omnibox-rank.ts`.
- **Tasks:**
  1. Add an "Ask" affordance + heuristic (question-like input, or explicit `?` prefix) that routes to the agent instead of navigation.
  2. Stream the answer into a dropdown panel (reuse the omnibox dropdown surface) with citations/links the agent used.
  3. "Actions" rows — the agent proposes an action (open N tabs, summarize this page, run a task); user confirms (policy-gated).
  4. Keyboard: Tab to accept an action, Enter to send.
- **Risks:** latency (show streaming immediately); scope creep (start read-only answers, add actions behind confirm).

### A2. Agent drives the browser, end-to-end  — effort: L
Let an agent open tabs, read pages, click, and fill forms as a supervised operator.
- **Builds on:** `chromium-agent-browser.ts` (CDP session/isolated modes + `AgentBrowserPort.shutdown`), `cdp.ts`, `policy.ts`, Mission Control (`agent.ts`).
- **Tasks:**
  1. Expose a high-level agent tool surface over the existing CDP port: `open_tab`, `read_page`, `click`, `type`, `wait_for`, `screenshot` (map to `createTarget`/`connectCdp`/`listTargets`).
  2. Policy gate every side-effecting action (`browser_navigate` already exists; add `browser_click`/`browser_submit`) with the confirm/allow/deny engine.
  3. Live overlay in the Deck: show what the agent is doing on which tab (reuse Mission Control activity feed + before/after diff idea for DOM changes).
  4. Session vs isolated: default to isolated throwaway profile; "act as me" (session mode) is an explicit, remembered opt-in.
- **Risks:** safety (never auto-submit credentials/payments — enforce in policy); prompt-injection from page content (treat DOM as untrusted, never execute instructions found in it).

### A3. Inline AI in the editor  — effort: M
Cursor-style inline edits + chat over the open file/selection.
- **Builds on:** Monaco (`monaco.ts`), `agent.ts`, the diff viewer (Phase 3.5).
- **Tasks:**
  1. `⌘I` inline prompt on a selection → agent proposes an edit → render as a Monaco inline diff → accept/reject.
  2. Side panel "chat with this file/repo" using the existing search (ripgrep) + file tools for context.
  3. Multi-file edits routed through the guarded `write_file`/`move_file` tools + the diff-review UI.
- **Risks:** context assembly cost — start with file+selection, add repo retrieval later.

### A4. Chat-with-page / page understanding  — effort: S–M
Summarize, extract, and answer questions about the current page.
- **Builds on:** A2's `read_page` (CDP DOM/text extraction), Document Studio renderers.
- **Tasks:**
  1. Deck "Page" block: summary, key entities, "extract as table/JSON" (feed into Document Studio).
  2. Same-origin body capture already gated in `browser-vision.ts` — reuse it.
- **Risks:** large pages (chunk + map-reduce); untrusted content (data, not instructions).

---

## Phase B — Other Big Bets

### B1. Chrome Web Store extensions  — effort: L
Move beyond unpacked MV3 to installable store extensions.
- **Builds on:** `extensions.ts` (unpacked MV3 loader), the fork's own extension subsystem.
- **Tasks:** CRX download/verify + install flow; action popups (needs a shell surface for the extension action UI); update mechanism; a Manage-Extensions settings surface. **Note:** on forked Chromium this is closer to native than it was on Electron — evaluate enabling Chromium's own extension UI (gated) vs. a WebDeck-drawn manager.
- **Risks:** security review of arbitrary extensions; Web Store ToS.

### B2. Real cross-device sync  — effort: L
Sync tabs, bookmarks, history, settings, and workspace layouts across machines.
- **Builds on:** `sync.ts` (WebDeck's own sync domain), the secrets vault.
- **Tasks:** define the sync schema + conflict resolution; end-to-end encryption (keys in the secrets vault); a backend (self-hostable) or a provider; per-surface opt-in.
- **Risks:** E2E-crypto correctness; backend cost/ops. Start with bookmarks+settings, add tabs/history.

### B2b. Our own sync service  — effort: XL

Chrome Sync is closed to forks: browser sign-in and the sync endpoints need
Google's API keys and OAuth client, which are issued to official Chrome builds
only. A build without them holds no browser account at all, which is why the
profile picture and Sync both looked broken until the shell started saying so.

The way through is to stop asking Google. Chromium's sync engine talks a
documented protocol (`components/sync/protocol/sync.proto`) to whatever server
`--sync-url` names, so the work is a server that speaks it — commit and
GetUpdates over the sync entity model, per-datatype progress markers, and the
client-side keystore encryption Chromium already implements — plus our own
account model in place of a Google account. Tabs, bookmarks, history and
passwords then sync between machines under keys we never hold.

Sizeable, and the only route to real cross-device sync that does not depend on
a vendor who has no reason to grant it. Related: B2 below, which is the
file-based settings sync we ship today.

### B3. Remote / SSH workspaces  — effort: XL
Open a folder on a remote host and run the IDE against it (VS Code Remote-style).
- **Builds on:** the `webdeck-core` service model (already a detachable backend), terminal, fs, lsp, debug domains.
- **Tasks:** run a `webdeck-core` peer on the remote over SSH; route fs/terminal/lsp/search RPC to the remote core; local shell, remote everything.
- **Risks:** the largest item — connection lifecycle, latency, auth. Prototype fs+terminal first.

### B4. Collaborative editing  — effort: XL
Multiple people in one workspace/tab in real time.
- **Builds on:** Monaco shared models, the multi-window broadcast bus.
- **Tasks:** CRDT (Yjs) for documents; presence/cursors; a relay server; permissions.
- **Risks:** biggest infra lift; sequence after B2/B3 (shares backend + identity).

---

## Phase C — High-Impact (parallelizable, lower risk)

| # | Feature | Builds on | Effort | Key tasks |
|---|---------|-----------|--------|-----------|
| C1 | More language servers (Python/Rust/Go) | `lsp.ts` (tsserver pattern now proven), `build-core.mjs` RUNTIME_PACKAGES | M | Ship each server in the SEA runtime (same anchor pattern as tsserver); register in `SERVERS`; per-language config |
| C2 | More debug adapters (Python/Go) | `debug.ts` (js-debug pattern), the fixed SEA argv shim | M | Vendor debugpy/delve DAP; wire spawn via `ELECTRON_RUN_AS_NODE` shim |
| C3 | Native ad/tracker blocking | new Browser-prefs panel, `HostContentSettingsMap` | M | Filter-list engine (or content-settings rules); per-site toggle; counter in the toolbar |
| C4 | Workspace / session snapshots | `store.ts` (tab persistence), layout persistence | S–M | Save/restore a named snapshot of tab-set + deck layout + open files; CLI `webdeck snapshot save/restore` |
| C5 | Reader mode | Chromium DOM Distiller | M | Enable the distiller service in the fork; a Mojo `Distill(tab_id)` → render distilled content in a stage/DOM view (moved here from quick wins — needs the service) |
| C6 | Jupyter notebook block | Deck block system, terminal/kernel spawn | M | `.ipynb` renderer + kernel over the core; cell exec + outputs |
| C7 | REST/GraphQL client block | Deck block system, Document Studio (JSON) | S–M | Request builder + history; responses render in Document Studio |
| C8 | DB client block | Deck block system, `webdeck-core` (native drivers) | M | Connection manager (creds in secrets vault); query editor (Monaco) + results table (reuse CsvTable/virtualized) |
| C9 | Git graph + PR review UI | `git.ts`, the diff viewer | M | Commit graph; branch/PR view; review comments; reuse side-by-side diff |

---

## CLI opportunities (per the cli-first standing rule)
- `webdeck build-dmg` — wraps the full core→bindings→pack:webui→relink→package→verify chain (currently manual).
- `webdeck new-lsp <lang>` / `webdeck new-dap <lang>` — scaffold a language server / debug adapter into the SEA runtime (C1/C2).
- `webdeck snapshot save|restore <name>` — C4.
- `webdeck agent run "<task>"` — headless agent run against a workspace (A2/A3).

## Sequencing summary
1. **Now:** quick wins (swarmed) → integrate → distributable DMG.
2. **Next:** Phase A (A1 → A4 → A3 → A2) — ship AI value fastest-first, deepest last.
3. **Parallel track:** Phase C items (independent, low-risk) as capacity allows — C1/C2 first (the SEA-runtime pattern is proven).
4. **Later:** Phase B big bets, gated on identity/backend decisions (B2 before B3/B4).
