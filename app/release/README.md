# Release update channel

The fork brings its own auto-update channel (TASKS.md 10.2). Chromium's updater
is Google-infrastructure-bound, so the client checks a **signed manifest** we
publish and refuses anything that does not verify against a pinned key — an
unsigned update channel is a remote-code-execution channel.

Tool: [`app/scripts/update-check.mjs`](../scripts/update-check.mjs) (`npm run update:check`).

## Keys

- `update-pubkey.pem` — the Ed25519 **public** key, committed here. The updater
  pins it; every manifest must verify against it.
- `update-signing-key.pem` — the **private** key. NEVER committed (gitignored).
  Whoever cuts releases holds it, ideally in a secret manager or a hardware key.

Mint the pair once:

```bash
node scripts/update-check.mjs --genkey ./release
# then commit release/update-pubkey.pem; store update-signing-key.pem securely
```

Rotating the key is a breaking change for already-installed clients (they pin
the old key), so a rotation ships in a build signed with the OLD key that
carries the NEW key — plan it, don't do it casually.

## Manifest (appcast)

The release process writes a plain manifest, then signs it:

```jsonc
// manifest.json — the release build's facts
{
  "channel": "stable",
  "version": "0.2.0",
  "pubDate": "2026-09-01T00:00:00Z",
  "url": "https://dl.example.com/Arcwel-WebDeck-0.2.0-arm64.dmg",
  "sha256": "<hex sha256 of the dmg>",
  "size": 123456789,
  "notes": "https://example.com/releases/v0.2.0",
  "critical": false // true when it carries upstream security fixes
}
```

```bash
node scripts/update-check.mjs --sign manifest.json --key ./release/update-signing-key.pem \
  --out appcast.json
# publish appcast.json at a stable https URL; the client reads THAT
```

The signature covers a canonical (sorted-key) serialization of `manifest`, so
the signer and verifier agree byte-for-byte regardless of JSON key order.

## Client check

```bash
npm run update:check -- --manifest https://dl.example.com/stable/appcast.json --json
```

Exit codes: `0` up to date · `1` update available · `2` could not run · `3`
manifest failed to verify. Code `3` is distinct on purpose — a fail-closed
updater must never mistake a forged manifest for "nothing to do".

## Out of scope here (13.7c / 13.7d)

This is the **check** and the **signing** half. Downloading the dmg, verifying
its `sha256`, swapping the app, staged rollout, rollback, and the non-modal
in-product "update ready" prompt are 13.7c/13.7d — a wrong "update available" is
cheap; a wrong "installed" is not, so those land deliberately, separately.
