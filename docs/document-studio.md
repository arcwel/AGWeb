# Document Studio

Document Studio renders structured text as **styled documents** instead of raw
source. Open a supported file from the **Files** tree and, rather than a wall of
plain text, you get a formatted view — with a one-click toggle back to the source
whenever you want it.

## Supported formats

| Format | Rendered as |
| :-- | :-- |
| **Markdown** (`.md`) | A styled document — headings, tables, code blocks, task lists |
| **JSON** (`.json`) | A readable, structured view |
| **YAML** (`.yaml` / `.yml`) | A readable, structured view |
| **CSV** (`.csv`) | A table |
| **TOML** (`.toml`) | A readable, structured view |

Markdown documents also render:

- **Mermaid diagrams** — fenced ```mermaid blocks become real diagrams (drawn with
  `securityLevel: 'strict'`).
- **Math** — inline and block math.

Toggle back to the raw source at any time with a single click.

## Slide decks

A file named `*.slides.md` becomes a **Reveal.js presentation**:

- `---` on its own line starts a **new slide** (horizontal).
- `--` starts a **vertical** slide beneath the current one.
- The first `# Heading` becomes the deck title.

The deck is served locally and **live-reloads** when you save the file, so editing
in the Editor block re-renders the presentation instantly. From the deck you can
export the slides to a **self-contained HTML** file or to **JSON**.

The slide runtime binds to loopback only and requires a literal-loopback `Host`
header, so a deck is never reachable from the network.

## Exporting

Beyond the slide exports above, a rendered document can be exported to:

- **HTML** — a standalone file.
- **PDF** — printed from the rendered view (the print step runs with scripts
  disabled, so exporting is safe).
- **PNG** — a captured image of the view.

## Opening documents

Open a document from the **Files** tree to see the styled view. (Navigating to a
file by URL in the browser doesn't yet trigger the styled view — that path is
tracked for a future release.)

## Related

- [Getting Started](getting-started.md) — the Files block and the Dev Deck.
- [`PRD.md`](../PRD.md) — the full Document Studio scope and roadmap.
