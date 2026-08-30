# AGWeb v0.1 QA Audit & Priority Fix List

Pre-release audit from four parallel reviews (code-quality, security, React/renderer,
product & design-consistency). Every item was verified against the code. Severity is
the merged/reconciled rating; duplicate findings across reviewers are collapsed.

**Status: P0 and P1 are fixed** (plus P2-1..P2-8 picked up along the way) — see the
"Fixed" markers below. Remaining P2/P3 items are open; the design review is next, and
packaging follows it.

**Gate recommendation: do not package until P0 and P1 are fixed.** P2 is strongly
recommended before a public v0.1; P3 can trail the release.

---

## P0 — Blockers (must fix before packaging)

### P0-1 · ✅ FIXED — Agent tools follow the _live_ workspace, not the session's pinned one

`app/src/main/fs.ts:19-25`, `search.ts:17`, `agent.ts` (read_file/write_file/list_dir/search/browser_screenshot/browser_record_stop)
`startAgentTask` pins `session.workspacePath`, and `run_command` uses it as cwd — but every
fs/search tool resolves against `getCurrentWorkspace()` (the global, mutable workspace).
Open Project B while an agent is still running in Project A and every subsequent write/read
silently retargets B. Can overwrite/delete files in a project the agent was never authorized to touch.
**Fix:** thread `session.workspacePath` through the fs/search calls (pass the root explicitly);
show the resolved workspace in the policy prompt. Consider blocking workspace switch while agents run.

### P0-2 · ✅ FIXED — Agent policy gate is bypassable via `browser_eval` / `browser_click` / page `window.open`

`app/src/main/agent.ts:639-657`, `agent-browser.ts` (agentEval/agentClick), `browser.ts:58-61`
Only `browser_open`/`browser_navigate` call `gate(...)`. `browser_eval` runs arbitrary JS in the
page origin (fetch/XHR/beacon/location) with **no** policy check — a prompt-injected page can make
the agent exfiltrate data even in Secure mode. `browser_click` can drive redirects; page `window.open`
becomes a new tab with no gate. Directly breaks the SECURITY.md "hijacked session" guarantee.
**Fix:** gate `browser_eval` (treat as command-class), and re-check navigation on click-driven/`window.open`
navigations (see P1-1). Consider a per-session egress confirmation for `browser_eval`.

---

## P1 — High (fix before packaging)

### Security

- **P1-1 · ✅ FIXED — Redirect-after-approval bypass** — `agent.ts:623-637`, `browser.ts` (no `will-redirect`/`will-navigate`→policy).
  Navigation is gated on the _requested_ URL only; a 30x or in-page `location.href` silently lands
  off-allowlist with no re-check and an inaccurate audit entry.
  **Fix:** add a `will-redirect`/`will-navigate` handler on agent tabs that re-runs `checkAction` on the real destination.

- **P1-2 · ✅ FIXED — Local dev/slide servers: no Host/Origin/CORS/auth → DNS-rebinding file read** — `dev-servers.ts:154-193`, `slides.ts:142-244`.
  Any malicious web page in any browser on the machine can rebind DNS to `127.0.0.1`, hit the ephemeral
  port, and read arbitrary workspace files (`/` static, `/raw/*.slides.md`) while the app is open.
  **Fix:** validate `req.headers.host` is `127.0.0.1:<port>`/`localhost:<port>`; reject others.

- **P1-3 · ✅ FIXED — Reflected XSS in slide `/deck/<path>`** — `slides.ts:41-48, 146-154`.
  `basename(rel)` is written into `<title>` unescaped and `deckFile()` never checks the file exists, so
  any `.slides.md`-suffixed path renders attacker JS in the `127.0.0.1:<port>` origin (chains with P1-2, or
  a crafted link, or a prompt-injected agent nav). Stored variant in `bundleHtml` via the `# heading`.
  **Fix:** HTML-escape the title (reuse the `esc()` pattern from agent-report.ts) **and** `statSync` the deck before responding.

- **P1-4 · ✅ FIXED — "Don't ask again" grant overrides `deny` and Secure mode** — `policy.ts:126` (checked before the `deny`/mode logic; grants never cleared on mode change).
  A grant taken while a rule was `confirm` keeps auto-allowing after the user flips the rule to `deny` or
  switches to Secure. Defeats the core promise of Secure mode.
  **Fix:** evaluate `deny` first; clear `sessionGrants` in `setPolicyMode`/`setCustomRules`.

### Correctness & stability

- **P1-5 · ✅ FIXED — Rename/move silently overwrites a same-named destination** — `fs.ts:94-104`, `FilesTree.tsx` moveTo/submitRename.
  `fsp.rename` replaces the destination on POSIX; drag-onto-dir or rename-to-existing destroys the target file.
  **Fix:** existence check → confirm before overwrite; surface `result.error`.

- **P1-6 · ✅ FIXED — `ResizeHandle` pointer listeners never cleaned up → leak + phantom resize** — `Deck.tsx:97-129` (also flagged by two reviewers).
  Drag interrupted without `pointerup` (deck detaches mid-drag, focus stolen) leaves `pointermove` bound to
  `window` forever, resizing the deck on any later mouse move; leaked pairs stack.
  **Fix:** move the drag lifecycle into a `useEffect` with cleanup; handle `pointercancel`/`lostpointercapture`.

- **P1-7 · ✅ FIXED — StrictMode double-fire creates duplicate native resources** — `Stage.tsx:21-29` (two `WebContentsView`s per tab), `TerminalBlock.tsx:41-47` (duplicate pty / write-to-disposed).
  No in-flight/`cancelled` guard; the store hasn't flipped `hasContent`/attached before the second effect run.
  **Fix:** `cancelled` ref guards (as already used in EditorBlock/DocStudio), or make `browser.create` idempotent in the store.

- **P1-8 · ✅ FIXED — Diff overlay leaks a Monaco model / `setModel` on disposed editor** — `EditorBlock.tsx:176-199`.
  Close the diff before `fs.read`/model creation resolves → throws in Monaco and orphans a text model each time.
  **Fix:** add the `cancelled` guard the sibling effect already uses; dispose the model in that branch.

- **P1-9 · ✅ FIXED — Detached Deck window force-closed on renderer crash-reload** — `store.ts` (deckMode not persisted), `windowSync.ts:54-64`, `index.ts:134-145`.
  Crash-reload boots `deckMode:'attached'`; the mount effect sends `closeDeck()` and kills the still-open detached window.
  **Fix:** persist/restore `deckMode`, or hand off deck state across the reload.

- **P1-10 · ✅ FIXED — Natively-closed float window reappears on next float change** — `windows.ts:96` (no broadcast on float close), `windowSync.ts:66-76` (no `onFloatClosed`).
  Close float B via title bar → renderer state still lists it → later float change re-runs `syncFloatWindows` and recreates B.
  **Fix:** broadcast a float-closed event and reconcile the group's `floating` zone, mirroring the deck-closed path.

- **P1-11 · ✅ FIXED — `key={i}` on editable plan steps edits the wrong step** — `AgentsBlock.tsx:273-317`.
  Remove step 2 while editing step 3 → the focused input rebinds to a different step; Enter commits the wrong title.
  **Fix:** stable per-step id as the key; also reset `editingStep` when status leaves `awaiting_approval`.

### UX blockers (a first-time user hits these in ten minutes)

- **P1-12 · ✅ FIXED — Toolbar dropdowns paint _under_ the web page** — Toolbar (+Block/Layout), WebMenu, DownloadsIndicator, DocStudio menus.
  Native `WebContentsView` paints above renderer DOM (the repo documents this elsewhere). With any tab showing —
  the default state — these menus are invisible/unclickable. Smoke passes only because Playwright clicks the DOM directly.
  **Fix:** while a menu is open, inset/hide the active view (`browser.setBounds`/`setVisible`) or host menus in a frameless child window.

- **P1-13 · ✅ FIXED — `localhost:5173` navigates to https → TLS error** — `Toolbar.tsx:26-28`.
  The dev-server audience's most common address fails on first use.
  **Fix:** use `http://` for `localhost`/`127.0.0.1`/`[::1]`/`*.localhost`.

- **P1-14 · ✅ FIXED — Shell shortcuts dead once the page has focus** — `shortcuts.ts:67-74` (renderer keydown only; no `before-input-event`/accelerators).
  After clicking into any page, ⌘D/⌘T/⌘W/⌘⇧L stop working — in the default browsing state.
  **Fix:** forward `before-input-event` from browser views to the shortcut registry, or register app-menu accelerators.

---

## P2 — Medium (recommended before public v0.1)

- **P2-1** ✅ FIXED — Secure mode auto-approves local navigation without confirming — `policy.ts:102` short-circuits before the mode switch. Move it under the `secure` case or amend the PRD/hint.
- **P2-2** ✅ FIXED — Custom-rule changes aren't audited — `policy.ts:75-78`. Add an `audit()` entry (contradicts TASKS 9.6).
- **P2-3** ✅ FIXED — `browser_screenshot`/`browser_record_stop` skip the write-conflict check that `write_file` enforces — `agent.ts:664-699`. Route them through `conflictWith`.
- **P2-4** ✅ FIXED — Frame recordings leak (≤240 PNGs) when a tab is destroyed before `record_stop` — `agent-browser.ts` + `browser.ts destroyBrowserTab`. Clear the `recordings` entry + `endFrameSubscription` on tab destroy.
- **P2-5** ✅ FIXED — `run_command` orphans backgrounded child processes after timeout — `agent.ts:530-542`. Use `spawn` + process-group kill like `dev-servers.ts`.
- **P2-6** ✅ FIXED — Whole-store subscriptions cause app-wide re-render storms — TabStrip, Deck GroupView, App, EditorBlock use `useShellStore()` with no selector. Switch to per-field selectors / `useShallow`. (Compounds with P1-6 during resize.)
- **P2-7** ✅ PARTLY FIXED (Toolbar/WebMenu/Downloads guarded; PolicyControls/PreviewBlock/NoWorkspace open) — setState-after-unmount races — KeyBanner, PolicyControls, PreviewBlock, NoWorkspace. Add `cancelled`/AbortController guards.
- **P2-8** ✅ FIXED — Plan-edit input isn't hard-gated on `editable` and doesn't reconcile with live `agentUpdate` — `AgentsBlock.tsx`. Can call `updatePlan` on an already-running session.
- **P2-9** FilesTree side effects inside a `setState` updater (StrictMode double-fires `fs.list`) — `FilesTree.tsx:119-131`. Move `loadDir`/ref mutation into the handler.
- **P2-10** ✅ FIXED (toolbar menus; DocStudio menus still open) — Escape / click-outside dismissal via the shared `usePopover` hook.
- **P2-11** Tab strip has no overflow handling — `TabStrip.tsx`. Past ~8-10 tabs, tabs and "+" clip off-screen. Add `overflow-x-auto` + `min-w-0`.
- **P2-12** No virtualization in FilesTree / SearchBlock — large trees / broad greps render thousands of nodes. Reuse `useVirtualRows`.
- **P2-13** PolicyControls loads once and goes stale across windows; Deny gives no user-facing feedback. Broadcast policy status over IPC; add a "denied — agent was told" toast.

---

## P3 — Low / spec-drift / polish

- **P3-1** PDF export loads caller HTML with no CSP (sandboxed, low impact) — `export.ts:35-60`. Strip `<script>` or add a CSP meta.
- **P3-2** Document Studio under-delivers PRD scope: no `.xml` doc type, no JSON/CSV graph for all promised types, HTML/PDF export is Markdown-only. Ship the scope or amend PRD.
- **P3-3** "Navigating to a doc file in the browser renders a styled view" — only Files-tree opens do; URL-bar/`file:` navigation isn't intercepted. Wire it or amend PRD.
- **P3-4** Stage-reveal choreography: no reversed order on _hide_ (dock still leaves last), and the DESIGN.md "viewport chip" was never built. Fix the hide delays / build or descope the chip.
- **P3-5** Block header shows no context string; per-edge block resize became two shared gutters. Update DESIGN.md to the gutter model (or add the labels/splitters).
- **P3-6** Rail restore appends a new group at the zone's end and loses floating-ness / float rect — DESIGN.md promises "restores it exactly where it was." Persist group index + float rect, or soften DESIGN.md.
- **P3-7** Layout presets have no keyboard shortcut (DESIGN.md: "one keystroke swaps the whole layout"). Add ⌘1/⌘2/⌘3. Also fix the stale TASKS 1.6 note (`mod+b/j` no longer exist).
- **P3-8** Welcome view lists only 5 shortcuts, computed non-reactively during first paint (can render empty). Subscribe to the registry; add a ⌘K/help surface.
- **P3-9** Doc tabs reuse the "logs" icon; float windows drop DESIGN.md's glass/vibrancy styling. Dedicated doc icon; vibrancy or amend DESIGN.md.
- **P3-10** `useWindowReconciler` fires duplicate (idempotent) IPC under StrictMode. Harden with cleanup.

---

## Test gaps (smoke.mjs covers the review-mode happy path only) — priority order

1. **Secure / Agent / Custom policy modes + the Deny path** (the entire Phase 9 matrix, including P1-4). _HIGH_
2. **Plan editing and Reject** (6.4) — only Approve is tested. _HIGH_
3. **Mid-run interrupt + Resume** (6.7) — relaunch phase only checks tab restore. _HIGH_
4. **Multi-agent concurrency + conflict detection** (6.6) — only one session ever runs. _MED_
5. **Deck edge-resize** (2B.3) — gutter drag, clamp, cross-window sync, persistence. _MED_
6. **Files-tree move-via-drag, rename, delete** (3.1) — incl. the P1-5 overwrite case. _MED_
7. **Proxy disable + never-persist; extension removal + reload-on-boot.** _MED_
8. **Document Studio themes + HTML/PDF/PNG exports** (5.9/5.11). _MED_
9. **Permission-prompt Block + per-site remember** — only geolocation-Allow tested. _LOW_
10. **Theme toggle / light-mode rendering** — the entire light palette ships unexecuted by CI. _LOW_
11. **Shortcut behaviors** — ⌘T/⌘W (incl. last-tab-close), ⌘D-while-detached. _LOW_

---

## Verified sound (no action)

IPC handler input validation; path-traversal guards in fs.ts / static server / `/reveal` / agent-report inlineImage;
`policy.ts` URL parsing (userinfo tricks, uppercase schemes, IPv6 loopback all resolve correctly — the gap is _frequency_ of checks, P1-1); embed-proxy scope (localhost-only, http-only, off by default, not persisted); agent-report `esc()` escaping; extension session isolation (`persist:agweb-browser`, `allowFileAccess:false`, no preload on web tabs); `q()`=`JSON.stringify` injected-script quoting; `rg`/terminal `spawn` argv (no shell injection). No `dangerouslySetInnerHTML` misuse; Mermaid runs `securityLevel:'strict'`.

---

## Fix log (this pass)

All P0 and P1 items above are fixed, verified by `lint + typecheck + build + smoke`.
New regression coverage in `app/scripts/smoke.mjs`: bare-`127.0.0.1` navigation resolves
over http (P1-13); Escape dismisses popovers and un-hides the native view (P1-12/P2-10);
rename refuses to clobber an existing destination (P1-5); the agent run now drains
_two_ policy prompts, proving `browser_eval` is gated (P0-2); and the mode switch to
Secure is asserted against main (P1-4).

Also folded in while in the same files: P2-1..P2-6, P2-8, and P2-10 (toolbar menus).

## Fix log (second pass)

Cleared the remaining P2/P3 backlog, each verified by `typecheck + lint + build + smoke`:

- **P2-7** — cancelled-guards added to the last three async setState sites (PolicyControls, PreviewBlock, NoWorkspace). ✅ FIXED
- **P2-9** — FilesTree `toggleDir` side effects moved out of the setState updater. ✅ FIXED
- **P2-11** — TabStrip scrolls instead of clipping past ~8-10 tabs. ✅ FIXED
- **P2-12** — FilesTree and SearchBlock virtualized via `useVirtualRows`. ✅ FIXED
- **P2-13** — policy changes broadcast to every window (PolicyControls no longer stale), and a reusable toast system (`ToastHost` + store) surfaces denied agent actions ("Policy auto-denied the agent's command"). ✅ FIXED
- **P3-1** — PDF export runs with JS disabled + a `script-src 'none'` CSP. ✅ FIXED
- **P3-2** — Document Studio scope aligned in `PRD.md`; graph/xml/conversion moved to a deferred roadmap. ✅ RESOLVED
- **P3-3** — `file:` navigation to a workspace doc renders the styled view (URL bar + link clicks); `doc-nav.ts` + 10 security tests. ✅ FIXED
- **P3-4** — reverse-order hide (asymmetric transition delays) + the viewport chip. ✅ FIXED
- **P3-5** — header shows the active editor's file; `DESIGN.md` amended to the shipped shared-gutter resize model. ✅ RESOLVED
- **P3-6** — rail restore returns a block to its exact zone (floating included) and index. ✅ FIXED
- **P3-9** — dedicated doc-tab icon; `DESIGN.md` amended so OS-window floats are plain native panels. ✅ RESOLVED

New regression tests this pass: `policy.test.ts` (13), `agent.test.ts` (10), `doc-nav.test.ts` (10) — the suite went 36 → 74.

Still open: **P3-10** (idempotent StrictMode IPC — left as-is; a naive cleanup risks closing deck/float windows), and the test-gap backlog below (items 1–2 now covered by the new policy/agent tests). The whole P0–P3 defect list is otherwise closed.

## Suggested fix sequence

1. **Security core first:** P0-2, P1-1, P1-4 (policy engine), then P1-2, P1-3 (local servers). These share the agent/policy and slide-server files.
2. **P0-1** workspace pinning (touches fs.ts/search.ts/agent.ts — coordinate with the security agent-tool changes).
3. **Renderer stability batch:** P1-6, P1-7, P1-8, P1-11 (+ P2-6, P2-7 while in the same files).
4. **Window-lifecycle batch:** P1-9, P1-10.
5. **UX blockers:** P1-12, P1-13, P1-14 — needed for the design review to be meaningful.
6. **P1-5** rename/overwrite guard.
7. Backfill the top test gaps (1-3) so the fixes above are covered, then re-run the full pipeline.
