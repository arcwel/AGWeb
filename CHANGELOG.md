# Changelog

All notable changes to Arcwel WebDeck are recorded here. This project adheres to
[Semantic Versioning](https://semver.org/).

## Unreleased

### Fixed (RC1 review)

- App icon: the bundle's asset catalog (Assets.car) is now WebDeck's, so Finder
  and the Dock show the WebDeck icon instead of Chromium's.
- Tabs sit inline with the window's traffic lights (the title bar is exactly the
  tab row's height); deck and float windows reserve the same inset.
- Popovers (favourites, extensions, profile) float above the page with a gap;
  the staged tab hides while any shell overlay is open.
- The agent's paperclip opens the native open panel and the attachment appears
  as a chip; the core creates the attachments folder on first use.
- Profile and settings entries open Sign in, Profiles, Browser settings and
  Extensions as real tabs.
- The Deck detaches into its own window and docks back; stacks float into real
  windows.
- The address bar and tab titles follow navigation again. The shell opened two
  Mojo pipes to the browser at startup (the client registration and the first
  tab creation raced); the browser keeps one Shell per page, so the client's
  pipe closed silently and no navigation state ever reached the tab strip. The
  remote is now resolved once, and a failed client registration is logged.
- The window's seed tab (the blank tab Chromium opens every window with) is no
  longer adopted as a phantom "about:blank" tab; the shell's first tab claims
  it instead of opening a second real tab.
- Closing the window's last real tab (a project switch restores a layout and
  destroys every content tab) empties the tab instead of letting Chromium
  close the window.

### Changed

- **Tabs belong to the browser, not the project.** The tab strip used to be
  saved and restored per workspace, so opening a project swapped in that
  project's old tabs and tore down the pages you were reading. One tab session
  per profile now, restored once at launch; a project switch only restores
  the Deck layout.
- **Cast / media routing is off by default.** Its mDNS discovery started at
  launch and raised macOS's "find devices on local networks" prompt before
  the user had done anything. The macOS permission text now names Arcwel
  WebDeck.

### Fixed (settings QA round)

- **The Application tab's "Clear now" did nothing.** Its channel has no handler
  on the fork, so the button raised "no handler for app-settings:clear-data"
  and cleared nothing — and the call had no error path, so the failure was
  invisible. Chromium's own remover on the Browser tab is the real one; the
  Application tab now points at it and at the Chromium pages that own site
  permissions, languages, hardware acceleration and Do Not Track.
- **Four toggles that changed nothing are gone.** Hardware acceleration, ask
  before granting page permissions, spell-check and Do Not Track wrote
  WebDeck's own settings file, which nothing on this build reads; Do Not Track
  also contradicted the working switch on the Browser tab. Chromium owns all
  four, so the panel names where each lives instead.
- **Failures no longer pass silently.** Saving an application setting, choosing
  the agent model and every sync action caught nothing: a rejected call left a
  control snapped back or a button quietly re-enabled with no message. Each
  reports now, and the model dropdown reverts rather than showing a model that
  was never saved.
- Settings is a real dialog: `role="dialog"`, an accessible name, and focus
  moves into the sheet when it opens. The colour channel inputs are named
  apart, the reset button is visible when focused rather than only on hover,
  and the decorative field swatch is out of the tab order.
- The About panel no longer lists an Electron version this build does not have,
  and the clear-data checkbox labelled "Auth cache" says what it clears.

### Fixed (profile picture and Google sign-in)

- **The profile button shows a picture again.** It only ever drew the Google
  account image, and this build can never have one, so it drew nothing. It now
  falls back to the local profile avatar — the picture
  chrome://settings/manageProfile sets — and still prefers the Google image
  where there is one.
- **The menu says why the browser is not signed in.** Signing in to a Google
  website does not sign in the browser: that needs Google's own API keys and
  OAuth client, which are issued to official Chrome builds only. Without them
  the identity manager holds no account, which is why the avatar was blank and
  Sync never started — the profile on this machine had zero browser accounts
  recorded despite being signed in on google.com. The browser now reports
  whether sign-in is possible at all, and the profile menu and the Sync row in
  settings say so instead of offering a flow that cannot complete.

### Fixed (block drop targets)

- **The drop zones open while a block is in the air.** An empty zone rests as
  a 10px strip, which is a fine resting state and a poor target: the cursor is
  carrying a block, the pointer is not where the eye is, and a miss drops the
  block back where it started. During a drag the left column and the bottom
  dock each open to a 96px band and all three zones show a dashed edge, so
  every target is both aimable and visible. The bands are overlays — the
  stage's insets come from inline custom properties that are left alone, so
  nothing reflows and the page does not jump under the drag. They close on
  `dragend`, which fires whether the block was dropped or abandoned.

### Changed (assistant panel and one settings sheet)

- **Ask opens a side panel, not the Dev Deck.** The assistant is its own
  layout: a panel beside the page, full height, with the Deck's zones and the
  stage inset by its width so nothing is drawn over anything. Toggling the
  Deck neither opens nor closes it. Asking about a page should not drag the
  editor, terminal and file tree on screen with it.
- **The Ask button is pinned to the top right** of the window rather than
  sitting at the end of the tab strip, where enough open tabs scrolled it out
  of reach.
- **Ask can be turned off** in Settings → WebDeck → Application.
- **One settings sheet with a Browser / WebDeck switch.** Settings used to be
  two surfaces reached from two menus: closing ours left a chrome:// settings
  tab behind it, and nothing said which was which. There is now one sheet —
  Browser is Chromium's settings, WebDeck is the application's — and the
  profile menu's duplicate entry is gone. The app menu's Settings item and its
  Command-comma accelerator are forwarded to the same sheet, so every route
  lands in one place.
- The agent has one live surface at a time: a Deck agents block says where the
  conversation went while the panel holds it, rather than rendering a second
  composer over the same session. A draft now names the composer it is for,
  which is what stopped the Deck's composer claiming the page attachment and
  then unmounting with it.

### Added (Chrome settings parity)

- **The Browser tab is chrome://settings, in WebDeck's window.** The sections,
  their order and their wording are Chrome's — You and Google, Autofill and
  passwords, Privacy and security, Performance, Appearance, Search engine, On
  startup, Downloads, Languages, Accessibility, System, Reset — and each row is
  provided the way Chrome provides it. A preference Chrome shows as a switch or
  a dropdown is a switch or a dropdown here, writing the same pref
  chrome://settings writes; a setting Chrome hands to a subpage (passwords,
  payment methods, addresses, site permissions, search engines, languages,
  reset) is a row that opens Chromium's real page. There is a search box over
  the whole surface, as Chrome has. Safe Browsing is its three-way choice over
  the two booleans behind it.
- **An allowlisted preference bridge.** chrome://settings is a page of controls
  over the profile's PrefService, so the shell needed the same values — but a
  renderer that could name any pref would be a hole the size of the browser.
  The browser keeps a list: 27 preferences, each with its type, whether it
  lives in the profile or in Local State, and whether it may be written at all.
  A name that is not on it reads back exactly like one this build does not
  register, so refusing leaks nothing. Wrong types are refused, policy-managed
  prefs are refused and drawn disabled, and two prefs that the surface only
  displays (the download folder, the language list) are read-only here and
  changed on Chromium's own page — otherwise an arbitrary download directory
  plus "don't ask where to save" would be a writable-path primitive.
- A row whose pref this build does not register is hidden rather than drawn
  dead, which is how the wrong caret-browsing pref name was caught.

### Added (settings QA round)

- **Ask.** A button at the end of the tab strip, where Chrome keeps "Ask
  Gemini", that points the agent at the page you are looking at. Chrome's
  version is its Gemini side panel, which is compiled out of an unbranded
  Chromium and loads a Google-hosted client, so this browser cannot carry it.
  Ours takes a snapshot of the active tab's visible text, brings the Agents
  block forward with the page attached ("Sharing …"), and offers starters —
  summarise, what can I do here, explain the terms, fill in the form. The agent
  reads the page first and then is the ordinary agent: every tool, the same
  permissions and guards, the same transcript. The page text is handed to the
  model as data to answer from, with the same injection framing as chat-with-
  page, and capped in the core.

- **Ask Gemini.** The omnibox answer panel can hand the same question to
  Gemini and back, streaming from Google's API in the core. The button appears
  only when a Gemini key is configured, so it can never be a button that only
  says "no key"; the panel names which model answered. The key never leaves the
  core — the page sees tokens.

### Fixed (feedback round)

- **Pinned extensions now appear in the toolbar.** Chromium draws extension
  buttons in its own toolbar, which this build does not have — the toolbar is
  the shell's page — so "Pin to toolbar" in chrome://extensions was a switch
  with nowhere to show its result. The shell reads the same pinned list
  Chromium's toolbar reads, with each action's per-page title, badge and
  enabled state, and draws them; the icon comes from Chromium's own
  chrome://extension-icon. Clicking one runs the action exactly as the native
  button would, and the browser opens the extension's popup in its own window.
- **The profile button shows the signed-in Google account**, picture and all,
  and updates on its own. It read the profile only while its menu was open, so
  the icon never changed; the account now comes from the browser (its identity
  manager) on load and after each navigation, which is also when a freshly
  downloaded avatar first exists.
- **The profile menu names the account** instead of opening with four links to
  nowhere in particular, and links straight at Chromium's own passwords,
  autofill and addresses, payment methods and sync pages. Those read the
  profile's encrypted store and cannot be rebuilt outside Chromium's settings,
  so pointing at them is the whole job.
- **The address bar can reach the browser's own pages.** Typing any
  `chrome://…` URL was handed to the search engine as a query, because the
  URL-or-search test did not know the scheme. chrome://password-manager, where
  chrome://settings/passwords redirects, was also missing from the shell's
  navigation allowlist, so saved passwords were doubly unreachable.
- **Markdown, JSON, CSV and friends open in Document Studio again** when
  navigated to, with its styled/source toggle, instead of rendering as raw
  text. The interception lived in the Electron main process and was deleted
  with it; the decision now lives in shared code and runs before a native view
  is created, so a workspace document never flashes as plain text. It is still
  limited to documents inside the open workspace.

### Changed

- **Apple Silicon only, deliberately.** Intel Macs are out of scope; Windows
  and Linux come first when the platform list grows. Packaging no longer warns
  about the missing universal build.

### Added

- **A normal Mac install.** `package-fork` gained `--identity` and
  `--notary-profile`: it signs every Mach-O in the bundle inside-out with the
  hardened runtime and a secure timestamp, notarizes and staples the app,
  builds the disk image around the stapled app, then signs, notarizes and
  staples the image, and finally asserts that Gatekeeper says *accepted,
  source=Notarized Developer ID* and that the ticket survives on the app inside
  the volume. `npm run release:dmg` is the whole release; `npm run
  release:preflight` reports which of the three Apple credentials is missing
  and the exact command that obtains it. The credential itself is never read by
  anything here — `notarytool` gets a keychain profile name.
- **The development keychain can no longer ship.** Packaging a build with
  `webdeck_dev_keychain = true` is a blocker unless `--allow-dev-keychain` is
  passed, because that build keeps the cookie and password key in a plaintext
  file. Release builds set it to `false`, and the flag's helpers now compile
  out cleanly when it is off (they tripped `-Wunused-function` under `-Werror`).
- **Permissions live in the composer.** The permission mode is a pill beside
  the model pill ("Full autonomy · 2 guards") opening one popover with the
  modes, the guards, custom rules and the per-site decisions; the Agents
  header keeps a shield that opens the same popover. The two settings strips
  above the transcript are gone.
- **Guards are separate choices.** The single "banking, payment and password
  sites" switch is now five: payments & checkout, banking & brokerage,
  passwords & identity, email & messaging, posting publicly. Payments and
  posting also match by path (a checkout-looking page; a new issue, pull
  request or release on a code host). Prompts name the guard that asked. An
  older policy file's single switch carries over to the first three guards.
- **Guards reach injected script.** `browser_eval` was gated only as a
  command, which full autonomy allows, so script could act on a guarded
  checkout or banking page that a click would have asked about. It is now
  checked against the page it runs on first, like a click or a keystroke; an
  end-to-end test drives click, type and eval on a guarded page under full
  autonomy and expects a prompt for each.
- **Popovers are never clipped by their block.** Menus opened inside a Deck
  block (the permission panel, conversation history) render through a portal
  with fixed positioning: clamped to the window, flipped to the side with
  room, and capped to the space available so they scroll instead of running
  off the edge. The composer's bottom row stays on one line at any block
  width (the permission pill truncates; nothing wraps).
- **Responsiveness pass across the shell** (audit at the Deck's 330×260
  minimum and in narrow windows): the tab context menu and the editor's
  outline menu were rendered inside `overflow-hidden` parents and clipped
  (the outline menu never showed at all; the rail's tab menu was invisible) —
  both are portalled now; the Files block's recents no longer squash into
  half-height rows; the branch, downloads, bookmarks, omnibox and profile
  menus cap their height to the window and scroll; the REST history and DB
  schema sidebars give way below 45% of the block; the CSV filter and the
  start page's brand lockup shrink with their container.
- The new-tab page's WebDeck mark is 60px (was 40px).

- **A browsing-first new-tab page**: the address field is focused, top sites
  and bookmarks are one click away, and projects are one quiet row (recents
  plus "Open a project…"). The brand lockup and opener show only while the
  profile is fresh.
- **Shell-owned browser commands**: in a WebDeck window the native menu and
  key equivalents that fire while the page has focus (⌘T, ⌘W, ⌘L, ⌘F, ⌘⇧T,
  ⌘1–9, ⌘⇧[ ], DevTools, Bookmark This Tab) are forwarded to the shell
  (`ShellClient.OnCommand`) instead of running Chromium's handlers — so ⌘T
  opens WebDeck's new tab, never chrome://newtab.
- **⌘D reveals the Dev Deck** from anywhere, page focused or not
  (`IDC_WEBDECK_TOGGLE_DECK`); Bookmark This Tab moves to ⌘⌥D.
- **Vertical tabs as a rail block** docked beside the page, with tab groups as
  sections; the toolbar moves up into the title bar in that mode.
- **Native path picker** (`Shell.PickPaths`): "Open…" on the start page and in
  the Files block opens the folder panel; agent attachments pick real files.
- **Development keychain** (gn arg `webdeck_dev_keychain`, off by default): on an
  ad-hoc or unsigned bundle the cookie encryption key is a stable 0600 file in
  the profile instead of a login-Keychain item, so dev builds never raise the
  "Chromium Safe Storage" prompt. `WEBDECK_REAL_KEYCHAIN=1` forces the real
  Keychain; `verify:hardening --release` warns when the flag is on.
- `verify:hardening --release` reports whether the bundle carries a Team
  Identifier.
- Electron removed: WebDeck is the Chromium fork only.
- VS Code extensions from Open VSX; each contributed view is its own block.

## v0.1.0 — 2026-09-01

First tagged release. Arcwel WebDeck is an agent-first universal IDE and browser
built as a **forked Chromium (M153)**: the browser *is* WebDeck — a React shell
at `chrome://webdeck` draws the browser chrome while real pages render in a
positioned stage, and an IDE + agent runtime (`webdeck-core`) runs alongside.

### Browser

- Integrated Chromium browsing driven by the WebDeck shell (glass tab strip,
  toolbar, omnibox), with the shell owning window chrome and a draggable title bar.
- Ad & tracker blocking (app-side settings + a Chromium URL-loader throttle).
- Unpacked MV3 browser extensions load into the browsing session.
- Reader Mode, find-in-page, zoom, per-tab devtools, PiP, split view.

### IDE

- Monaco-based editor, file tree, and a real terminal (node-pty), plus LSP/DAP
  language support with vendored servers.
- Live Preview and a slide runtime; Document Studio (stylized JSON/Markdown viewer).
- Jupyter notebook block; REST/DB blocks in the Dev Deck.
- VS Code parity pass for the core editing surface (editor extensions from
  Open VSX are deferred — see SECURITY.md).

### Agent

- Mission Control agent orchestration with an Agent Composer input surface.
- Autonomous browser control and verification (the agent drives real tabs via a
  scoped `chrome://webdeck` ↔ core interface), with artifacts & execution reports.
- Permission modes with a fail-closed policy gate (`checkAction`).

### Security & hardening

- `chrome://webdeck` ↔ core boundary carries a per-boot token and an
  `Origin`-header allowlist; the WebUI CSP pins `connect-src` to loopback only.
- Agent browser navigation is restricted to `http`/`https` — `file://` is
  rejected on both the client allowlist and the C++ `Page.navigate` gate, closing
  an arbitrary local-file disclosure path.
- `verify:hardening` proves the process sandbox and full site isolation are on at
  runtime (Site-Per-Process + a cross-site OOPIF test) and, with `--release`,
  hard-fails a build whose gn config drifted off the shippable settings.

### Release engineering

- Reproducible fork: pinned base in `chromium/fork.json`, tracked patches, and
  `verify:patches` / `verify:fork` / `verify:hardening` gates.
- `upstream:check` reports when the pinned base falls behind and whether the
  patch set still applies.
- `update:check` — a signed-manifest auto-update **channel**: a pinned Ed25519
  key verifies each appcast (fail-closed), so an unsigned update can never be
  offered. Binary download/apply and the in-product prompt are tracked for a
  later release.

### Known limitations

- Signed distribution (DMG notarization) needs an Apple Developer ID and is
  documented, not automated (`chromium/RELEASING.md`).
- Headless/CI launches of a build without the development keychain must pass
  `--use-mock-keychain`: without an interactive login keychain, the cookie
  store's OSCrypt key fetch blocks and the shell cannot boot. (Superseded for
  dev builds by `webdeck_dev_keychain`; see Unreleased.)
- Auto-update is check-only; upstream tracking automation and update delivery
  (13.7) are in progress.
