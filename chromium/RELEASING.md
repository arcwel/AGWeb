# Releasing Arcwel WebDeck

How a build becomes a DMG a tester can open. Every command that needs your Apple
Developer credentials is marked **[YOU]** — those cannot be run for you, and the
rest of the pipeline runs without them (producing an ad-hoc-signed build that
installs with one Gatekeeper step, fine for internal testing).

The analysis behind the build settings is in [SHIPPABLE.md](SHIPPABLE.md); this
is the procedure.

## The shape of it

A shipped WebDeck is one `.app` containing two programs that must both be sealed
under the same signature:

- **the browser** — the Chromium fork, built release-configured
- **`webdeck-core`** — the IDE/agent service, a self-contained executable the
  browser spawns (`Contents/MacOS/webdeck-core`, with `webdeck-core-runtime/`
  beside it)

Neither is distributable on its own. The steps below build each, put the core
inside the browser bundle, sign the whole thing, and wrap it in a DMG.

## Prerequisites

- macOS on Apple Silicon (arm64). This is the only target today.
- The Chromium checkout with depot_tools on `PATH`
  (`/Volumes/BG_Dev/webdeck-chromium/`).
- Node and npm, for building the core and running the pipeline.

## 1. Build the core

```bash
cd app
npm ci
npm run build:core
```

Produces `app/out/core/webdeck-core` — a ~122 MB Mach-O with the JS sealed
inside a copy of the official Node runtime, plus `webdeck-core-runtime/` for the
native pieces that cannot live inside an executable (node-pty, the js-debug
adapter, reveal.js data). `npm run verify:core` proves it boots with no Node
installed and runs a real pty.

**Do not use the developer's Homebrew Node here.** `build:core` fetches the
official nodejs.org runtime deliberately: Homebrew's `node` is a stub over
dylibs in `/opt/homebrew` that would neither run on a tester's machine nor pass
Apple's library validation.

## 2. Build the browser, release-configured

The dev build is a component build with fatal DCHECKs — a tester would hit
crashes that are not real bugs. The release build fixes both.

```bash
cd /Volumes/BG_Dev/webdeck-chromium/chromium/src
gn gen out/webdeck-release --args='
  target_cpu = "arm64"
  is_official_build = true
  is_component_build = false
  is_debug = false
  is_chrome_branded = false
  symbol_level = 1
  blink_symbol_level = 0
  use_remoteexec = false
  chrome_pgo_phase = 0
'
autoninja -C out/webdeck-release chrome
```

Notes:

- `is_official_build = true` is what turns `dcheck_always_on` **off** — do not
  set that arg yourself, and do not set `dcheck_always_on = true`, which would
  silently re-disable PGO.
- `chrome_pgo_phase = 0` is required because this checkout has no PGO profiles.
  The cost is a browser measurably slower than stock Chrome; acceptable for
  testing, revisit before a real launch (see SHIPPABLE.md §4).
- This is a whole-program ThinLTO build. Expect **2–4 hours cold**, and every
  later source change re-runs the whole-program link (tens of minutes), not the
  ~3-minute incremental of the component build. Keep the component build
  (`out/webdeck`) for development; use the release build only for candidates.

Confirm the settings resolved as intended — `dcheck_always_on` never appears in
`args.gn`, so read the resolved values, not the file:

```bash
gn args out/webdeck-release --list --short | grep -E 'dcheck_always_on|is_official_build|is_component_build'
```

## 3. Assemble the deliverable

From the repo root, with the release build finished:

```bash
APP="/Volumes/BG_Dev/webdeck-chromium/chromium/src/out/webdeck-release/Arcwel WebDeck.app"

# Put the core inside the browser bundle.
node app/scripts/install-core.mjs --app "$APP"

# Prove it runs on a machine that has never seen the build tree.
node app/scripts/verify-deliverable.mjs --app "$APP"
```

`verify-deliverable` copies the bundle away from the build directory, strips the
environment to what a fresh Mac has, and runs it there. If it reports anything
under a ✗, a tester would hit exactly that and you would not — do not ship past
a red line.

## 4. Package and sign

```bash
npm --prefix app run package:fork -- --build-dir "$(dirname "$APP")" --out dist
```

With no credentials this **ad-hoc signs** the bundle — the browser, the core,
and every native file in the core's runtime — and produces a DMG under `dist/`.
An ad-hoc build installs, but Gatekeeper warns on first open (see §6). That is
the right artifact for internal testing.

### [YOU] Real signing and notarization

For a build that opens with no warning, the app must be signed with an Apple
**Developer ID Application** certificate and notarized. A self-signed identity
will not work — the app signs with `library` validation, which requires a real
Team ID. You need:

- Apple Developer Program membership → your Team ID
- a **Developer ID Application** certificate in your login keychain
- an App Store Connect API key for `notarytool`

The Chromium tree implements this end to end; point it at your identity:

```bash
# [YOU] — replace IDENTITY with your Developer ID Application common name.
cd /Volumes/BG_Dev/webdeck-chromium/chromium/src
python3 chrome/installer/mac/sign_chrome.py \
  --input out/webdeck-release \
  --output out/webdeck-release/signed \
  --identity "IDENTITY" \
  --notarize

# [YOU] — staple the notarization ticket so it verifies offline.
xcrun stapler staple "out/webdeck-release/signed/Arcwel WebDeck.app"
```

Then re-run `install-core` and `package:fork` against the signed app, or DMG the
signed bundle directly with `hdiutil`.

## 5. Give it to a tester

Hand over the DMG. To install: open it, drag **Arcwel WebDeck** to Applications.

## 6. What macOS says about an unsigned build

An ad-hoc / unsigned build is not notarized, so on first open Gatekeeper shows
*"Arcwel WebDeck can't be opened because Apple cannot check it for malicious
software."* The correct handling for an internal tester — **not** disabling
Gatekeeper system-wide:

1. Open the app once. The warning appears; dismiss it.
2. **System Settings → Privacy & Security**, scroll to the message naming Arcwel
   WebDeck, click **Open Anyway**.
3. Confirm once more. macOS remembers the choice for this app.

Tell testers this is expected for an internal build and will go away once the
app is notarized (§4 [YOU]).

## 7. The keychain prompt ("wants to use the Arcwel WebDeck Safe Storage key")

Chromium keeps the key that encrypts cookies and saved passwords in the login
keychain, under an item named *Arcwel WebDeck Safe Storage*. macOS lets an app
read its own keychain item without asking only when it can bind the item's
access control to a stable code identity. A notarized app has a Team ID and
binds cleanly. An ad-hoc build has none — macOS binds to the code hash instead,
which works **only if two things hold**:

- **The app runs from a stable path.** A quarantined un-notarized app launched
  from the DMG or Downloads is *App-Translocated* — macOS runs it from a random
  read-only path that changes each launch, so the binding never matches and the
  prompt returns every time. **Dragging the app to /Applications in Finder clears
  translocation** (this is why §5 says drag to Applications, not run-in-place).
- **The binary does not change.** Every rebuild produces a new code hash, so a
  keychain item created by a previous build no longer matches. During
  development this is why the prompt reappears after each build.

So for a tester on a **single delivered build installed to /Applications**: the
prompt appears **once**, they click **Always Allow**, and it does not return.

If a machine was used to run *several* builds (e.g. this one), a stale item from
an earlier build's hash lingers and prompts on every launch. Clear it once:

```bash
security delete-generic-password -s "Arcwel WebDeck Safe Storage" 2>/dev/null || true
```

The next launch of the installed app recreates it, bound to that build's hash,
and prompts once more (Always Allow) — then it is quiet.

**Do not "fix" this with `--use-mock-keychain`.** That switch routes OSCrypt to
an in-memory fake keychain whose key is regenerated every launch, which makes
every previously stored cookie and password undecryptable on the next start —
it silently logs the user out of everything on each run. Notarization (§4 [YOU])
is the only change that removes the prompt without that cost, because a Team ID
gives the keychain a stable identity to bind to.

## What still needs deciding before a real launch

Not blockers for testing, but named so they are not forgotten (SHIPPABLE.md has
the detail):

- **No auto-update.** `enable_updater = false`; there is no way to push a fix to
  a tester once they have the DMG. Each build is a fresh download.
- **No PGO**, so the browser is slower than stock Chrome.
- **arm64 only.** No Intel or universal build.
- **No media codecs.** `proprietary_codecs = false` → no H.264/AAC; a
  patent-licensing decision, not a build flag.
- **Rebasing on upstream security fixes** means a 2–4 hour build within days of
  each Chromium CVE. `npm run upstream:check` reports when we fall behind.
