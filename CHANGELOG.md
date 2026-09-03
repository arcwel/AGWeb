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

### Added

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
