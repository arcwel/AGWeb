# AGWeb Security Model

Threat-model review for Phase 9 (task 9.7). Scope: the embed proxy, extension
loading, the agent runtime, and the trust boundaries between them.

> Reviewed and hardened after the v0.1 QA audit (see `QA_AUDIT.md`): the agent
> policy gate now covers page-driving tools and re-checks redirects, and both
> local servers require a loopback `Host`. Fixed findings are marked in that doc.

## Process & trust boundaries

- **Main** is the only privileged tier. **Renderers** run sandboxed with
  context isolation, no Node access, and a strict CSP (`frame-src` opened for
  localhost origins only). The typed `window.agweb` bridge is the sole surface;
  every IPC handler validates its inputs before acting.
- **Web content** runs in a separate persistent partition
  (`persist:agweb-browser`), fully sandboxed, with no preload. Web permissions
  (geolocation, media, …) resolve through a user prompt with per-site,
  per-run memory; every decision is audited.
- **Workspace scoping**: all agent/file IPC resolves paths against the open
  workspace root and rejects traversal outside it. The static preview server
  and slide server apply the same prefix checks; the slide server additionally
  serves only `*.slides.md` sources and files under the bundled reveal dist.

## Embed proxy (header stripping) — scope and rationale

The dev-preview embed proxy removes `X-Frame-Options` and only the
`frame-ancestors` CSP directive so local dev servers can render in preview
iframes. Containment:

- **Origin-limited**: the rewrite matches `http://localhost/*` and
  `http://127.0.0.1/*` only. Arbitrary web origins are never rewritten, so
  clickjacking protections of real sites stay intact.
- **Off by default, never persisted**: each run starts disabled; enabling it
  is an explicit user action with a visible amber toolbar indicator, and it
  can be disabled with one click.
- **Residual risk**: a malicious page could redirect to a local dev port and
  be framed while the proxy is on. Mitigated by the preview iframe's sandbox
  (`allow-scripts allow-same-origin allow-forms`, no top-navigation, no
  popups) and by the proxy's off-by-default posture.

## Extensions

- Only **unpacked MV3** extensions load, from explicit user-chosen
  directories, into the browser partition only — never into the shell
  renderer. `allowFileAccess` is false.
- Electron implements a subset of `chrome.*`; there is no Web Store install
  path, no remote update channel, and no action-popup UI. Extensions are
  listed and removable in the Web menu; persisted paths reload only while
  they still load cleanly.
- **Residual risk**: a content script runs in every matching page in the
  browser partition (standard extension power). Loading an extension is
  treated as trusting its author, same as Chrome's unpacked-extension mode.

### VS Code extensions (task 12.8) — not shipped, and why

VS Code extensions from Open VSX were scoped in task 12.8. The client pieces
exist and are MIT (`@codingame/monaco-vscode-extensions-service-override`
supports a web-worker extension host), but **the isolation the design depends
on does not hold in this app as built**, so nothing was shipped.

VS Code runs web extensions in a worker inside an iframe on a *different
origin* from the workbench. That origin separation is the sandbox. AGWeb's
renderer is served from `file://`, where:

- `mainWindow.origin` is `file://`, so there is no second origin to isolate
  onto — an extension would run with the shell renderer's own privileges,
  which is precisely what the sandbox exists to prevent; and
- our `frame-src` refuses the host iframe outright. Enabling the worker host
  produces `Refused to frame 'file:///…/webWorkerExtensionHostIframe-*.html'`.

Loosening `frame-src` would silence the error while leaving the real problem —
extension code running un-isolated in the renderer that holds the `window.agweb`
bridge. That is a worse position than not supporting extensions.

**Prerequisite for revisiting:** serve the renderer from a local HTTP origin
(custom protocol or a bound localhost server) so a distinct extension-host
origin exists, then gate installation through the Phase 9 policy engine as a
`command`-class action. That is an architectural change to how the app is
served and is tracked against task 12.8 rather than smuggled in.

## Workspace roots (task 3B.4)

Path containment is the boundary the whole app rests on, so it lives in one
function — `resolveInWorkspace` in `src/main/fs.ts`. Multi-root widened what
that function accepts, and the rules were chosen to widen it as little as
possible:

- **Relative paths are unchanged.** They resolve against the primary root
  only. Every pre-existing caller therefore means exactly what it meant
  before; multi-root cannot silently retarget an old code path.
- **Absolute paths are the only way to reach another root**, and are accepted
  only if they land inside a folder the user granted. Anything else is
  refused, as before. This is not filesystem access.
- **A grant is explicit and human.** The only way to add a root is
  `workspace:add-root`, which always opens a folder picker. There is
  deliberately no path-taking variant, so no page, tool call, or agent action
  can widen the boundary — only a person choosing a folder.
- **Grants are per session and never persisted.** VS Code remembers workspace
  folders; we do not. Re-granting yesterday's folders at launch would widen
  the agent's reach without anyone deciding to that day. Opening a different
  project also clears them, since they were granted against the old one.
- **Pinning still wins.** A caller that passes an explicit `root` (every agent
  session does — it pins the workspace it started in) is confined to that
  root regardless of what has since been granted. An agent cannot reach a
  folder added after it started.
- **No root can be deleted through the file API**, not just the primary one.

**Residual risk**: a granted folder is fully readable and writable by the
agent for the rest of the session, subject to the same Phase 9 policy prompts
as the primary root. Granting a folder is therefore the same kind of decision
as approving a plan — it is bounded by the policy mode in force, not by the
folder being special. Revoking is one click in the Files block.

## Agent runtime — escape paths considered

The agent executes only through workspace-scoped tools; the Phase 9 policy
engine (`src/main/policy.ts`) is the central gate:

- **File writes** resolve inside the workspace (traversal rejected at the fs
  layer) and pass the policy gate (`secure` confirms each; `review`/`agent`
  auto-approve inside the workspace).
- **Shell commands** run with the workspace as cwd but are _not_ OS-sandboxed
  — a command can touch anything the user can. This is why `review` (the
  default) and `secure` modes require explicit confirmation per command (or a
  per-session, per-kind grant), and why every decision is written to
  `userData/audit.jsonl`.
- **Browser navigation** by agents is gated: local targets (`localhost`,
  `data:`, `file:`, `about:`) auto-approve outside Secure mode (Secure confirms
  everything); external hosts need the mode's allowlist or a user confirmation.
  Agent-driven tabs are real shell tabs the user watches live. Approval binds to
  the URL the tab _actually loads_: a `will-redirect`/`will-navigate` guard
  re-runs the policy on every redirect and in-page navigation and cancels the
  ones it would not have approved, so a 302 cannot walk the tab off-allowlist.
- **Page-driving tools are gated too.** `browser_eval` injects script into the
  page origin — an egress channel (fetch/beacon/`location`) — so it passes the
  same gate as a shell command. `browser_click` can drive navigation, so the
  navigation guard re-checks where the tab lands afterwards.
- **Agent file tools are pinned to the session's workspace.** Every read/write/
  list/search resolves against the workspace the session started in, not the
  live one, so opening another project mid-run cannot retarget an agent's writes.
- **Prompt-injection surface**: page text read via `browser_read`/
  `browser_eval` re-enters the model as tool results. The policy gate is the
  backstop: even a hijacked session cannot write outside the workspace, and
  cannot run commands or leave the allowlist unconfirmed in the default mode.
- **Plan approval** remains a hard gate: no filesystem or terminal execution
  before a human approves the plan.

## Local HTTP servers (preview + slides)

The static preview server and the slide server bind `127.0.0.1` on ephemeral
ports. Loopback binding does not stop DNS rebinding, so both require a literal
loopback `Host` header (`127.0.0.1:<port>`, `localhost:<port>`, `[::1]:<port>`)
and answer anything else with 403 — a rebound attacker hostname never matches.
The slide server additionally serves only deck files that exist on disk and
HTML-escapes every interpolated value.

## Audit trail

`userData/audit.jsonl` records every policy decision (automatic and human),
every web-permission decision, and mode changes, each stamped with the active
mode and timestamp. Session execution logs and artifacts (Phase 8) provide
the per-action evidence trail.

## Known gaps (tracked)

- Agent commands are unsandboxed at the OS level (see above); OS-level
  sandboxing (e.g. seatbelt profiles) is future work. Commands do run in their
  own process group so a timeout reaps the whole tree rather than orphaning
  backgrounded children.
- The audit log is plain JSONL without tamper-evidence.
- Packaged-app hardening (asar integrity, code signing) lands with Phase 10.
