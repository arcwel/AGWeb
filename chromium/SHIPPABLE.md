# What it takes to make Arcwel WebDeck shippable

Investigation dated 2026-08-30 against checkout `/Volumes/BG_Dev/webdeck-chromium/chromium/src`
at `153.0.8010.12`. Everything below is marked **measured** or **not verified**.
Nothing was signed, no keychain was touched, `out/webdeck` was not modified.

---

## 0. Where we actually are

`out/webdeck` resolves to (measured, `gn args out/webdeck --list --short`):

```
is_official_build  = false
is_component_build = true
dcheck_always_on   = true      <- resolved default, invisible in args.gn
is_debug           = false
symbol_level       = 1
chrome_pgo_phase   = 0
use_thin_lto       = false
enable_stripping   = false
enable_dsyms       = false
```

The mechanism behind the invisible DCHECK, from `build/config/dcheck_always_on.gni`:

```gn
dcheck_always_on = (build_with_chromium && !is_official_build) || dcheck_is_configurable
```

`build_with_chromium = true` (generated into `build/config/gclient_args.gni`), so
`is_official_build = false` alone turns fatal DCHECKs on. There is no arg to unset
in `args.gn` — the fix is `is_official_build = true`.

Confirmed on the compiler command line. Same TU (`base/values.cc`), commands
extracted with `ninja -t commands` from each build dir, flags diffed:

| present in `out/webdeck` only | present in `out/webdeck-release` only |
| :--- | :--- |
| `-DDCHECK_ALWAYS_ON=1` | `-DOFFICIAL_BUILD` |
| `-DCOMPONENT_BUILD` | `-flto=thin` |
| `-DBORINGSSL_SHARED_LIBRARY`, `-DABSL_CONSUME_DLL` | `-fsplit-lto-unit` |
| `-ftrivial-auto-var-init=pattern` | `-fwhole-program-vtables` |
| `-D__DATE__=`, `-D__TIME__=`, `-D__TIMESTAMP__=` | `-inlinehint-threshold=360` |
| `-Wunique-object-duplication` | `-ftrivial-auto-var-init=zero` |
| raw_ptr / raw_ref / span clang-plugin field checks | |

Two things fall out of that table that are worth naming:

- The official build **drops** the raw_ptr/raw_ref/span plugin checks and the
  `unique-object-duplication` warning. Those are development-only diagnostics.
  Keeping a component build around is not just about speed — it is where those
  checks and the DCHECKs live. A release-only fork loses them.
- The official build **removes** the `__DATE__`/`__TIME__` scrubbing and
  `-ffile-compilation-dir=.`. Release binaries embed build timestamps and
  absolute source paths. Not a blocker; relevant if reproducible builds ever matter.

---

## 1. The proposed `args.gn`

```gn
# ── target ────────────────────────────────────────────────────────────────
target_cpu = "arm64"

# ── the two that matter ───────────────────────────────────────────────────
is_official_build  = true
is_component_build = false

# ── forced by our checkout, see §2 ────────────────────────────────────────
chrome_pgo_phase = 0

# ── explicit restatements of defaults, kept for legibility ────────────────
is_debug         = false
is_chrome_branded = false
use_remoteexec   = false

# ── debug-info budget ─────────────────────────────────────────────────────
symbol_level       = 1
blink_symbol_level = 0
```

Per-arg rationale — what each one buys *us*, not what a wiki says:

**`is_official_build = true`** — the whole point. It is what sets
`dcheck_always_on = false`, which is what stops the browser CHECK-crashing on
conditions a shipping Chrome tolerates. It also switches on ThinLTO
(`thin_lto_enable_optimizations` is true for `is_mac && is_official_build`),
whole-program devirtualization, `-Wl,-dead_strip`, `-Wl,-no_function_starts`,
`enable_stripping = true` and `enable_dsyms = true`. Measured: with this set,
`dcheck_always_on` resolves to `false` and `use_thin_lto` to `true`.

**`is_component_build = false`** — required, and not only on aesthetics. Two
hard reasons: (a) `chrome/installer/mac/signing/README.md` states outright that
"Signing requires a statically linked build (i.e. `is_component_build = false`)";
(b) the current build emits **520 `.dylib` files totalling 865 MB** next to the
app, and the bundle's own framework binary is a **16,784-byte stub** that loads
them from the build directory. That bundle cannot be moved off this machine at
all, let alone signed as a sealed unit.

**`chrome_pgo_phase = 0`** — forced, see §2. It costs perceived performance
(Chrome's own PGO is worth roughly 10% on real workloads; we have not measured
what it is worth for us). It is the single arg here that is a compromise rather
than a choice.

**`symbol_level = 1`** — line tables, no full DWARF. With `enable_dsyms = true`
(auto-on) this is enough to symbolicate a crash stack to file:line, which is the
only reason to carry symbols in a shipping build at all. `symbol_level = 2`
multiplies dSYM size and link time for information a crash reporter does not use.
`symbol_level = 0` would make the dSYMs worthless. 1 is the right point.

**`blink_symbol_level = 0`** — Blink is the largest single source of debug info
in the tree. Zeroing it is the cheapest large saving available and the existing
build already does it.

**`is_chrome_branded = false`** — must stay false. `checkout_src_internal = false`
in our gclient args, so the internal sources a branded build needs are not present.
Branding is already handled correctly the other way: the fork's `branding.diff`
rewrites `chrome/app/theme/chromium/BRANDING`, which a `is_chrome_branded = false`
build reads. Verified in the checkout:

```
COMPANY_FULLNAME=Arcwel
PRODUCT_FULLNAME=Arcwel WebDeck
MAC_BUNDLE_ID=tech.arcwel.webdeck
```

**`use_remoteexec = false`** — no reclient/RBE credentials here. Keep it off or
`gn gen` will demand a backend.

**`target_cpu = "arm64"`** — this machine and this checkout, and the only Mac
target there will be. Intel Macs would need a second `target_cpu = "x64"` out dir and a merge through
`chrome/installer/mac/universalizer.py`. That doubles everything in §3.

Deliberately **not** set, and why:

- `dcheck_always_on` — do not set it. It resolves to `false` on its own once
  `is_official_build = true`. Worse, setting it `true` would *silently re-disable
  PGO*: `build/config/compiler/pgo/pgo.gni` gates `chrome_pgo_phase = 2` on
  `!dcheck_always_on`. An official build with DCHECKs on is not a release build.
- `is_cfi` — resolves to `false` here anyway on mac/arm64. Nothing to gain.
- `enable_dsyms` / `enable_stripping` — both resolve to `true` from
  `is_official_build` (`build/config/apple/symbols.gni`). Leave them. If you want
  a fast throwaway release build to smoke-test, `enable_dsyms = false` is the one
  override worth reaching for; it removes the serialized `dsymutil` pass.
- `enable_nacl`, `use_lld`, `use_siso` — not declared / already correct. Both
  build dirs use siso, so the timings in §3 are like-for-like.

Two more that are **product decisions, not build hygiene**, and are currently off
in both configs (measured):

```
proprietary_codecs = false
ffmpeg_branding    = "Chromium"
enable_updater     = false
```

A browser that ships without `proprietary_codecs = true` / `ffmpeg_branding = "Chrome"`
cannot play H.264 or AAC — most of the video on the web. Turning them on is a
patent-licensing decision (MPEG-LA/Via), not a gn decision. Flagging it because
it is the kind of thing that gets discovered by a user, not by a build.

---

## 2. What broke — the bounded experiment

### `gn gen` attempt 1: the proposed args without `chrome_pgo_phase`

**It failed.** Verbatim:

```
ERROR at //build/config/compiler/pgo/BUILD.gn:145:23: Script returned non-zero exit code.
      pgo_data_path = exec_script("//tools/update_pgo_profiles.py",
Command: .../tools/update_pgo_profiles.py --target mac-arm get_profile_path
Returned 1.
RuntimeError: requested profile ".../chrome/build/pgo_profiles/chrome-mac-arm-8010-1787425577-
8ce0dbe6da710301d00d1019f65f1e3ae67af5eb-c7cad0e77f6b386aa3802169cc9e89c6244c5dc9.profdata"
doesn't exist, please make sure "checkout_pgo_profiles" is set to True in the "custom_vars"
section of your .gclient file ... You can also simply disable the PGO optimizations by
setting |chrome_pgo_phase = 0| in your GN arguments.
```

This is exactly the "official builds need things a dev checkout lacks" failure,
and it is the *only* one our checkout hit. Root cause, confirmed at source:

- `DEPS:169` — `'checkout_pgo_profiles': False` is the default.
- `/Volumes/BG_Dev/webdeck-chromium/chromium/.gclient` has `"custom_vars": {}` —
  it was never overridden.
- `chrome/build/pgo_profiles/` **does not exist** on disk (measured).
- `chrome/build/mac-arm.pgo.txt` names the profile the build wants.

Fixing it properly (not done — it changes checkout state while other work is in
flight) is two steps and a download:

```
# .gclient
"custom_vars": { "checkout_pgo_profiles": True },
# then
gclient runhooks
```

That is a network fetch of the mac-arm profdata. It was **not attempted** — a
`gclient runhooks` re-runs every hook in the checkout and I was told other work
depends on it being intact.

### `gn gen` attempt 2: `+ chrome_pgo_phase = 0`

**It succeeded.** Verbatim:

```
Done. Made 32769 targets from 4951 files in 4187ms
```

For comparison, `chromium/README.md` records 32,532 targets for the component
build. The fork's own targets are all present in the release graph (measured,
`gn ls out/webdeck-release`):

```
//chrome/browser/resources/webdeck:resources
//chrome/browser/ui/webui/webdeck:webdeck
//chrome/browser/ui/webui/webdeck:impl
//chrome/browser/ui/webui/webdeck:mojo_bindings
//chrome/browser/webdeck:core_service
```

All three fork targets are `source_set(...)`, which is the non-component-safe
target type — nothing in the patch set declares a `component()`, so there is no
`COMPONENT_EXPORT` visibility work to do.

`//chrome/installer/mac` is also in the graph (`:mac`, `:copies`, `:copy_signing`,
`:sign_config`), so the signing/packaging driver can be produced by this config.

### The capped build

`autoninja -C out/webdeck-release -j 6 chrome`, started, sampled, and killed.

| elapsed | object files | rate | out dir |
| ---: | ---: | ---: | ---: |
| 45 s | 365 | — | 2.9 GB |
| 138 s | 2,083 | 15 /s | 3.7 GB |
| 234 s | 4,389 | 22 /s | — |
| 294 s | 5,448 | 18 /s | — |
| 355 s | 6,049 | 10 /s | — | 
| 415 s | 6,496 | 7 /s | — |
| 475 s | 6,913 | 7 /s | — |
| 610 s | 8,478 | 13 /s | 5.2 GB |
| 731 s | 10,423 | 16 /s | 5.8 GB |
| **810 s (stopped)** | **10,649** | — | **5.9 GB** |

**Confound, found afterwards and worth stating.** The 10 /s → 7 /s trough at
t=355–475 s is *not* intrinsic. Someone else's incremental build ran in
`out/webdeck` from 19:14 to 19:17 — mtimes on `out/webdeck/libchrome_dll.dylib`
(19:17:07) and `siso_metrics.json` (19:17:08) confirm it — which maps onto
t≈300–480 s of my run almost exactly. That is the drive contention
`chromium/README.md` warns about, from two builds at once. The rate recovered to
13–16 /s immediately after. Steady-state for this config on an uncontended drive
is **~15 objects/s at `-j 6`**, not 7.

**Zero compile errors and zero warnings** across 10,649 translation units. The
only line in the whole log besides siso's heartbeat dots was
`warning: no debug symbols in executable (-arch arm64)` from a host tool link.

So: **an `is_official_build = true`, non-component build of this fork compiles.**
That is established for the first ~22% of the object graph.

**What is NOT established** — and this is the important part:

- The build was never finished. I did not reach the ThinLTO link of the Framework,
  which is where a non-component build most often fails and is by far the longest
  single step.
- No binary was produced, launched, or verified. `verify-hardening.mjs` has not
  been run against a release build.
- Nothing was signed or packaged.
- `chrome/installer/mac` was not built.

"gn accepted the args and 10,649 objects compiled clean" is what I have. It is
not "it builds".

---

## 3. Build time and disk

### Per-TU compile is *not* the problem — measured, and it surprised me

Same source file, same machine, both commands lifted from the real build graphs,
two runs each, warm:

| config | `base/values.cc` compile | object size |
| :--- | ---: | ---: |
| `out/webdeck` (component, DCHECK) | 1.59 s / 1.44 s | 732 KB |
| `out/webdeck-release` (official, ThinLTO) | 1.25 s / 1.23 s | 837 KB |

The official build is ~15% **faster** per TU. Two reasons, both visible in the
flag diff: `-flto=thin` makes the front end emit bitcode and defers optimization
to link time, and the official build drops the raw_ptr/span clang plugin passes.

The cost did not vanish. It **moved to the link**.

### Cold build estimate

10,649 objects in 810 s. The component build's completed object graph is
**47,244 `.o` files** (measured in `out/webdeck/obj`), and the non-component graph
is comparable.

At the uncontended steady rate of ~15 obj/s, 47,244 objects is **~55 min of
compile**. Two corrections pull that upward: the first ~2,000 objects are cheap
host tools and generated protobufs, and the heaviest TUs in the tree (V8, Blink
core, Skia) are all still ahead — none of them appeared in the first 22%. Call
the compile phase **1–2 h at `-j 6`**, which is not far off the ~1 h the component
build already takes. That is the good news, and it follows directly from the
per-TU measurement above.

The bad news is what sits on top: the ThinLTO link of the Framework, then
`dsymutil`. I measured **neither**. Both are essentially serial, and ThinLTO link
of a Chromium-sized program is conventionally the single longest step in the
build. Plan for **2–4 h cold** in total, and treat the spread as the honest width
of my ignorance about the link, not as a measurement.

Reference point: the memory note for this fork records the current component
build at ~1 h cold.

### Disk

- 5.9 GB at 22% of objects → `obj/` alone lands around **26 GB**.
- Plus `gen/` (306 MB measured), the ThinLTO cache (54 MB at 12 min and growing
  monotonically — `thin_lto_enable_cache = true`), the host Rust toolchain
  (355 MB measured), the linked Framework, and the dSYM bundles.
- Estimate **35–60 GB** for `out/webdeck-release` complete, against **12 GB** for
  `out/webdeck`.
- `/Volumes/BG_Dev` has 772 GB free. **Disk is not a constraint.** Do not let disk
  drive this decision.

### The rebuild loop — this is the real cost

This is the number that matters and it is worth being blunt about.

In `out/webdeck`, editing `webdeck_ui.cc` recompiles one TU and relinks
`libchrome_dll.dylib` — a 163 MB dylib, but one dylib. That is the ~3 min loop
that makes fork iteration sustainable.

In a non-component ThinLTO build there is no `libchrome_dll.dylib`. There are
520 fewer dylibs and one monolithic Framework binary, and every edit to any file
linked into it re-runs the whole ThinLTO link — the LTO cache makes the *second*
one cheaper, but the link itself is a single serialized step over the entire
program. **I did not measure it.** Chromium's own guidance is that ThinLTO
substantially increases link time; the gn comment in
`build/config/compiler/BUILD.gn` says so in as many words.

Expect the release-config edit→run loop to be **tens of minutes, not three**.
Treat that as an estimate, not a measurement.

---

## 4. Code signing and notarization on macOS

**Nothing here was attempted. No keychain was touched, nothing was signed.**
This is a requirements list.

Current state (measured, `codesign -dv`):

```
Identifier=Arcwel WebDeck
CodeDirectory v=20400 flags=0x20002(adhoc,linker-signed)
Signature=adhoc
TeamIdentifier=not set
Sealed Resources=none
```

Ad-hoc, linker-generated. Not a signature in any distributable sense.

### What has to exist

1. **An Apple Developer Program membership** ($99/yr) for Arcwel, which yields a
   **Team ID**.
2. **A "Developer ID Application" certificate** in a keychain on the signing
   machine. `chrome/installer/mac/signing/README.md` is explicit that a
   **self-signed identity will not work**, because Chrome signs with the
   `library` (library validation) option — the app may then only load code signed
   by the same Team ID. This is not optional hardening we could drop; it is what
   the parts table asks for.
3. **A "Developer ID Installer" certificate**, *separately*, if `.pkg` output is
   wanted. Apple issues only a deployment installer cert; there is no development
   one. If only a `.dmg` is shipped, this is not needed.
4. **Notary credentials** for `xcrun notarytool`. Two accepted shapes, per
   `chrome/installer/mac/signing/notarize.py`:
   - Apple ID + Team ID + an **app-specific password**, or
   - an **App Store Connect API key** (`--key`, `--key-id`, `--issuer`) — the
     right choice for CI, since it is revocable and not tied to a person.
5. **Xcode command line tools** with `notarytool` (present on any current macOS
   dev machine).

### The pipeline, as the tree already implements it

```
autoninja -C out/webdeck-release chrome chrome/installer/mac
./out/webdeck-release/"Arcwel WebDeck Packaging"/sign_chrome.py \
    --input  out/webdeck-release \
    --output out/webdeck-release/signed \
    --identity 'Developer ID Application: Arcwel (TEAMID)' \
    --notarize \
    --notary-arg --key      --notary-arg /path/to/AuthKey.p8 \
    --notary-arg --key-id   --notary-arg <KEY_ID> \
    --notary-arg --issuer   --notary-arg <ISSUER_UUID>
```

`sign_chrome.py` walks the bundle inside-out (helpers, then the Framework, then
the app), applies `chrome/app/app-entitlements.plist`, signs with
`--options restrict,library,runtime,kill` and `--timestamp`, builds the `.dmg`,
submits to Apple's notary service, polls, and staples the ticket. The
`ChromiumCodeSignConfig` (`is_chrome_branded = false`) path produces a single
distribution — just the `.app` — which is what we want.

The entitlements we would ship (`chrome/app/app-entitlements.plist`, verbatim in
the tree) request audio-input, bluetooth, camera, print, usb, location and
photos-library. Fine for a browser; each one is something a notarization reviewer
and a user's first-launch prompt will see.

### Two signing problems specific to *our* fork

These are not in the "three known problems" list and they are the ones I would
worry about most.

1. **`webdeck-core` is a shell script.** `chrome/browser/webdeck/…` looks for an
   executable named `webdeck-core` in `base::DIR_MODULE`. Today that is a shim
   that runs a Node bundle out of the repo. Inside a signed, notarized bundle:
   every executable under the `.app` must be covered by the seal and signed with
   the same Team ID, and with `library` validation in force the browser process
   cannot load anything else. A shell script that execs a system `node` will
   either break the seal (if placed inside) or run entirely outside the signed
   bundle (if not) — and in the second case, whatever it runs is unsigned,
   unnotarized code launched by a notarized app. `verify-hardening.mjs` already
   reports it as the one unsandboxed child with full user privileges. Shipping
   forces this to be resolved; it cannot be deferred past the first signed build.
2. **Notarization is per-artifact, so the core must be in the artifact.** A
   bundled Node runtime (or a real compiled launcher) has to be produced,
   signed with hardened runtime, and included in the `.dmg` that gets submitted.
   That is a build-system change to the fork, not a signing flag.

### Updater

`enable_updater = false` (measured, both configs). Chromium's updater (Omaha 4)
is in-tree at `chrome/updater/` and `chrome/installer/mac/signing` knows how to
sign it when enabled. Turning it on requires an update *server* speaking the
Omaha protocol, a signed updater bundle, and its own certificate handling. This
is a whole project, not an arg. Until it exists, "shipping" means a manually
downloaded `.dmg` with no update path.

---

## 5. Recommendation

**Keep the fast component build for development. Add `out/webdeck-release` as a
separate, additional configuration. Do not switch wholesale.**

Why:

- The measurements say the release config is not a *slow compiler*, it is a *slow
  linker*. Per-TU it is 15% faster. The pain is concentrated entirely in the one
  step you hit on every single edit. That is the worst possible shape for a
  ~3-minute iteration loop, and it is exactly what the component build exists to
  avoid.
- The component build is not merely faster; it carries diagnostics the release
  build deletes. Fatal DCHECKs, and the raw_ptr / raw_ref / span clang-plugin
  field checks visible in the flag diff, only run in the dev config. Those DCHECKs
  are also the thing that killed `chrome://webdeck` today — which is an argument
  for finding those bugs in the dev build, not for compiling them away.
- `gn gen` succeeding on the first real try, with one fixable PGO complaint and
  10,649 clean objects, says the release config is cheap to *maintain* in
  parallel. The cost of keeping two configs is one extra out dir and one extra
  args.gn. The cost of having only the release config is the iteration loop.
- Conversely, the cost of having only the component config is that the release
  path stays untested until the day it matters. Chromium's non-component ThinLTO
  link is precisely where fork-specific breakage surfaces, and I did not get there.

**The tradeoff, stated plainly:** two configurations means the fork can drift —
code can compile and pass under `out/webdeck` and fail under
`out/webdeck-release`, and you will find out hours later, or in CI, or not at all.
That is the same class of drift `verify-patches` was written to catch, and the
mitigation is the same: make it mechanical. A nightly or pre-tag full release
build is what converts "two configs" from a liability into insurance.

There is a second, smaller cost that showed up by accident during this
investigation: **the two configs contend for the drive.** A three-minute
incremental build in `out/webdeck` at 19:14 halved my release build's throughput
for as long as it ran (§3). On this hardware the two builds must not overlap —
which is another argument for the release build being a scheduled job rather than
something anyone runs ad hoc while working.

### Order of work

1. Set `checkout_pgo_profiles: True` and `gclient runhooks`, then drop
   `chrome_pgo_phase = 0`. This is the one thing that makes the release config a
   real release config rather than an approximation. **Blocked on: nothing but a
   quiet moment in the checkout.**
2. Run one full `autoninja -C out/webdeck-release -j 6 chrome` to the end and find
   out what the ThinLTO link actually costs and whether it succeeds. Everything in
   §3 downstream of the compile phase is an estimate until this is done.
3. Run `verify-hardening.mjs --browser out/webdeck-release/...` against the result.
   It should report `dcheck_always_on` and `is_component_build` as clean and drop
   two of its warnings. That is the check that closes problems 1 and 2.
4. Replace the `webdeck-core` shim with a real signed executable. This blocks
   signing, not the other way round.
5. Then, and only then, obtain the Developer ID certificate and run
   `sign_chrome.py`.

---

## 6. Things that make shipping harder than the three known problems

Ranked by how much trouble they will cause.

1. **`webdeck-core` is a shell script running Node from the repo.** Blocks
   signing outright (§4). Already the fork's one unsandboxed process.
2. **No PGO profiles in the checkout.** Currently worked around with
   `chrome_pgo_phase = 0`, which means shipping a measurably slower browser than
   Chrome. One gclient var and a download to fix, but it must be done deliberately.
3. **`proprietary_codecs = false`.** No H.264, no AAC. A shipped browser that
   cannot play most web video. Turning it on is a patent-licensing decision.
4. **No updater.** `enable_updater = false`; a shipped `.dmg` has no update path
   and no way to push a security fix to users. For a browser this is a serious
   ongoing obligation, not a nice-to-have.
5. **Apple Silicon only, deliberately.** Intel Macs are out of scope: a
   universal binary needs a second full `target_cpu = "x64"` build and
   `universalizer.py`, doubling every number in §3, for a shrinking population.
   Windows and Linux come first when the platform list grows.
6. **Chromium security releases.** Shipping a browser means rebasing onto each
   new stable within days of a CVE, on the 2.5–4 h build described above. The
   `verify-patches` / `upstream:check` machinery exists; the *cadence* obligation
   is what is new.
7. **The release build deletes the dev build's static analysis.** Noted in §5.
   An argument for keeping both, not against shipping.
8. **Not verified at all:** that the fork links, that the resulting binary runs,
   that `chrome://webdeck` works under a non-component build, or that anything
   survives stripping. The build was capped at 22% by design.

---

## 7. CLI opportunities

Every manual step in this investigation was a one-liner wrapped in ceremony.
Recommendations only — nothing built.

```
1. `npm run build:release`      — gn gen out/webdeck-release from a checked-in args.gn
                                  + autoninja, refuses to start if out/webdeck is
                                  building (the §3/§5 contention)          ~30 min
2. `npm run verify:release`     — build:release, then verify-hardening.mjs against the
                                  release binary; asserts dcheck_always_on=false and
                                  is_component_build=false with --json         ~1 hr
3. `npm run diff:args`          — the flag diff in §0, mechanised: pick a TU, pull both
                                  compile commands with `ninja -t commands`, diff.
                                  Turns "what does official actually change" from an
                                  afternoon into a command                    ~45 min
4. `npm run package:mac`        — chrome + chrome/installer/mac + sign_chrome.py, with
                                  --dry-run and credentials from env, never inline
                                  (blocked on §4: certificate must exist first) ~2 hr
```

Number 3 is the one worth building first. It is cheap, it is the only way to see
what changing a gn arg *actually does* to the compiler, and it is exactly the
class of thing that is invisible in `args.gn` — the same blind spot that hid
`dcheck_always_on` in the first place.
