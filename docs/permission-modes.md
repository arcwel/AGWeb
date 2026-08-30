# Permission Modes

WebDeck runs an autonomous agent with real filesystem and shell access, so a
**policy engine sits between the agent and anything irreversible**. Every agent
action of three kinds passes through the gate before it happens:

- **File writes** — creating or changing files in your workspace.
- **Commands** — running shell commands.
- **Browser navigation** — loading a URL in an agent-driven tab.

For each action the mode gives a verdict: **allow** (proceed silently), **confirm**
(pause and ask you, inline where the agent is working), or **deny** (refuse
outright). Every decision — automatic or human — is written to an audit log.

## The four modes

You pick the mode in the **Agent** block's policy controls. **Review** is the
default.

| Mode | File writes | Commands | Navigation (remote) | Navigation (local*) |
| :-- | :-- | :-- | :-- | :-- |
| **Secure** | Confirm | Confirm | Confirm | **Confirm** |
| **Review** *(default)* | **Allow** | Confirm | Confirm | Allow |
| **Agent** | **Allow** | **Allow** | Confirm† | Allow |
| **Custom** | *your rule* | *your rule* | *your rule* † | Allow |

\* **Local** targets are treated as safe development destinations in every mode
*except* Secure: `localhost`, `127.0.0.1`, `0.0.0.0`, `[::1]`, and inert schemes
(`data:`, `about:`, `file:`, `blob:`).

† In **Agent** and **Custom** mode, navigation to a host on your **allowlist** is
allowed; anything else falls back to Confirm (Agent) or your navigation rule
(Custom).

### Secure

The most cautious mode: **everything is confirmed**, including navigation to
localhost. Use it when you want to watch the agent's hand at every step.

### Review (default)

The everyday balance. The agent can **write files in your workspace freely** (the
edits still show as before/after diffs you can see), but **commands and navigation
to real websites pause for your approval**. Local dev servers load without asking.

### Agent

Autonomous inside your workspace and host allowlist. File writes and commands run
**without prompting**; only navigation to a site that isn't local or allowlisted
still asks. Use it when you trust the task and want to stay out of the loop.

### Custom

Set the verdict per action kind yourself — **Allow**, **Confirm**, or **Deny** for
each of file writes, commands, and navigation — plus an editable **host allowlist**
that overrides the navigation rule for hosts you name (a host matches itself and
its subdomains, e.g. `example.com` covers `api.example.com`).

## How confirmation works

When a mode says *Confirm*, a prompt appears **inline, exactly where the agent is
asking** — not a modal you have to hunt for. You can:

- **Allow** it once, or **Deny** it.
- Tick **don't ask again** to grant that action *kind* for the rest of the session.
  The grant is scoped to that one conversation and that one kind.

A **Deny** always wins: an explicit deny rule (or a denied prompt) outranks any
"don't ask again" grant.

## Tightening binds immediately

If you change the mode or edit your custom rules, any "don't ask again" grants you
gave under the old policy are **cleared on the spot**. A grant can never outlive
the rules it was made under.

## The audit log

Every gate decision is appended to `audit.jsonl` in the app's user-data directory,
including automatic allows, human confirmations, denials, and mode/rule changes —
each with a timestamp and the mode in force. It's an honest record of everything
the agent was allowed to do and why.

## Related

- [Agent Workflows](agent-workflows.md) — where these prompts appear during a run.
- [`SECURITY.md`](../SECURITY.md) — the full trust boundaries, the agent's limits,
  and residual risks.
