# Chromium migration — the living plan

WebDeck is moving from an Electron **app that embeds a browser** to a **browser
forked from upstream Chromium** with the agent/IDE attached as a service. The
strategy and the phased roadmap live in two review docs (the "Electron or
Chromium?" decision memo and the "WebDeck on Chromium" plan); this file is the
in-repo companion that tracks the boundary and the work as it lands.

## Target shape (three pillars)

1. **Forked Chromium shell** — upstream Chromium + a thin patch/overlay layer,
   WebDeck branding, native tabs/profiles/incognito/DevTools/Web-Store, the
   sandbox kept intact. Owns everything "browser".
2. **`webdeck-core`** — the agent/IDE logic (editor services, LSP, DAP,
   terminal, files, SCM, tasks, search, agent, policy engine) as a
   transport-agnostic service. Owns everything "IDE/agent".
3. **Identity, sync & security** — self-hosted E2E sync, security posture, the
   update pipeline + monitoring.

Pillars 1 and 2 meet at one bridge. Today the bridge is Electron IPC; under the
fork it becomes a local socket. **The handlers never change — only the transport.**

## Phase 1: decouple `webdeck-core` (in progress, on Electron)

The move that de-risks everything else, done while still shipping Electron.

### The mechanism — `src/core/`

- **`src/core/rpc.ts`** — a `CoreRegistry`: domains `register(method, handler)`;
  a transport `bind`s them all; `dispatch(method, args)` invokes one. Imports
  nothing from Electron, so it runs anywhere Node does (unit-tested in
  `rpc.test.ts`).
- **`src/core/transports/electron.ts`** — the one file that touches Electron;
  binds registered methods onto `ipcMain.handle`. Under Chromium it is swapped
  for a socket transport and nothing else moves.

### Migrating a domain — the recipe

1. In the domain module, add `registerXxxRpc()` that calls
   `core.register(IpcChannels.xxx, handler)` for each of its methods.
2. Delete that domain's `ipcMain.handle(...)` calls from `src/main/index.ts`.
3. Call `registerXxxRpc()` in `registerIpcHandlers()`. `core.bind(electronTransport)`
   (already at the end of that function) exposes it.

**Migrated (all CORE domains):** `secrets` (pilot), `app-settings` (read/write),
`git`, `tasks`, `search`, `lsp`, `debug`, `settings`, `terminal`, `fs`,
`dev-servers`, `agent` (incl. `agentOpenReport`), `policy`, `workspace` (reads),
`slides`. The registry now also has a **notify path** (`registerNotify`/`notify`)
for fire-and-forget streams; `lspSend` and `debugSend` run on it. Only the
boot-time synchronous `appSettingsReadSync` stays on `ipcMain.on` (it needs
`event.returnValue`). A third transport — a real loopback **WebSocket server**
(`src/core/transports/ws-server.ts`) — proves the registry against the transport
the Chromium fork will actually use.

### Order of migration (safest → hardest)

Pure "core" domains with no browser/window/dialog dependency move first:

`secrets` ✅ → `app-settings` (store) ✅ → `git` ✅ → `tasks` ✅ → `search` ✅ →
`lsp` ✅ → `debug` → `terminal` → `fs`/`workspace` (state) → `agent` + `policy`
last (the biggest surface). Hybrids that need a native dialog or page (folder picker,
`settings.import`, `agent.openReport`, `export*`) keep a small **shell shim**
that the core calls into.

## The SHELL vs CORE boundary

Every IPC channel is classified. **CORE** moves behind the registry and becomes
transport-swappable. **SHELL** stays native in the Chromium shell — most of it
stops being IPC at all, because it becomes a built-in browser feature.

### CORE — moves to `webdeck-core`

| Domain | Channels |
| :-- | :-- |
| Secrets ✅ | `secretsList` `secretsSet` `secretsClear` |
| App settings (store) ✅ | `appSettingsRead` `appSettingsWrite` |
| Filesystem | `fsList` `fsRead` `fsWrite` `fsCreate` `fsRename` `fsDelete` |
| Workspace (state) | `workspaceCurrent` `workspaceRecent` `workspaceRoots` `workspaceRemoveRoot` `workspaceOpenPath` |
| Editor config | `settingsRead` `settingsWrite` |
| Terminal | `termCreate` `termInput` `termResize` `termDispose` `termStop` `termAttach` |
| Language servers ✅ | `lspStart` `lspStop` (`lspSend` streams — later) |
| Debugger | `debugStart` `debugSend` `debugStop` `debugAttachChild` `debugAvailable` |
| Source control ✅ | `gitStatus` `gitDiff` `gitStage` `gitUnstage` `gitCommit` `gitBranches` `gitCheckout` `gitBlame` |
| Tasks ✅ | `taskList` `taskRun` `taskStop` `taskRuns` |
| Search ✅ | `searchQuery` |
| Dev servers | `devServerStart` `devServerStop` `devServerStatus` |
| Agent | `agentStart` `agentApprove` `agentReject` `agentStop` `agentList` `agentKeyStatus` `agentSetKey` `agentSetModel` `agentClearFinished` `agentRename` `agentDelete` `agentExport` `agentUpdatePlan` `agentResume` |
| Policy engine | `policyGet` `policySetMode` `policySetCustom` `policyRespond` |

### SHELL — stays in the Chromium shell (mostly becomes native)

| Concern | Channels |
| :-- | :-- |
| Browser tabs | `browserCreate` `browserDestroy` `browserNavigate` `browserBack` `browserForward` `browserReload` `browserStop` `browserSetBounds` `browserSetVisible` `browserSetCornerRadius` `browserDevTools` `browserFind` `browserFindStop` `browserZoom` `browserPrint` |
| Windows | `windowNew` `deckOpen` `deckClose` `deckFocus` `floatSync` `shellBroadcast` |
| Profiles / sessions | `profilesList` `profilesSetActive` `profilesCreate` `profilesRemove` `profilesGoogleStatus` |
| Extensions | `extLoad` `extLoadPacked` `extLoadPath` `extList` `extRemove` |
| Downloads | `downloadsList` `downloadsShow` `downloadsClear` |
| Permissions | `permissionRespond` |
| Embed proxy | `proxyStatus` `proxySetEnabled` |
| Theme | `themeSet` |
| Native dialogs | `dialogConfirm` `dialogPickPaths` |
| Workspace mutations | `workspaceOpen` `workspaceOpenPath` `workspaceAddRoot` `workspaceRemoveRoot` (native picker + broadcast + dev-server/watcher) |
| App metadata | `appInfo` `themeSet` |
| Boot util | `appSettingsReadSync` |

### HYBRID — core logic behind a thin shell shim

Resolved: `agentOpenReport` and `slidesOpen` turned out to be **pure core** —
each returns a path/URL and the renderer opens the tab with that return value, so
they migrated behind the registry with no shell dependency. What remains genuinely
shell-bound (a native dialog or a live page the shell owns) stays shell-side:

`workspaceOpen` / `workspaceAddRoot` (folder picker) · `settingsImport` /
`bookmarksImportFile` (file picker) · `appSettingsClearData` /
`appSettingsChooseDownloadDir` (session + dir picker) · `exportHtml` /
`exportPdf` / `exportCapture` (need a live `BrowserWindow`/`webContents`). These
have no trapped core logic — the settings write they call (`appSettingsWrite`) is
already core. Under Chromium they become native browser features (save dialog,
print-to-PDF, page capture), not IPC at all.

## Status

- [x] P1 · `src/core` registry + Electron transport, unit-tested
- [x] P1 · `secrets` domain migrated behind the registry (pilot)
- [x] P1 · `src/core/coerce.ts` — portable argument guards
- [x] P1 · **all CORE domains migrated** — `app-settings`, `git`, `tasks`,
  `search`, `lsp`, `debug`, `settings`, `terminal`, `fs`, `dev-servers`, `agent`
  (+`agentOpenReport`), `policy`, `workspace` (reads), `slides`
- [x] P1 · notify transport path for streams — `registerNotify`/`notify`;
  `lspSend`, `debugSend` migrated onto it
- [x] P1 · second + third transports proven — socket framing (`transports/socket.ts`)
  and a real loopback WebSocket server (`transports/ws-server.ts`), same registry
- [x] P1 · remaining hybrids triaged — `agentOpenReport`/`slidesOpen` were pure
  core (migrated); `export*` + native dialogs are genuinely shell (become native
  browser features under the fork)
- [~] P1 · make CORE domains Electron-free — **CoreEnv seam landed**
  (`src/core/env.ts` + `src/main/core-env.ts`). secrets, app-settings (store),
  agent, terminal, debug, policy, agent-report and json-store now read host facts
  (`userDataDir`, `homeDir`, `appDir`, `secrets`) through an injected env, not
  `electron`. This unblocked direct unit tests of the policy gate and agent
  lifecycle (`policy.test.ts`, `agent.test.ts`). Remaining before a standalone
  `webdeck-core`: the reverse core→shell notify (`BrowserWindow` broadcast in
  policy/dev-servers) and a Node adapter (keystore + config paths) to replace the
  Electron one. *(finishes at P2 — the fork provides the Node host.)*
- [~] P0 · Chromium build spike — see [P0_SPIKE_RUNBOOK.md](P0_SPIKE_RUNBOOK.md).
  Bridge deliverable done (`ws-server.ts`, green); a real macOS arm64 Chromium
  build is running on a case-sensitive APFS volume (target M153 / 153.0.8010.12).
