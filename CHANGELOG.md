# Changelog

All notable changes to Arcwel WebDeck are recorded here. This project adheres to
[Semantic Versioning](https://semver.org/).

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
- Headless/CI launches must pass `--use-mock-keychain`: without an interactive
  login keychain, the cookie store's OSCrypt key fetch blocks and the shell
  cannot boot. Interactive launches are unaffected.
- Auto-update is check-only; upstream tracking automation and update delivery
  (13.7) are in progress.
