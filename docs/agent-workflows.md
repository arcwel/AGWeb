# Agent Workflows

The agent lives in the **Agent** block and works in a loop you can see the whole
way through: it **plans**, you **approve** (or edit, or reject), it **executes**,
and it **verifies** — running commands in live terminals, editing files with
diffs, and driving real browser tabs you can watch.

## Give it a task

Type your task into the composer at the bottom of the Agent block. The composer has
what you'd expect from a modern assistant:

- **Attachments** — drop in files for context.
- **`@mention`** — pull in a workspace file by name.
- **`/` commands** — quick actions.
- **Voice input** — dictate the task.
- **Model picker** — choose the model for this run (Anthropic by default; OpenAI
  and Gemini work once their keys are set in **Settings → AI**).

## Review the plan before anything happens

The agent **plans first**, and the plan is **editable before you approve it**. Each
step has a kind (edit, command, inspect, verify). You can:

- **Edit** the steps — reword, reorder, add, or remove them while the plan awaits
  approval.
- **Approve** — the agent starts executing.
- **Reject** — the plan is discarded and nothing runs.

Nothing touches your files, shell, or the network until you approve.

## Watch it work

Once approved, execution is transparent:

- **Commands run in live terminals inside the conversation** — you see the output
  stream as it happens.
- **File edits come with before/after diffs**, so every change is reviewable.
- **Browser actions drive real tabs** you can see — the agent opens pages, clicks,
  types, reads the DOM, and captures screenshot evidence as part of its own
  verification loop.

Throughout, the [permission gate](permission-modes.md) decides what proceeds
silently and what pauses to ask you — and its prompts appear **inline, right where
the agent is asking**.

You can **Stop** a run at any time.

## Manage the conversation

Conversations aren't disposable:

- **Rename** a session to keep your history legible.
- **Branch** from any turn to explore a different direction without losing the
  original thread.
- **Edit and resend** — hand a turn back to the composer, change it, and run again.
- **Resume** a session that was interrupted mid-run.
- **Export** the conversation (Markdown or JSON).

## Reports and artifacts

Each run produces **artifacts** — the screenshots, recordings, and files it created
— and a **report** you can open summarizing what it did. These are kept per session
so you can go back to the evidence later.

## Keys and providers

The agent needs an API key. Add one in **Settings → AI**, where it's encrypted into
the OS keychain via `safeStorage` — never plaintext, never exposed to the page — or
set `ANTHROPIC_API_KEY` in the environment before launching. Keys for OpenAI and
Gemini are stored the same way, and you switch models per run with the composer's
model picker.

## Related

- [Permission Modes](permission-modes.md) — control how much the agent can do
  without asking.
- [Getting Started](getting-started.md) — first-run setup and the Dev Deck.
