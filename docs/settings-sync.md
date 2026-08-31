# Settings Sync

WebDeck can keep your settings the same across every machine you use it on —
**without an account and without a server**. You point WebDeck at a single file
kept in a folder your computer already syncs (iCloud Drive, Google Drive,
Dropbox, or any folder that syncs itself), and that file becomes the shared
source of truth. Each machine reads it on launch and whenever it changes, and
writes your own edits back.

## What syncs

| Section | What's in it |
| :-- | :-- |
| **Browser settings** | Search engine, download behavior, spell-check, Do-Not-Track, restore-tabs, permission prompting. |
| **Permission policy** | The agent's mode (Secure/Review/Agent/Custom) and your custom rules and allowed hosts. |
| **AI model** | Which Claude model the agent uses. |
| **Theme** | Light or dark. |

Everything else — open tabs, per-project layout, agent history, API keys —
stays **local to each machine**. (API keys live in your OS keychain and are
never written to the sync file.)

## Turning it on

1. Open **Settings → Sync**.
2. Click **Choose file…** and pick a location inside a synced folder — for
   example `~/Library/Mobile Documents/com~apple~CloudDocs/webdeck-sync.json`.
   WebDeck creates the file if it doesn't exist and immediately writes your
   current settings into it.
3. Turn on **Sync automatically**.
4. On your other machines, choose the **same file** (it's already there, synced
   by your cloud folder) and turn on auto-sync.

You can also **Push now** / **Pull now** manually at any time.

## How conflicts are handled

The file is organized into independent sections, and each carries the time it
was last changed. When two machines disagree, WebDeck resolves it **per
section, newest change wins** — so changing your theme on your laptop and your
policy on your desktop both stick, because they're different sections. Within a
single section, the most recent edit wins.

There's no locking and no server arbitration, which is what lets it work over a
plain synced file. In the rare case where the exact same section is changed on
two machines before either syncs, the later write wins and the earlier one is
replaced — the same way an edited document in a shared folder behaves.

## Notes

- The sync file is plain JSON — you can read it, back it up, or move it.
- If your cloud folder is offline, WebDeck just syncs the next time the file is
  reachable; nothing is lost.
- Under the hood the merge logic is pure and unit-tested (`sync-merge.ts`), and
  the engine imports no Electron, so it runs unchanged once WebDeck moves onto
  its forked-Chromium base.
