# Arcwel WebDeck Security Model

Threat-model review, originally for Phase 9 (task 9.7): the embed proxy,
extension loading, the agent runtime, and the trust boundaries between them.
Extended for the Chromium fork under task 13.8e.

> Reviewed and hardened after the v0.1 QA audit (see `QA_AUDIT.md`): the agent
> policy gate now covers `browser_eval` and re-checks redirects, and both local
> servers require a loopback `Host`. Fixed findings are marked in that doc.
> (`browser_click` and `browser_type` are still ungated — see below.)

> **Two shells, one core.** WebDeck ships as an Electron app *and* runs as
> `chrome://webdeck` inside a forked Chromium. The application logic is the
> same either way — it lives in `webdeck-core` — but the boundaries around it
> are not. Sections below are marked **(Electron shell)** where they describe
> machinery that exists only there; the fork is covered in its own sections and
> in **Known gaps**.

## The Chromium fork — where the boundaries now are

The fork (`chromium/`, pinned at 153.0.8010.12 in `fork.json`) serves the real
application bundle at `chrome://webdeck`, and that page talks to a standalone
`webdeck-core` process over a loopback WebSocket. Electron handed us Chromium's
defences by default; a fork means we own them, so this section states them as
measured rather than as assumed.

Five participants, in decreasing order of privilege:

1. **The browser process** — Chromium's own, unchanged. Renderers are
   sandboxed; site isolation is full.
2. **The `chrome://webdeck` page** — a WebUI renderer, sandboxed like any
   other, but holding two things no ordinary page has: the core's connection
   token, and a Mojo handle to `AgentTabs` (below).
3. **`webdeck-core`** — a plain Node process the browser launches. **Outside
   the sandbox, with the user's full privileges.**
4. **The agent** — runs inside the core, gated by `src/main/policy.ts`.
5. **The pages the agent visits** — untrusted, and the source of every
   injection concern in this document.

The boundary between 1 and 2 is Chromium's, and it is measured rather than
assumed: `npm --prefix app run verify:hardening` launches the built browser and
reads the live process tree and the live page, because a `gn` arg or a stray
switch can turn any of this off with no visible symptom. On the current macOS
arm64 build it reports **14 passes, 0 failures, 3 warnings**: every renderer
holds a macOS seatbelt handle, `chrome://process-internals` reports Site Per
Process, a cross-site iframe really does land in its own renderer, and on the
page itself `eval` and an injected inline `<script>` are both *refused at
runtime* — measured inside a same-origin worker, because a DevTools evaluation
is exempt from the page's CSP and would have passed either way. It also raises
three warnings: the unsandboxed core (next section), `is_component_build` and
`dcheck_always_on` (both in **Known gaps**).

The boundary between 2 and 3 is ours. It is the next two sections.

### webdeck-core is outside the sandbox — say it first

The core is the one part of the tree Chromium's sandbox does not cover, and it
is that way on purpose: it spawns ptys, reads and writes the workspace, runs
the debug adapter and the agent SDK, and holds the provider API key. Every one
of those is something the sandbox exists to deny, so the core could not be a
sandboxed child and still be the core. `verify-hardening` names it explicitly
rather than letting a page of ticks imply the whole tree is contained —
"outside the sandbox, with full user privileges: … `webdeck-core.cjs`".

The page is *allowed* to reach it. `connect-src` on `chrome://webdeck` includes
`ws://127.0.0.1:*` and `ws://localhost:*` precisely so that socket can be
opened. So the honest statement of the residual is:

**A compromise of the `chrome://webdeck` page inherits the core's authority —
the user's filesystem, a terminal, the provider key, and the policy that gates
the agent. There is no second boundary behind that page.**

Everything that keeps the page from being compromised is a *preventive*
control, not a containment one: the bundle is entirely first-party, no remote
origin appears in `connect-src`, `eval` and injected inline script are refused,
`frame-ancestors 'none'`, and Trusted Types is required on script sinks. Those
are good controls. They are not a boundary, and nothing here should be read as
claiming one.

Two deliberate softenings of that page's CSP, both narrowing the statement
above rather than changing it:

- `trusted-types *` allows any policy **name** — Monaco derives dozens at
  runtime, so an allowlist of names would break on every Monaco upgrade — while
  keeping `require-trusted-types-for 'script'`. The sinks are still guarded;
  only the enumeration is given up.
- `connect-src` allows **any** loopback port, not just the core's, because the
  core's port is ephemeral and cannot be pinned in a static header. A page-level
  compromise could therefore address any local service, not only ours.

### The core socket: what the token buys, and what it does not

Two checks guard every connection, both at the HTTP upgrade, so a caller that
fails either never holds a socket (`transports/ws-server.ts`, `transports/auth.ts`):

- **A per-boot token** — 256 bits from the CSPRNG, base64url, compared in
  constant time. It rides in `Sec-WebSocket-Protocol`, not a query string,
  because a URL is the most copied, logged and forwarded part of a request; a
  header is the only carrier a page can set, since browsers refuse arbitrary
  WebSocket request headers. It is deliberately **not** printed to stdout, which
  the spawning process inherits.
- **The `Origin`** — `chrome://webdeck` and nothing else. A connection with no
  `Origin` at all is not a browser and is judged on its token alone; a page
  cannot omit or forge the header, so nothing is lost by that.

Both fail closed — absent is refused exactly like wrong. The token reaches the
browser only through the handoff file (mode `0600`, in a temp directory the
browser creates); a failure to write that file is fatal at boot rather than
swallowed, because a core whose token nobody has is a core nobody can talk to.
The browser re-validates what it reads (port in range, token at least 16
base64url characters) and emits it through a JSON writer rather than
`StringPrintf`, so a corrupt or hostile handoff cannot inject script into a
privileged page. `--host` is enforced loopback-only in the core's CLI, which
exits 2 on anything else — the docs claimed "loopback only" before anything
made it true.

**What this defends against:** any other local process dialling the port
(loopback is not a boundary — *any* process on the machine can reach it, not
only this user's), and any web page the user happens to open attempting a
WebSocket to
`ws://127.0.0.1:<port>`. WebSocket is not subject to the same-origin policy, so
the port *is* reachable from a random page; the `Origin` check is what makes
that reach useless.

**What this does not defend against:** anything that can already read the
user's own files. The token sits in a `0600` file this user can read, as does
the AES key file behind the standalone keystore. A process running as the user
is *inside* the boundary, full stop. The token raises the bar from "any local
process" to "any local process that can read this user's files" — that is the
entire claim, and it is worth having, but it is not a claim about malware
running as the user.

### The agent acting as the user

`chromium-agent-browser.ts` defines two modes, because the right answer depends
on whether the page is trusted:

- **`isolated`** — a throwaway profile in a headless browser, no cookies, no
  ambient authority. An injected page can still lie to the agent, but it cannot
  act as the user.
- **`session`** — the user's own browser, their cookies and logins, in tabs
  they watch. This is the mode that matters for real work; it also means the
  agent acts *as* the user, indistinguishable from the user to the site and in
  the site's logs.

**Today the fork still runs `isolated` only, and the reason is worth being
precise about, because the code no longer reads that way.** The module's header
comment says `session` is the default; the code defaults to `isolated`
(`chromium-agent-browser.ts`), and `server.ts` constructs the agent browser
without passing a mode at all. The `session` branch there also needs a CDP
endpoint (`sessionCdpPort` / `$WEBDECK_BROWSER_CDP_PORT`) that nothing
publishes. Read that comment as intent, not as behaviour.

The path the fork actually takes for session mode is different, and better: the
in-process Mojo interface in `webdeck.mojom` / `webdeck_agent_tabs.cc`. That
choice is a security decision worth recording. The other way to get CDP against
the user's real session is `--remote-debugging-port`, which is *unauthenticated
total control* of that browser for any local process — upstream Chromium
blocked it on the default profile for exactly that reason. `AgentTabs` listens
on no socket; it is reachable only from the WebUI page, over a handle the
browser hands it. The chain is
`agent → core → [socket] → page → [Mojo] → browser → tab`, which is long, but
every link is one we already authenticate or already trust, and none of them is
a port.

Its scope is narrow by construction: only tabs opened through `OpenTab` are
addressable, so it cannot attach to a tab the user opened; the
`http`/`https`/`file` scheme allowlist is enforced in C++ as well as in the
core, so a page that talked to the interface directly gets no wider reach than
the agent has; and it uses `AttachClient` rather than `ForceAttachClient`, so it
fails loudly instead of silently displacing another debugger.

**The halves exist but are not joined.** `src/webui/agent-tabs.ts` serves the
`agent-tabs:*` reverse RPCs and `main.tsx` registers it; `src/core/page-agent-browser.ts`
implements the core-side driver, with the same navigation guard as the isolated
mode. But **nothing selects it** — `pageAgentBrowser` has no call site, and
`server.ts` still builds the isolated browser unconditionally. So the page will
answer calls no one makes, and the agent still gets a throwaway profile. This is
new, in-flight work; when the two halves are joined the agent begins acting as
the user, and this section needs rewriting rather than extending.

### What stops an injected page, and what does not

The policy gate (`src/main/policy.ts`) is the backstop, and its precedence
order *is* the security property: an explicit per-site **deny** first (nothing,
including full autonomy, overrides it), then a per-site **allow** (which also
lifts the sensitive-site check — that check exists to catch sites the user has
not considered, not to argue with ones they have), then the sensitive-site
check, then the mode.

`SENSITIVE_HOSTS` is **a seed list of twenty hosts, not categorisation**. There
is no way to enumerate every bank, broker or patient portal from a keyword, and
the code says so itself. A bank that is not on the list gets no special
treatment whatsoever. Its job is to make the highest-consequence destinations
stop and ask by default and to give the user somewhere to start; the real
protection is the user's own per-site decisions.

Gated, in the fork exactly as under Electron: `file_write` (writes, directory
creation, moves, deletes, screenshot paths), `command`, `browser_navigate`
(both `browser_open` and `browser_navigate`), and `browser_eval` — which is
gated as a `command`, because injected script runs with the page origin's full
powers and is therefore an egress channel.

**Not gated: `browser_click` and `browser_type`.** A click gets a *post hoc*
navigation re-check and nothing else; typing gets nothing at all. So a click
that submits a form or fires an XHR without navigating — "Confirm", "Send",
"Delete" — passes no gate in any mode, and neither does filling the form that
precedes it. In `isolated` mode that is bounded by having no cookies; when
session mode lands, it will not be. This is the sharpest edge in the current
design and it is not yet tracked as its own task.

The fork's navigation guard hangs off `Page.frameRequestedNavigation` and calls
`Page.stopLoading`. Note two differences from the Electron guard it replaces:
it **denies on a `confirm` verdict rather than prompting** (the model is told
afterwards through `takeBlockedNavigation`, so it is stricter but silently so),
and there is no test covering it — that it catches server-side 30x redirects as
completely as Electron's `will-redirect` did is asserted in a code comment and
is **unverified**.

Fail-closed behaviour is real and worth naming: a `confirm` verdict with no UI
attached denies and writes `[no prompt UI attached]` to the audit log rather
than hanging the agent, while an `allow` verdict still proceeds headless — the
distinction that lets the core run before a window is connected.

### Prompt injection, specifically

Page text read through `browser_read` re-enters the model as a tool result.
Nothing marks it as untrusted when it does.

As publicly described, the other agentic browsers converge on three
mitigations: **per-site permission** (the user grants a site before the agent
acts there), **screening of proposed actions** before they run, and **a second
model judging whether an action matches what the user actually asked for** —
Google has described a "User Alignment Critic" for Gemini in Chrome, and
Claude for Chrome describes site-level permissions, blocked site categories,
and confirmation on high-risk actions. Those are their published claims, not
things measured here; the point of citing them is the shape of the design, not
its effectiveness.

Of those, **we have the first and not the other two.** We have per-site allow
and deny with deny winning, a sensitive-host seed list, a policy gate on
writes, commands, navigation and `eval`, secret redaction on captured bodies
and console lines, a plan a human approves before execution, and an audit log.
We have **no** screening of the agent's proposed actions for injected
instructions, **no** second model checking alignment with the user's request,
and **no** provenance marking on page-derived text. This is unbuilt, not
partial — grepping the codebase for any such check finds nothing.

The residual, stated plainly. In `review` (the default), an injected page can
make the agent read anything in the workspace, write anywhere inside it without
asking, and click and type on any page it already has open; commands and
off-allowlist navigation are proposed to the user, so **the human is the
injection filter**. In `autonomous`, there is no filter: `decide()` returns
`allow` for every file write and every command with no prompt at all, and for
navigation once past the two navigation-only checks. For the filesystem and the
shell, **the audit log is the only record that anything happened** — and
`audit.jsonl` is plain JSONL with no tamper-evidence, written by the same
process an attacker would be driving. It is a record, not a control.

One escalation path is closed: a synced settings file cannot set `autonomous`.
`sanitizeSyncedPolicyMode` refuses it and audits the refusal, because a file in
a shared folder must not be able to mean "act as the user, without ever asking,
on every device they own".

## Process & trust boundaries (Electron shell)

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

**Under the fork, two of those three sentences do not carry over.** There is no
preload and no Electron IPC, so `window.agweb` is rebuilt on the WebSocket
client instead — and the page has a *second* surface the Electron renderer did
not: the `AgentTabs` Mojo handle. There is also no `persist:agweb-browser`
partition; web content is ordinary Chromium tabs in the user's profile, with
site isolation doing the work the partition used to describe. Workspace scoping
is unchanged — `resolveInWorkspace` is in the shared core and applies either way.

## Embed proxy (header stripping) — scope and rationale (Electron shell)

The embed proxy lives in `src/main/embed-proxy.ts` and has **no counterpart in
the fork**: there is no `webRequest` header rewriting there. What the fork
offers instead is narrower and static — `chrome://webdeck`'s `frame-src` admits
`http://127.0.0.1:*` and `http://localhost:*` so the Preview block and Reveal
decks render, and nothing rewrites any site's headers.

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

## Extensions (Electron shell)

> Under the fork this section describes the wrong system: extensions are
> Chromium's own, with Chromium's full `chrome.*` surface rather than
> Electron's subset. Whether the Web Store install path stays open in the fork
> is an unmade decision, and it is a larger one than it was here — a real Web
> Store install is a remote update channel we would be carrying.

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

**The fork changes the premise but not the answer.** `chrome://webdeck` *is* a
real origin, so the "there is no origin to isolate onto" half of the argument
no longer applies. The other half gets worse: a WebUI page is more privileged
than a `file://` page, not less — it is the page holding the core token — so
running third-party extension code in it would be a bigger mistake there than
here. The prerequisite is now specifically a *second, unprivileged* origin for
the extension host, not merely an origin.

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
  Under Electron, agent-driven tabs are real shell tabs the user watches live —
  **that is not true on the fork**, where the agent runs an isolated headless
  browser the user cannot see (see *The agent acting as the user*). Approval
  binds to the URL the tab _actually loads_: a `will-redirect`/`will-navigate`
  guard re-runs the policy on every redirect and in-page navigation and cancels
  the ones it would not have approved, so a 302 cannot walk the tab
  off-allowlist. The fork's equivalent guard, and how it differs, is described
  above.
- **Page-driving tools are partly gated.** `browser_eval` injects script into
  the page origin — an egress channel (fetch/beacon/`location`) — so it passes
  the same gate as a shell command. `browser_click` can drive navigation, so the
  navigation guard re-checks where the tab lands afterwards. But the click
  itself passes no gate, and `browser_type` passes none either: a click that
  submits or fires an XHR without navigating is ungated in every mode. See
  *What stops an injected page, and what does not*.
- **Agent file tools are pinned to the session's workspace.** Every read/write/
  list/search resolves against the workspace the session started in, not the
  live one, so opening another project mid-run cannot retarget an agent's writes.
- **Prompt-injection surface**: page text read via `browser_read`/
  `browser_eval` re-enters the model as tool results. The policy gate is the
  backstop: even a hijacked session cannot write outside the workspace, and
  cannot run commands or leave the allowlist unconfirmed in the default mode.
  That is the whole of the defence — there is no injection screening. See
  *Prompt injection, specifically*.
- **Plan approval** remains a hard gate: no filesystem or terminal execution
  before a human approves the plan.

## Local HTTP servers (preview + slides)

The static preview server and the slide server bind `127.0.0.1` on ephemeral
ports. Loopback binding does not stop DNS rebinding, so both require a literal
loopback `Host` header (`127.0.0.1:<port>`, `localhost:<port>`, `[::1]:<port>`)
and answer anything else with 403 — a rebound attacker hostname never matches.
The slide server additionally serves only deck files that exist on disk and
HTML-escapes every interpolated value.

Both are registered by the core (`registerDevServersRpc`, `registerSlidesRpc`),
so they behave identically on the fork; `chrome://webdeck`'s `frame-src` is what
lets their pages be framed, and it admits loopback only.

**Residual risk, and the contrast with the core socket is the point.** The
`Host` check defeats DNS rebinding; it is not authentication. The static
preview server serves everything under the workspace root, and while it is
running **any local process — including one belonging to another user on the
machine — can read the whole workspace through it** simply by sending a correct
`Host` header. The core socket got a per-boot token for exactly this reason;
these servers did not. They are shorter-lived and started by an explicit user
action, which is why this has not been treated as urgent, but it is the same
class of exposure and it is not currently tracked.

## Audit trail

`userData/audit.jsonl` records every policy decision (automatic and human),
every web-permission decision, and mode changes, each stamped with the active
mode and timestamp. Session execution logs and artifacts (Phase 8) provide
the per-action evidence trail.

Two honest limits. It is plain JSONL with **no tamper-evidence**, appended by
the same process that would be under an attacker's control — so it is evidence
for a user reviewing what happened, not a control that stops anything. And
under `autonomous` it is the *only* record of a file write or a shell command,
because nothing else in that mode produces one.

## WebDeck Sync (settings sync)

Sync reads a JSON file the user chooses and applies its sections to app
settings, permission policy, AI model, and theme. Trust and hardening:

- **Every applied value is validated** — the `policy` section reuses the exact
  validators the IPC path uses (`sanitizePolicyMode` / `sanitizeCustomRules`);
  `settings` goes through `sanitizePatch`; `model` is allowlisted; `theme` is a
  two-value literal. Malformed or unknown-shaped values are dropped, never
  partially applied. Section keys `__proto__`/`constructor`/`prototype` are
  ignored (no prototype pollution).
- **No silent security change** — a pull that applies anything raises a visible
  toast ("Settings updated from a synced device"), and policy changes also fire
  the normal policy-changed broadcast that updates the UI.
- **Atomic writes can't be redirected** — the temp file uses a random name and
  `O_EXCL` (`wx`), so a pre-planted symlink in a shared sync folder can't divert
  the write onto another file.
- **The top rung is out of reach.** `sanitizeSyncedPolicyMode` refuses a synced
  `autonomous` and audits the refusal, so a file in a shared folder can never
  mean "act as the user, without ever asking, on every device they own".
  Escalating to full autonomy has to be a local choice made in front of the
  person who owns the session.
- **Residual risk (documented):** the file is still trusted for its *content* —
  anyone with write access to the chosen folder can set any other *valid*
  policy, including a more permissive one such as `agent` with a wide host
  allowlist, which applies on the next pull (with the toast above, but no
  confirmation). Keep the sync file in a private, non-shared location. A
  confirm-on-loosen prompt for policy specifically is planned follow-up.

## Agent Vision (browser instrumentation)

The agent records an agent-driven tab's network + console via CDP. Response
**bodies** are captured only for HTTP-error responses that are **same-origin**
with the tab's document (CDP can otherwise read cross-origin bodies the page
itself cannot, pre-CORS), and every captured body and console line is run
through a secret-redaction pass (tokens, keys, JWTs) before it can enter the
agent's context or the on-disk transcript. Request URLs themselves are recorded
un-redacted, so a secret placed in a URL query string is still visible to the
agent — the same exposure a person opening DevTools would have.

## Where API keys come from (user's choice)

Settings → AI offers two sources, and the panel states the trade-off rather than
leaving the user to infer it:

1. **Store in WebDeck** (default) — encrypted at rest: `safeStorage` (OS
   credential store) under Electron, the AES-GCM keystore below in the
   standalone core.
2. **Use my password manager** *(recommended)* — WebDeck stores **nothing** and
   runs a per-provider command you configure (`op read op://…`, `pass show …`,
   `security find-generic-password -w -s …`, `vault read …`), using what it
   prints. This is the stronger option for the same reason git has
   `credential.helper`: your vault already gates access on an unlocked session,
   audits reads, and handles rotation — and a leaked WebDeck data directory then
   contains no key at all.

Hardening on the command path:

- **No shell.** The command line is tokenized to argv here, so `;`, `|`, `$(…)`
  and friends are literal arguments, not operators.
- **Never synced.** This setting names a command to execute, so it is
  deliberately excluded from WebDeck Sync — accepting it from a shared folder
  would be arbitrary code execution for anyone who can write there.
- **Failure is closed, not silent-plaintext.** A locked vault or missing binary
  yields no key; WebDeck falls back to the environment variable or reports the
  provider unconfigured. It never degrades to storing plaintext.
- Fetched values are cached in memory for 5 minutes so a vault unlock/touch
  isn't demanded on every call, and the cache is dropped whenever the
  configuration changes.

## Secret storage outside Electron (standalone `webdeck-core`)

Under Electron, provider API keys are encrypted with `safeStorage` (the OS
credential store). The standalone core the Chromium fork spawns has no such
facility, and `secrets.ts` refuses to write plaintext — so it encrypts with
**AES-256-GCM under a 32-byte key in a `0600` file** beside the data
(`src/core/node-keystore.ts`).

Be precise about what that buys: it protects the ciphertext wherever it travels
**without** the key file — a copied or cloud-synced `secrets.json`, a backup, a
support bundle, a disk image. It does **not** protect against an attacker who
can already read the user-data directory as this user, since the key file is
there too. That is weaker than an OS keychain (which can require a live unlocked
session) and stronger than the alternatives available in plain Node (plaintext,
or refusing to store a key at all). A malformed key file reports the store
unavailable rather than silently rotating and stranding every stored secret.
When the fork exposes a real keyring binding, that implementation replaces this
one behind the same `SecretStore` interface.

This is no longer the hypothetical branch: on the fork it is **the** path a
provider key takes. Its key file and the core's `0600` handoff token are both
protected by the same thing — POSIX file permissions on this user's own files —
so an attacker who can read one can read the other. That is a single limit, not
two layers, and it is the same one stated under *The core socket* above.

## Known gaps

Named rather than implied. A threat model that overstates coverage is worse
than none, so anything below is something we do **not** have today.

### Both shells

- **Agent commands are unsandboxed at the OS level** (see above); OS-level
  sandboxing (e.g. seatbelt profiles) is future work. Commands do run in their
  own process group so a timeout reaps the whole tree rather than orphaning
  backgrounded children. On the fork this is the smaller version of a larger
  statement: the entire core is unsandboxed.
- **The audit log has no tamper-evidence.**
- **No injection screening on agent actions**, no alignment check, no
  provenance marking on page-derived text. Task 13.8c covers *adversarial tests*
  against the policy gate, which is a different thing — screening itself is not
  on the plan and nothing is implemented.
- **`browser_click` and `browser_type` pass no policy gate.** Tracked nowhere.
- **The preview and slide servers have no authentication** — a loopback `Host`
  check only, so any local process can read the served workspace while they
  run. Tracked nowhere.

### The fork specifically

- **No code signing, no notarisation, no update integrity, and no update
  channel at all.** A user cannot tell our binary from someone else's. Tracked
  as 13.7c (an unsigned update channel is a code-execution channel) and 13.8d.
  The old note here — "asar integrity, code signing lands with Phase 10" —
  described the Electron packaging path and does not cover the fork.
- **`is_component_build = true`.** A developer build split across dylibs; not a
  shippable configuration, and a wider load surface than one signed binary.
  Reported as a warning by `verify:hardening`.
- **`dcheck_always_on = true`.** DCHECKs are fatal, so conditions a release
  build tolerates crash the browser outright. This is availability rather than
  confidentiality — and it has already happened once, on `chrome://webdeck`.
- **`webdeck-core` is not a shipped executable.** It is a shell script that
  execs the user's own Node against a bundle in the repo checkout. Whoever can
  write either path gets code execution as the user, launched by the browser.
  Tracked in `chromium/README.md` remaining work.
- **The core is started lazily and never stopped.** `WebDeckCoreService::Shutdown()`
  exists and nothing calls it, so a core holding the provider key and a listening
  port outlives the page that spawned it.
- **`connect-src` on `chrome://webdeck` allows any loopback port**, not just the
  core's, because the core's port is ephemeral and a static header cannot pin it.
- **`trusted-types *`** allows any policy name (sinks still guarded — see above).
- **Only macOS arm64 has been measured.** `verify:hardening`'s renderer-sandbox
  evidence is macOS seatbelt-specific and reports `unverified` elsewhere;
  Windows and Linux hardening is unmeasured, not known-good.
- **The fork's navigation guard is untested**, and denies rather than prompting
  on a `confirm` verdict.
- **Session mode is half-wired.** The page and core halves both exist;
  `pageAgentBrowser` has no call site, so nothing selects it. When they are
  joined the agent acts as the user, the ungated `browser_click`/`browser_type`
  above stop being bounded by "no cookies", and this document needs rewriting
  rather than extending.
