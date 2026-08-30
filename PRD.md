# Product Requirements Document: Agent-First Universal IDE & Browser (AGWeb)

> Source: [Google Doc PRD](https://docs.google.com/document/d/1pCAo4R_vbRcJ5uXrgp8Th4UGSBbCL3lFAPpqYj4wQ64/edit?usp=drivesdk), imported 2026-08-27.

## 1. Executive Summary & Architecture Overview

This platform is a unified, agent-first desktop workspace that merges an autonomous AI development environment with a native, unrestricted Chromium web browser. Built on open-source foundations (VS Code's service layer, Electron, Chromium), the platform functions as a "Mission Control" where users and autonomous agents can create, inspect, execute, and verify web applications, interactive slides, and complex workflows.

## 2. Core Dependencies & Source Repositories

| Component                 | Library / Framework                               | Official URL                                                   |
| :------------------------ | :------------------------------------------------ | :------------------------------------------------------------- |
| **Desktop Runtime**       | Electron                                          | <https://www.electronjs.org>                                   |
| **Core Browser Engine**   | Chromium Project                                  | <https://www.chromium.org>                                     |
| **IDE Base**              | VS Code service layer via `@codingame/monaco-vscode-api` (MIT, pinned 25.1.2) | <https://github.com/CodinGame/monaco-vscode-api> |
| **Code Editor Component** | Monaco Editor — npm-aliased to `@codingame/monaco-vscode-editor-api` | <https://microsoft.github.io/monaco-editor>      |
| **Language Intelligence** | LSP: `monaco-languageclient` + `vscode-languageclient` (MIT) | <https://github.com/TypeFox/monaco-languageclient>    |
| **Source Control**        | System `git`                                      | <https://git-scm.com>                                          |
| **Frontend Framework**    | React                                             | <https://react.dev>                                            |
| **Language & Typings**    | TypeScript                                        | <https://www.typescriptlang.org>                               |
| **Presentation Engine**   | Reveal.js                                         | <https://revealjs.com>                                         |
| **Styling Framework**     | Tailwind CSS                                      | <https://tailwindcss.com>                                      |
| **Cross-Window Comm**     | Postmate / PostMessage API                        | <https://github.com/dollarshaveclub/postmate>                  |
| **Markdown Rendering**    | react-markdown (remark/rehype)                    | <https://github.com/remarkjs/react-markdown>                   |
| **Markdown Styling**      | @uiw/react-markdown-preview / github-markdown-css | <https://github.com/uiwjs/react-markdown-preview>              |
| **Code Highlighting**     | Shiki                                             | <https://shiki.style>                                          |
| **Diagrams**              | Mermaid                                           | <https://mermaid.js.org>                                       |
| **JSON Tree View**        | @uiw/react-json-view                              | <https://github.com/uiwjs/react-json-view>                     |
| **Data Graph View**       | JSON Crack (Apache 2.0)                           | <https://github.com/AykutSarac/jsoncrack.com>                  |
| **CSV Parsing**           | PapaParse                                         | <https://www.papaparse.com>                                    |


**Foundation note (task 12.9).** This table originally named Code - OSS
(VSCodium) as the IDE Base alongside Monaco as the editor component, and the
build adopted only Monaco. That gap — no language intelligence, debugging,
source control, settings or extensions — is what Phase 12 exists to close.

The foundation actually chosen is VS Code's own service layer as npm packages
(`@codingame/monaco-vscode-api`, MIT) running under AGWeb's shell, rather than
a fork of Code - OSS. Forking was rejected because the VS Code workbench and
the browser-first Dev Deck cannot both own the window; the service layer gives
the same capabilities while the shell, the deck and the agent-first layout
survive. `IDE_FOUNDATION.md` records the alternatives and the reasoning.

The whole `@codingame/*` family is pinned to 25.1.2 rather than the latest,
because `monaco-languageclient` — the LSP client — peers on `^25.1.2`, and the
two cannot both be satisfied at 36.x.

Python was removed from this table: task 0.6 closed it as not needed once the
agent runtime shipped in TypeScript and the embed proxy became a header
rewrite. No Python component exists in the build.

## 3. Key Features & Functional Requirements

### Mission Control & Agent Orchestration

- **Multi-Agent Coordination:** Concurrently spawn, monitor, and manage autonomous agents across different project directories.
- **Dynamic Task Planning:** Agents generate structured execution plans for user validation before executing filesystem changes or terminal commands.
- **Artifact Generation:** Autonomous production of tangible proofs of work, including terminal logs, code diffs, screenshot captures, and browser video recordings.

### Universal Web Browser & Sandbox Execution

- **Full Chromium Capabilities:** Integrated browser tab supporting full extensions, standard navigation, DevTools, and native rendering.
- **Zero-Friction Embedding:** Integrated proxy layer to strip frame-busting headers (X-Frame-Options, strict CSPs) and resolve cross-origin issues for development previews.
- **Autonomous Browser Control:** Direct agent hooks to navigate pages, complete forms, trigger DOM events, and validate UI responsiveness.

### Document Studio — Stylized Rendering of Structured Files

A standout browser-integrated design tool that turns raw JSON, Markdown, and similar structured files into human-readable, stylized documents.

- **In-Browser File Rendering:** Opening a `.md`, `.json`, `.yaml`/`.yml`, `.csv`/`.tsv`, or `.toml` file — from the Files tree or by navigating the browser to its `file:` URL — renders a styled document view instead of raw text, with one-click toggle back to source (Monaco).
- **Markdown Studio:** GitHub-flavored rendering with theme presets, Shiki syntax-highlighted code blocks, Mermaid diagrams, math (KaTeX), and dark/light modes; sanitized rendering pipeline for untrusted content.
- **JSON/Data Studio:** Collapsible tree inspector with search, type badges, and path copying.
- **Style & Theming Controls:** User-selectable document themes (typography, spacing, palette) applied live; custom themes savable per workspace.
- **Export:** Render a styled Markdown view to standalone HTML or PDF, or capture it as a PNG, for sharing.
- **Build Strategy:** Own thin viewer shell (file-type detection, theming, layout, export) composed from mature open-source rendering primitives (react-markdown/remark, Shiki, Mermaid, @uiw/react-json-view, PapaParse) — no third-party app embedding.
- **Roadmap (deferred to a future release):** `.xml` rendering; an interactive node-graph visualization (JSON Crack-style, Apache-2.0) for JSON/YAML/XML/CSV; format conversion between structured types; and styled export for the non-Markdown doc types.

### Integrated Development Environment (IDE)

- **Code & Schema Editing:** Native code editing with full syntax highlighting, IntelliSense, and formatters for JSON, HTML, CSS, JavaScript, and Python.
- **Live Preview & Slide Runtime:** Direct embedding of Reveal.js decks and custom web apps with hot-reloading and isolated styling (CSS Modules/Shadow DOM).

#### Workspace file access

Both the user and the agent operate on real local files. The full set is
required — not a read-mostly subset:

- **Read, write, create, rename/move, delete** for files and directories, for
  the user through the Files tree and Editor, and for the agent through
  policy-gated tools. The agent's tool surface must cover the same operations
  the user has; anything missing pushes the agent to shell out to `rm`/`mv`,
  which bypasses workspace scoping and is strictly worse.
- **Workspace roots model:** a session may have more than one root (working
  across two repositories is a normal case). Every root is granted explicitly
  and every path resolves against one of them; paths outside all roots are
  refused. Single-root is the default; multi-root does not mean unrestricted
  filesystem access.
- **Large files:** reading is capped for editor safety, but the cap must be
  raised or streamed rather than making a file unopenable.
- **Binary files:** writing non-text artifacts (images, recordings) is a
  first-class operation, not a special case for screenshots.

#### Terminal execution

- **Interactive terminals:** real pty sessions the user drives, surviving
  layout changes with scrollback intact.
- **Agent commands run in the user's terminal.** An agent command must be able
  to attach to a visible terminal session so its output is watched live rather
  than hidden in a log, and must support **long-running processes** — starting
  a dev server, a watcher or a REPL cannot be killed by a short one-shot
  timeout. One-shot capture stays available for quick commands.
- Every agent command passes the permission policy engine (section 5) before it
  runs, whichever mode it runs in.

## 4. User Interaction Flows

### Autonomous Task Execution & Browser Verification

1. User provides a prompt or feature request via the Mission Control interface.
2. The agent generates a step-by-step task list detailing file edits and testing steps.
3. Upon user approval, the agent applies the code modifications.
4. The agent boots the local development server and navigates the internal Chromium browser to verify UI interactions.
5. An execution report containing screenshots and screen recordings is delivered to the user for review.

### Manual Web Browsing & Slide Development

1. User accesses the unified browser view to interact with external sites or local apps without IDE overhead.
2. User opens the integrated presentation editor to draft slides using Reveal.js templates.
3. Changes render instantly in a synchronized preview pane.
4. Projects can be exported directly as standalone JSON structures or bundled HTML/JS packages.

## 5. Security & Permission Modes

- **Secure Mode:** Read-only system access; every file edit, terminal execution, and outbound network request requires explicit manual confirmation.
- **Review-Driven Mode:** Filesystem writes within workspace bounds are auto-approved; terminal commands and external browser navigations require confirmation.
- **Agent-Driven Mode:** Autonomous execution within pre-configured domain allowlists and designated project directories.
- **Custom Mode:** User-defined rules governing shell permissions, URL access, and agent capability scopes.
