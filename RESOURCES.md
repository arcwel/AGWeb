# AGWeb — Techniques, Databases, Repos & Resources

Complete inventory of everything the project uses or plans to use, as of 2026-08-27. Companion to `PRD.md` and `TASKS.md`. All third-party code is MIT, BSD, or Apache 2.0 licensed — compatible with an MIT release of AGWeb.

---

## 1. Techniques & Architectural Patterns

### Application architecture

- **Electron multi-process model** — separate main, preload, and renderer processes; renderers run sandboxed with `contextIsolation: true` and `nodeIntegration: false`.
- **Typed IPC bridge** — a single preload script exposes a narrow, typed API surface (`window.agweb.*`) via `contextBridge`; every channel is defined in a shared TypeScript contract so main and renderer can't drift.
- **Single-instance lock + crash recovery** — `app.requestSingleInstanceLock()`, window-state persistence, and automatic renderer reload on `render-process-gone`.
- **Chromium embedding via `WebContentsView`** — real browser tabs (own process per tab) hosted inside the app shell, not iframes.
- **Cross-window messaging** — `postMessage`/Postmate handshake protocol between the host shell and embedded previews.

### Browser & preview techniques

- **Header-rewriting dev proxy** — local proxy strips `X-Frame-Options` and CSP `frame-ancestors` for development previews only, gated to allowlisted origins with a visible UI indicator.
- **Chrome DevTools Protocol (CDP)** — agent hooks for navigation, DOM events, form completion, screenshots (`Page.captureScreenshot`), and video via screencast frames.
- **Style isolation** — Shadow DOM and CSS Modules keep embedded previews and Document Studio themes from bleeding into the host UI.
- **Hot reload** — Vite HMR in development; file-watcher-driven preview refresh for user projects.

### Document Studio techniques

- **unified AST pipelines** — Markdown flows through remark (parse) → rehype (transform) plugins; extensions are pure plugins, not forks.
- **Allowlist sanitization** — `rehype-sanitize` on every rendered document; untrusted markdown/HTML can never execute script in the host (XSS defense).
- **Virtualized rendering** — windowed tree/list rendering so multi-MB JSON files and long documents stay responsive.
- **Format normalization** — YAML/TOML/XML/CSV parse to a common object model, then share the JSON tree and graph views.

### Agent & security techniques

- **Plan → approve → execute loop** — agents emit typed, structured plans (file edits, commands, tests) validated by the user before execution.
- **Capability-gated permission engine** — central policy gate for file writes, terminal exec, and navigation; four modes (Secure / Review-Driven / Agent-Driven / Custom) with domain allowlists and per-project scopes.
- **Append-only audit log** — every permission decision and agent action recorded.
- **Artifact capture** — terminal logs, diffs, screenshots, and recordings stored per task run as proof of work.

## 2. Databases & Storage

| Store | Technology | Used for |
| :-- | :-- | :-- |
| Embedded relational DB | SQLite via `better-sqlite3` | Agent tasks/plans, artifact index, audit log, workspace metadata |
| Settings store | `electron-store` (JSON in `userData`) | User preferences, themes, permission-mode config, recent projects |
| Artifact files | Filesystem under `userData/artifacts/` | Screenshots, recordings, terminal logs, diff files |
| Renderer-local state | `localStorage` / IndexedDB | Ephemeral UI state (open tabs, pane sizes) |

No external database server is required — AGWeb is fully local-first.

## 3. Repositories & Libraries

### Foundations

| Library | License | Repo | Role |
| :-- | :-- | :-- | :-- |
| Electron | MIT | <https://github.com/electron/electron> | Desktop runtime |
| Chromium | BSD-3 | <https://chromium.googlesource.com/chromium/src> | Browser engine (via Electron) |
| @codingame/monaco-vscode-api | MIT | <https://github.com/CodinGame/monaco-vscode-api> | **IDE base** — VS Code's own services (files, configuration, keybindings, theme, quick access, languages, TextMate, extensions) under our shell. Pinned 25.1.2 |
| @codingame/monaco-vscode-editor-api | MIT | <https://github.com/CodinGame/monaco-vscode-api> | npm alias for `monaco-editor`; same API over the VS Code service layer |
| @codingame/monaco-vscode-extension-api | MIT | <https://github.com/CodinGame/monaco-vscode-api> | npm alias for `vscode`, so extension-API imports resolve |
| Code - OSS / VSCodium | MIT | <https://github.com/microsoft/vscode> / <https://github.com/VSCodium/vscodium> | Reference only — **not** forked; see `IDE_FOUNDATION.md` for why |
| Monaco Editor | MIT | <https://github.com/microsoft/monaco-editor> | Editor component (supplied by the alias above) |
| React + React DOM | MIT | <https://github.com/facebook/react> | UI framework |
| TypeScript | Apache-2.0 | <https://github.com/microsoft/TypeScript> | Language/typings |
| Vite + electron-vite | MIT | <https://github.com/vitejs/vite> / <https://github.com/alex8088/electron-vite> | Build tooling / HMR |
| Tailwind CSS | MIT | <https://github.com/tailwindlabs/tailwindcss> | Styling |
| Zustand | MIT | <https://github.com/pmndrs/zustand> | Renderer state management |

### Language intelligence, source control & tasks (Phase 12)

| Library | License | Repo | Role |
| :-- | :-- | :-- | :-- |
| monaco-languageclient | MIT | <https://github.com/TypeFox/monaco-languageclient> | LSP client bridging VS Code's language services to our editor |
| vscode-languageclient | MIT | <https://github.com/microsoft/vscode-languageserver-node> | Protocol client (9.x — the version monaco-languageclient peers on) |
| vscode-jsonrpc | MIT | <https://github.com/microsoft/vscode-languageserver-node> | JSON-RPC framing; also the reader/writer base for our IPC transport |
| typescript-language-server | Apache-2.0 | <https://github.com/typescript-language-server/typescript-language-server> | TypeScript/JavaScript language server |
| TypeScript (runtime dep) | Apache-2.0 | <https://github.com/microsoft/TypeScript> | Ships as a **runtime** dependency: tsserver is what the language server drives |
| System `git` | GPL-2.0 (external binary) | <https://git-scm.com> | Source control. Invoked, never linked — what VS Code itself does |
| js-debug (`dapDebugServer`) | MIT | <https://github.com/microsoft/vscode-js-debug> | Debug adapter for Node/TypeScript and Chrome/Edge. Vendored at install from the GitHub release (pinned, checksummed) — not on npm, and the Open VSX vsix packages only the extension |
| @xterm/addon-search | MIT | <https://github.com/xtermjs/xterm.js> | Find-in-scrollback for terminals (0.16.0; 0.17 needs an xterm 6.1 beta) |

### Browser, IDE & terminal

| Library | License | Repo | Role |
| :-- | :-- | :-- | :-- |
| Postmate | MIT | <https://github.com/dollarshaveclub/postmate> | Cross-window comm |
| node-pty | MIT | <https://github.com/microsoft/node-pty> | PTY backend for terminal |
| @xterm/xterm | MIT | <https://github.com/xtermjs/xterm.js> | Terminal frontend |
| ripgrep | MIT/Unlicense | <https://github.com/BurntSushi/ripgrep> | Project-wide search |
| playwright-core | Apache-2.0 | <https://github.com/microsoft/playwright> | Agent browser automation over CDP |

### Document Studio

| Library | License | Repo | Role |
| :-- | :-- | :-- | :-- |
| react-markdown (remark/rehype) | MIT | <https://github.com/remarkjs/react-markdown> | Markdown rendering |
| remark-gfm | MIT | <https://github.com/remarkjs/remark-gfm> | GitHub-flavored markdown |
| rehype-sanitize | MIT | <https://github.com/rehypejs/rehype-sanitize> | XSS sanitization |
| @uiw/react-markdown-preview | MIT | <https://github.com/uiwjs/react-markdown-preview> | GitHub-style base CSS, dark mode |
| Shiki | MIT | <https://github.com/shikijs/shiki> | Code-block highlighting |
| Mermaid | MIT | <https://github.com/mermaid-js/mermaid> | Diagrams in markdown |
| KaTeX | MIT | <https://github.com/KaTeX/KaTeX> | Math rendering |
| @uiw/react-json-view | MIT | <https://github.com/uiwjs/react-json-view> | JSON tree inspector |
| JSON Crack | Apache-2.0 | <https://github.com/AykutSarac/jsoncrack.com> | Node-graph visualization engine |
| React Flow (xyflow) | MIT | <https://github.com/xyflow/xyflow> | Graph-view fallback if we build our own |
| PapaParse | MIT | <https://github.com/mholt/PapaParse> | CSV/TSV parsing |
| js-yaml | MIT | <https://github.com/nodeca/js-yaml> | YAML parsing |
| smol-toml | BSD-3 | <https://github.com/squirrelchat/smol-toml> | TOML parsing |
| fast-xml-parser | MIT | <https://github.com/NaturalIntelligence/fast-xml-parser> | XML parsing |
| Reveal.js | MIT | <https://github.com/hakimel/reveal.js> | Presentation engine |

### Storage & platform

| Library | License | Repo | Role |
| :-- | :-- | :-- | :-- |
| better-sqlite3 | MIT | <https://github.com/WiseLibs/better-sqlite3> | Embedded SQLite |
| electron-store | MIT | <https://github.com/sindresorhus/electron-store> | Settings persistence |
| electron-builder | MIT | <https://github.com/electron-userland/electron-builder> | Packaging/signing/auto-update |

### Dev tooling & QA

| Tool | License | Repo | Role |
| :-- | :-- | :-- | :-- |
| ESLint + typescript-eslint | MIT | <https://github.com/eslint/eslint> | Linting |
| Prettier | MIT | <https://github.com/prettier/prettier> | Formatting |
| Vitest | MIT | <https://github.com/vitest-dev/vitest> | Unit tests |
| Playwright | Apache-2.0 | <https://github.com/microsoft/playwright> | E2E tests |
| Python 3 + ruff + pytest | PSF / MIT | <https://www.python.org> / <https://github.com/astral-sh/ruff> | Backend tooling & agent services |

## 4. Documentation & Reference Resources

- Electron docs & security checklist — <https://www.electronjs.org/docs/latest/tutorial/security>
- Electron `WebContentsView` guide — <https://www.electronjs.org/docs/latest/api/web-contents-view>
- Chrome DevTools Protocol reference — <https://chromedevtools.github.io/devtools-protocol/>
- Chromium design docs — <https://www.chromium.org/developers/design-documents/>
- VS Code source & extension architecture — <https://github.com/microsoft/vscode/wiki>
- Monaco Editor playground/docs — <https://microsoft.github.io/monaco-editor/>
- unified/remark/rehype ecosystem docs — <https://unifiedjs.com/learn/>
- Reveal.js docs — <https://revealjs.com/>
- Tailwind CSS docs — <https://tailwindcss.com/docs>
- React docs — <https://react.dev/>
- OWASP XSS Prevention Cheat Sheet — <https://cheatsheetseries.owasp.org/cheatsheets/Cross_Site_Scripting_Prevention_Cheat_Sheet.html>
- electron-builder docs — <https://www.electron.build/>
