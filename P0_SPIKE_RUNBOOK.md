# P0 Spike Runbook — Arcwel WebDeck on Upstream Chromium (macOS arm64)

> **What P0 answers.** Not "can we build Chromium once?" — that is table stakes. P0 answers
> **"can Arcwel survive the upstream security treadmill, and can our decoupled agent/IDE
> service (`webdeck-core`) talk to a `chrome://webdeck` page over a bridge that never
> touches Electron?"** If both are yes, the fork is viable and we proceed to P2 (fork
> foundation). If the rebase requires heavy manual patch surgery every ~4 weeks, we
> re-scope before committing.
>
> **Grounding (re-verify at spike time).** As of **2026-08-29**, upstream Chromium stable
> for macOS is **153.0.8010.12 / M153** (chromiumdash JSON APIs). M153 full-stable 2026-09-08;
> M154 stable 2026-09-22. Always re-fetch the real current + next stable before acting — see §4.1.

---

## 0. P0 status at a glance

| Deliverable | State | Where |
|---|---|---|
| **Bridge proven** — `webdeck-core` round-trips a message over a real socket | ✅ **done, green** | `app/src/core/transports/ws-server.ts` (+ 4 integration tests) |
| Transport-independence of the registry (Electron IPC + socket framing + real WebSocket) | ✅ **done** | `app/src/core/` — 40 unit/integration tests |
| Chromium macOS arm64 build (from-scratch) | ⬜ needs a real checkout (§2) | not runnable in this env |
| `chrome://webdeck` WebUI + bridge client | ⬜ needs the checkout (§3) | design ready, code is skeleton |
| One real rebase (go/no-go gate) | ⬜ needs two milestones (§4.7) | the actual spike verdict |
| Security posture: SLA, upstream-watch, dashboard | ⬜ design ready (§5–§6) | ships with P7 |

**The half we could build here is built and passing.** `serveCoreOverWebSocket` is the concrete
"launch a webdeck-core stub and round-trip one message across the bridge" deliverable. The half
that needs ~150 GB of disk and a multi-hour Chromium checkout is captured below as an
executable runbook so the build spike is a matter of following commands, not rediscovering them.

---

## 1. The bridge, already shipped

Under Electron today, `webdeck-core` handlers run over `ipcMain`. Under the Chromium fork there is
no Electron IPC — the `chrome://webdeck` WebUI reaches the same Node service over a **loopback
WebSocket**. The invariant that makes the swap safe: **the handlers never change, only the transport.**

That invariant is now proven against three transports sharing one `CoreRegistry`:

- **Electron IPC** — `app/src/core/transports/electron.ts`
- **Socket framing** (pure function, no socket lib) — `app/src/core/transports/socket.ts`
- **Real WebSocket server** — `app/src/core/transports/ws-server.ts` ← the P0 bridge

```ts
// app/src/core/transports/ws-server.ts (shipped, green)
export function serveCoreOverWebSocket(
  registry: CoreRegistry,
  options: WsServerOptions = {}
): Promise<WsServerHandle> {
  // Binds 127.0.0.1 (loopback only, never public). Ephemeral port by default.
  // Each frame → handleRpcMessage(registry, …) → reply per frame; notify frames get no reply.
  // Returns { port, clients, close() } and can write the chosen port to a discovery file.
}
```

Frame shapes (identical across socket + WebSocket): request `{ id, method, args }` →
`{ id, result }` or `{ id, error }`; fire-and-forget `{ notify: true, method, args }` → no reply.
The WebUI client wrapper in §3 speaks exactly these.

**Run the bridge tests:**

```bash
cd app && npx vitest run src/core/transports/ws-server.test.ts
```

---

## 2. Build Chromium (macOS arm64, from scratch)

### 2.1 Sizing & prerequisites

| Resource | Minimum | Recommended for the spike |
|---|---|---|
| Disk (checkout + one build dir) | ~100 GB | **150+ GB free**, APFS. `out/` alone is 30–60 GB; source + `.git` ~40–50 GB. |
| RAM | 16 GB | **32–64 GB** (link steps swap at 16). |
| CPU | any M-series | M2/M3/M4 Pro/Max — core count drives build time. |
| macOS | current stable | Chromium tracks the latest macOS SDK. |

**Realistic first-build wall-clock (single M-series Mac, local build, no RBE):**
source `fetch` + sync **30–90 min**; first full `chrome` compile **1.5–4 h**; incremental
rebuilds **seconds–minutes**.

```bash
# Xcode + CLT (Xcode ships the macOS SDK):
sudo xcode-select --switch /Applications/Xcode.app/Contents/Developer
sudo xcodebuild -license accept
xcode-select --install                       # no-op if present
xcode-select -p                              # must point at Xcode.app, not CommandLineTools
```

> **Team-scale caveat (decide early, not later).** One Mac rebuilding on every rebase does not
> scale. Chromium supports remote execution/caching (`use_remoteexec=true`, reclient/RBE) — but
> **Google's RBE backend is not available to third-party forks.** For the P0 spike, build locally
> (`use_remoteexec=false`); before the team grows past ~2 people, budget a task to stand up a
> self-hosted RBE/cache.

### 2.2 depot_tools

```bash
mkdir -p "$HOME/dev" && cd "$HOME/dev"
git clone https://chromium.googlesource.com/chromium/tools/depot_tools.git
echo 'export PATH="$HOME/dev/depot_tools:$PATH"' >> ~/.zshrc
export PATH="$HOME/dev/depot_tools:$PATH"
git config --global core.autocrlf false
git config --global core.filemode false
which fetch gclient gn autoninja            # all must resolve into depot_tools
```

### 2.3 Fetch + pin to a stable tag (a spike builds a *known* release, never `main`)

```bash
mkdir -p "$HOME/dev/chromium" && cd "$HOME/dev/chromium"
caffeinate fetch --nohooks chromium          # --nohooks so we can pin BEFORE the multi-GB hooks
cd src

# Read the real current stable for Mac from chromiumdash, then:
gclient sync --with_branch_heads --with_tags # required, or `git checkout tags/…` won't resolve
git fetch --tags
export TAG=153.0.8010.12                      # ← replace with real current stable at spike time
git checkout -b webdeck-base-$TAG tags/$TAG
caffeinate gclient sync --with_branch_heads --with_tags -D
gclient runhooks
```

### 2.4 Configure (`out/webdeck/args.gn`)

```bash
gn gen out/webdeck
cat > out/webdeck/args.gn <<'EOF'
target_cpu = "arm64"          # Apple Silicon native
is_debug = false              # release codegen; debug builds are enormous/slow to link
is_component_build = true     # many dylibs → fast INCREMENTAL relinks (DEV ONLY, never ship)
symbol_level = 1              # usable stack traces without full debug-info cost (0 = trim further)
is_chrome_branded = false     # Chromium branding, NOT Google Chrome — a fork must be unbranded
use_remoteexec = false        # local build; true ONLY with your own reclient/RBE backend
blink_symbol_level = 0        # optional: trims build time further
EOF
gn gen out/webdeck
```

> **Proprietary codecs are a legal decision, not a build convenience.** `proprietary_codecs=true`
> + `ffmpeg_branding="Chrome"` enable H.264/AAC/MP3 but are patent-encumbered (AVC/AAC pools).
> Leave **off** for the spike; escalate to whoever owns licensing before enabling in a distributed build.

### 2.5 Build & run

```bash
caffeinate autoninja -C out/webdeck chrome
out/webdeck/Chromium.app/Contents/MacOS/Chromium \
  --use-mock-keychain --disable-features=DialMediaRouteProvider   # suppress dev keychain/net popups
```

### 2.6 Minimal branding (lightest touch — product name only)

Deep branding (icons, locales, installer, Sparkle, bundle IDs) is a later milestone. For the spike,
with `is_chrome_branded=false` the unbranded `BRANDING` file is the lever:

```bash
$EDITOR chrome/app/theme/chromium/BRANDING
#   PRODUCT_FULLNAME=Arcwel WebDeck
#   PRODUCT_SHORTNAME=WebDeck
#   COMPANY_FULLNAME=Arcwel
# Optionally edit specific IDS_ strings in chrome/app/chromium_strings.grd (do NOT bulk-sed it).
caffeinate autoninja -C out/webdeck chrome
```

Keep it a tiny, dedicated commit (`feat: brand as Arcwel WebDeck (spike)`) so it carries cleanly
across the rebase in §4. The bundle stays `Chromium.app` on disk — renaming is deferred.

### 2.7 First-build troubleshooting

| Symptom | Fix |
|---|---|
| `fetch`/`gn`/`autoninja` not found | depot_tools not first on PATH — `export PATH="$HOME/dev/depot_tools:$PATH"` |
| `git checkout tags/<v>` → "pathspec did not match" | `gclient sync --with_branch_heads --with_tags && git fetch --tags` |
| Xcode/SDK/license errors | `sudo xcode-select --switch …/Xcode.app/Contents/Developer && sudo xcodebuild -license accept` |
| `No space left on device` mid-build | free to 150 GB+, or set `symbol_level=0` / `blink_symbol_level=0`, re-`gn gen` |
| Build fails only with `use_remoteexec=true` | no RBE backend — set `false`, re-`gn gen` |
| Repeated keychain/network popups | launch with `--use-mock-keychain --disable-features=DialMediaRouteProvider` |

---

## 3. `chrome://webdeck` WebUI + the bridge client

> API names (`content::DefaultWebUIConfig`, `WebUIDataSource::CreateAndAdd`, `AddResourcePath`,
> `SetDefaultResource`, `chrome_web_ui_configs.cc` + `map.AddWebUIConfig()`, `build_webui()`,
> `OverrideContentSecurityPolicy`) are from Chromium's WebUI explainer. **All C++/TS below is
> illustrative skeleton** — reconcile file names and `IDR_*` symbols against the fork's actual tree.

### 3.1 The four parts of a `chrome://` page

| Part | Role | Location |
|---|---|---|
| `WebUIController` subclass | app logic; sets up data source | `chrome/browser/ui/webui/webdeck/webdeck_ui.{h,cc}` |
| `WebUIConfig` (`DefaultWebUIConfig<T>`) | binds scheme+host → controller | same dir |
| `WebUIDataSource` | serves the page bytes; owns the CSP | created in the controller ctor |
| Host registration | `map.AddWebUIConfig(std::make_unique<WebDeckUIConfig>())` | `chrome/browser/ui/webui/chrome_web_ui_configs.cc` |
| Resources + build wiring | the page + generated `IDR_*` | `chrome/browser/resources/webdeck/` + `build_webui()` |

Hello-world order: add host constant (`kChromeUIWebDeckHost = "webdeck"`) → controller+config with a
one-line HTML default resource → `webdeck.html` + `build_webui()` target wired into browser
resources → the one `AddWebUIConfig` line → `autoninja … chrome` → navigate to `chrome://webdeck`.

### 3.2 CSP + port discovery (the trust boundary)

The WebUI page is a normal web page, so it can open a `WebSocket` — but two things gate it:

- **CSP `connect-src`.** WebUI data sources ship a locked-down CSP; a `ws://` connection is blocked
  unless widened. Scope it as tightly as possible — loopback only, not a wildcard host:
  ```cpp
  source->OverrideContentSecurityPolicy(
      network::mojom::CSPDirectiveName::ConnectSrc,
      "connect-src 'self' ws://127.0.0.1:* ws://localhost:*;");
  ```
  This is a real trust decision: any local process on that port can now talk to the page. Treat every
  inbound frame as untrusted and validate it (the client below drops malformed frames).
- **Port discovery.** Don't hardcode the port. `serveCoreOverWebSocket` already writes its chosen
  port to a discovery file (`WsServerOptions.portFile`, JSON `{ "port": N }`); the page reads it
  before connecting. A fixed dev port with an env override is acceptable for the spike, but the
  discovery seam exists from day one.

### 3.3 Bridge client (TypeScript, matches the shipped frame shapes)

```ts
// chrome/browser/resources/webdeck/bridge.ts — speaks the same frames as ws-server.ts
export class WebDeckBridge {
  private ws: WebSocket; private ready: Promise<void>;
  private nextId = 1; private pending = new Map<number, {resolve:(v:unknown)=>void; reject:(e:unknown)=>void}>();
  constructor(port: number, host = '127.0.0.1') {
    this.ws = new WebSocket(`ws://${host}:${port}`);
    this.ready = new Promise((res, rej) => {
      this.ws.addEventListener('open', () => res(), { once: true });
      this.ws.addEventListener('error', (e) => rej(e), { once: true });
    });
    this.ws.addEventListener('message', (ev) => this.onMessage(ev));
    this.ws.addEventListener('close', () => this.failAll(new Error('bridge closed')));
  }
  async call<T=unknown>(method: string, ...args: unknown[]): Promise<T> {           // request/response
    await this.ready; const id = this.nextId++;
    return new Promise<T>((resolve, reject) => {
      this.pending.set(id, { resolve: resolve as (v:unknown)=>void, reject });
      this.ws.send(JSON.stringify({ id, method, args }));
    });
  }
  async notify(method: string, ...args: unknown[]): Promise<void> {                  // fire-and-forget
    await this.ready; this.ws.send(JSON.stringify({ notify: true, method, args }));
  }
  private onMessage(ev: MessageEvent): void {
    let f: { id?: number; result?: unknown; error?: unknown };
    try { f = JSON.parse(typeof ev.data === 'string' ? ev.data : ''); } catch { return; }
    if (typeof f.id !== 'number') return;
    const p = this.pending.get(f.id); if (!p) return; this.pending.delete(f.id);
    if ('error' in f && f.error !== undefined) p.reject(f.error); else p.resolve(f.result);
  }
  private failAll(reason: unknown): void { for (const p of this.pending.values()) p.reject(reason); this.pending.clear(); }
}
```

Correctness points: monotonic `id` keys the `pending` map; inbound frames match by `id`; `notify`
never registers a resolver; a socket close rejects everything in flight so no promise hangs.

### 3.4 Why WebSocket now, Mojo later

WebSocket wins the spike: `webdeck-core` already speaks JSON over a socket, the WebUI page connects
with **zero new C++ plumbing**, and the whole bridge is exercisable the day `chrome://webdeck`
renders. The cost is a loopback hop with a hand-rolled framing/CSP trust boundary. **Mojo** is the
production destination — typed `.mojom` interfaces, brokered in-process IPC, no localhost socket to
secure or discover — once the interface has stabilized.

---

## 4. The rebase — carry the fork so the treadmill is cheap

### 4.1 Fork layout (minimize what can rot)

**Patch rot:** Chromium moves ~2,000 commits/week. Every upstream line you edit in place is a line
upstream may rename/move/delete under you, so each rebase your diff stops applying and someone
re-derives intent from a merge conflict. Left unmanaged the cost compounds until the team silently
starts skipping rebases — which is skipping security updates.

Rules, in priority order:
1. **Pin upstream explicitly** via `DEPS`/`.gclient` — bumping the pin *is* the rebase.
2. **Prefer an additive `//webdeck/` overlay** (new files, new GN targets) to in-tree edits.
   Additive files never conflict; only injection points can.
3. **Keep a MINIMAL, ordered patch series** under `//webdeck/patches/NNNN-desc.patch`. One patch =
   one reviewable reason. Twenty 3-line patches rebase cheaper than three 200-line ones.
4. **Climb the customization ladder — change the highest layer that works:** enterprise policy
   (zero patch surface) → feature flags/field trials → WebUI/resources → component/embedder hooks →
   core `//content`/`//base`/Blink C++ (last resort, budgeted in review).
5. **Every in-tree patch carries an owner + a "why" + a delete condition** (e.g. "remove when
   upstream ships crbug.com/NNNNNN"). Cap patch count as a tracked liability (e.g. ≤40; #41 needs sign-off).

### 4.2–4.7 The rebase loop

```bash
# 4.1  Identify next stable (JSON APIs — the HTML dashboards render client-side and return empty):
curl -s 'https://chromiumdash.appspot.com/fetch_releases?channel=Stable&platform=Mac&num=1'
curl -s 'https://chromiumdash.appspot.com/fetch_milestone_schedule?mstone=154'
#   3rd version component = branch number: 153.0.**8010**.12 → refs/branch-heads/8010.
#   Rebase onto the stable TAG (reproducible), not branch tip.

export NEWTAG=154.0.XXXX.YY                    # ← real next stable at spike time
git checkout -b rebase/M154
# ... bump the DEPS/.gclient pin to NEWTAG ...
git commit -am "chore: pin upstream to $NEWTAG"

# 4.3  Sync:
gclient sync --with_branch_heads --with_tags --revision src@$NEWTAG -D -R
gclient runhooks

# 4.4  Replay the patch series (format-patch series shown; long-lived branch is `git rebase --onto`):
for p in //webdeck/patches/*.patch; do git -C src am --3way "$p" || break; done

# 4.5  Resolve — FIRST ask if the patch is still needed (did upstream absorb it? delete-if-obsolete):
git -C src add -A && git -C src am --continue
git -C src format-patch -1 --stdout > //webdeck/patches/NNNN-desc.patch   # refresh the stored patch

# 4.6  Rebuild + 4.7 smoke-gate (must be automated/non-interactive):
gn gen out/Release --args="$(cat //webdeck/args/release-mac.gn)"
autoninja -C out/Release chrome
./out/Release/Chromium --version
autoninja -C out/Release unit_tests browser_tests && ./out/Release/unit_tests --gtest_filter='WebDeck*'
# + manual smoke: launch, sign-in, sync, extensions, policy load, updater ping.
```

**Go/no-go (the actual spike verdict):** record whether the rebase built at all, which files
conflicted, the rebuild wall-clock, and whether branding survived. **GO** if it's mechanical (minor
conflicts, tolerable rebuild). **NO-GO / re-scope** if one milestone bump needs heavy manual patch
surgery — that cost recurs every ~4 weeks and must be staffed (or an RBE cache stood up) first.

> **CLI opportunity (highest ROI):** `webdeck rebase --to <ver> [--dry-run] [--json]` — one command
> that pins, syncs, replays the series, builds, runs the smoke gate, and emits a machine-readable
> pass/fail + conflict report. §5's automation assumes it exists.

---

## 5. Cadence, SLA & upstream-watch

**Upstream cadence:** new milestone **~every 4 weeks**; security/stable refreshes **every 1–2 weeks**
(these carry the actual CVE fixes); **out-of-band emergency** releases for in-the-wild 0-days.

**Why the clock is a security control:** the instant upstream ships a fix, the fixing commit is
public — for an attacker that diff *is* the vulnerability writeup. A fork's real exposure window is
the gap between upstream's public fix and WebDeck's shipped fix. The two numbers that decide whether
shipping is responsible are **days-since-last-security-update** and **unpatched-CVE age**.

**Proposed internal SLA (upstream stable → WebDeck shipped to stable):**

| Class | Trigger | Ship within |
|---|---|---|
| **P0 — 0-day** | "exploited in the wild" / out-of-band | **72 h** (minimal cherry-pick lane, ahead of a full rebase) |
| **P1 — Critical** | Critical CVE in a stable refresh | **7 days** |
| **P2 — High** | High CVE | **14 days** |
| **P3 — Medium/Low** | remaining CVEs | next scheduled milestone rebase |

Ship/no-ship rule: **if days-since-last-security-update exceeds the SLA for any open CVE class in the
fleet, the current build is not shippable and the rebase is P0-escalated.**

**upstream-watch → ship pipeline** (no human is the sensor):

```
[upstream-watch] cron ~30 min
  • chromiumdash fetch_releases  → compare latest stable vs WebDeck pin (per OS)
  • chrome-releases RSS          → parse CVE list + severities; flag "exploited in the wild"
  • CVE/NVD + CISA KEV           → CVSS + known-exploited status
  • on delta → classify P0–P3, open a REBASE TASK with the SLA clock started at UPSTREAM publish time
        ↓
[rebase]  webdeck rebase --to <ver> --json   (conflicts → assignee)
        ↓
[build]   autoninja per-OS matrix (mac/win/linux) + provenance/attestation
        ↓
[sign]    macOS codesign + notarytool · Windows Authenticode/EV · Linux repo signing  (keys in HSM only)
        ↓
[ship]    updater: canary → N% staged → 100% stable; auto-halt on crash/error regression
```

Feeds: `https://chromereleases.googleblog.com/feeds/posts/default` (filter "Stable Channel Update for
Desktop"), `fetch_releases?channel=Stable&platform={Mac,Windows,Linux}`, `fetch_milestone_schedule?mstone=N`,
NVD/CVE JSON + CISA KEV.

---

## 6. The security dashboard — "are we responsible to be shipping right now?"

| Metric | Why it earns its place |
|---|---|
| **Version gap** (WebDeck stable vs upstream latest, per OS) | The gap *is* the exposure; non-zero after a security release = known-public bugs live in the fleet. |
| **Unpatched-CVE count & max age** | The core responsibility number; any Critical/High past its SLA is a red, ship-blocking state. |
| **Days since last security update** | Rising with no open task = the treadmill stalled and nobody noticed. |
| **Per-OS build/ship status** (mac/win/linux) | Exposure is per-platform; "shipped on Mac" is meaningless if Windows is stuck. |
| **Crash-free sessions %** | The auto-halt signal that lets us ship fast without shipping broken. |
| **Extension-risk inventory** | Extensions are the largest post-engine attack surface; a patched engine doesn't help against a malicious extension with broad host perms. |
| **Sync-server health** (uptime, error rate, cert expiry) | WebDeck runs its own sync infra; an outage or expiring cert is a user-data/availability incident distinct from the engine. |

**Dashboard-as-gate:** the version-gap, unpatched-CVE-age, and days-since-security tiles are wired to
the SLA. When any crosses threshold the tile goes red and the pipeline auto-escalates the open rebase
task to P0. The dashboard is the interlock that decides whether shipping the current build is defensible.

---

## 7. P0 exit criteria

P0 is **complete** when all of the following hold:

- [x] `webdeck-core` round-trips a message across a real socket bridge (`ws-server.ts`, green).
- [x] Registry proven transport-independent (Electron IPC + socket + WebSocket, one `CoreRegistry`).
- [ ] A Chromium **153-line** (current stable) build produces a launchable `Chromium.app` on macOS arm64 (§2).
- [ ] `chrome://webdeck` renders and its `WebDeckBridge` completes one `call()` round-trip to a
      `serveCoreOverWebSocket` instance (§3) — the bridge working *inside the fork*, not just in tests.
- [ ] **One real rebase** to the next stable is executed and measured; the go/no-go verdict (§4.7) is recorded.
- [ ] SLA, upstream-watch shape, and dashboard metrics are ratified by whoever owns release (§5–§6).

The first two are done. The rest need a machine with a Chromium checkout; this runbook makes them
mechanical. On a GO verdict, proceed to **P2 (fork foundation)**; the remaining P1 shell shims
(`export*`, `agentOpenReport`, `slidesOpen`) and §D/§E/§F of `CHROMIUM_MIGRATION.md` follow.

---

## CLI opportunities (per cli-first)

| Command | What it does | Effort |
|---|---|---|
| `webdeck rebase --to <ver> [--dry-run] [--json]` | pin → sync → replay patches → build → smoke-gate → machine-readable pass/fail + conflict report | ~1–2 days (**highest ROI**) |
| `webdeck upstream-watch --json` | poll chromiumdash + chrome-releases, diff vs shipped pin, classify P0–P3, open rebase task with SLA clock | ~½ day |
| `webdeck ship --stage canary\|N%\|stable --os all` | staged updater rollout + crash/error auto-halt | ~1 day |
| `webdeck serve-core [--port N] [--port-file P]` | thin CLI over `serveCoreOverWebSocket` — start the bridge standalone for manual `chrome://webdeck` testing | ~1 hr |

Chain the first three under cron; humans touch only conflict resolution and the staged-rollout go/no-go.
