# IDE Foundation — decision needed

## The deviation

`PRD.md` line 15 specifies the foundation explicitly:

| **IDE Base** | Code - OSS (VSCodium) | <https://vscodium.com> / <https://github.com/microsoft/vscode> |
| **Code Editor Component** | Monaco Editor | <https://microsoft.github.io/monaco-editor> |

Two separate rows: **Code - OSS as the IDE base**, Monaco as the editor _component_
inside it. Line 7 repeats it — "built on open-source foundations (Code - OSS,
Electron, Chromium)".

What was built takes only the second row. AGWeb today is a hand-rolled IDE shell
around Monaco. It does reuse VS Code's components where they were obvious —
Monaco (editor), xterm.js (terminal), ripgrep (search), node-pty (shell) — but
everything the workbench would have given us for free was written by hand or is
simply missing:

| Capability                                       | VS Code / Code - OSS         | AGWeb today                 |
| ------------------------------------------------ | ---------------------------- | --------------------------- |
| Editing, syntax, diff                            | Monaco                       | ✅ Monaco                   |
| Terminal                                         | xterm.js + pty               | ✅ same                     |
| Project search                                   | ripgrep                      | ✅ same                     |
| **IntelliSense, go-to-def, rename, diagnostics** | LSP + built-in servers       | ❌ Monaco's bundled TS only |
| **Debugging (breakpoints, step, variables)**     | DAP + debug UI               | ❌ none                     |
| **Extensions**                                   | extension host + marketplace | ❌ none for the IDE         |
| **Source control (diff, stage, commit, blame)**  | SCM provider UI              | ❌ none                     |
| **Settings, keybindings, themes, profiles**      | config service               | ❌ ad-hoc                   |
| **Tasks / problem matchers**                     | task runner                  | ❌ none                     |
| **Notebooks, testing UI, remote**                | built in                     | ❌ none                     |

This should have been raised when Phase 3 ("IDE Core") was scoped — the task list
described building an editor, files tree and terminal from parts, which silently
replaced the PRD's foundation choice. It was not flagged. That is the gap.

## The constraint that makes this non-obvious

AGWeb is **browser-first**: `DESIGN.md` principle 1 is "the browser is the
product", with the IDE as a summonable deck of independent blocks. VS Code's
workbench assumes the opposite — it owns the window, and its layout is the app.

So "just use Code - OSS" is not a drop-in. The foundation question is really:
_how do we get VS Code's capabilities without inheriting VS Code's shell?_

## The three real paths

### Path A — VS Code services on our own shell (`@codingame/monaco-vscode-api`)

Ship VS Code's actual service layer (files, configuration, keybindings, themes,
quick-pick, notifications, LSP, debug, SCM) as npm packages layered over Monaco,
keeping AGWeb's shell and block system. The same approach Gitpod Flex uses. It
also provides a **real VS Code extension host**, so extensions can be adopted
later without another migration.

- Adopted at **25.1.2**, MIT — not the 36.2.5 latest this document first recorded.
  `monaco-languageclient` 10.7.0 (the LSP client, task 12.2) peers on
  `@codingame/monaco-vscode-api@^25.1.2` and `vscode-languageclient@~9.0.1`, so
  36.x and the language client cannot both be satisfied. The whole family is
  pinned to 25.1.2 for that reason; revisit when the language client moves.
- `monaco-editor` and `vscode` are npm aliases to
  `@codingame/monaco-vscode-editor-api` / `-extension-api` at the same version.
  Aliasing rather than rewriting call sites is what let every existing
  `import { monaco } from '@/monaco'` keep working unchanged.
- **Keeps** the Glass design, the deck, the agent-first layout, all Phase 1–9 work.
- **Incremental** — adopt service by service, each shippable on its own.
- Cost: pinned to their release cadence; not every workbench feature is exposed;
  the extension host needs a worker/process story of our own.

### Path B — Rebuild the shell on Eclipse Theia

Theia is a framework _for building custom IDEs_ (not a VS Code fork). VS Code
extension compatible via Open VSX; Electron desktop supported; proven in shipped
products (Samsung Sokatoa, STMicroelectronics STM32CubeMX2, Google Cloud Shell).

- **Most complete** capability story with the least hand-rolling.
- Cost: the renderer is rewritten around Theia's DI/widget system. The Glass
  design and block model would have to be re-implemented inside it. Main-process
  work (agents, policy, browser, slides, dev servers) survives; the shell does not.
- License EPL-2.0 (weaker copyleft than GPL, fine for a product, but a change).

### Path C — Fork Code - OSS, or embed openvscode-server

The literal PRD reading. `microsoft/vscode` source is MIT (the _branded binary_
is proprietary; a fork must use Open VSX, not Microsoft's marketplace).

- Fork: everything works, but you fight the workbench forever to be browser-first,
  and carry a rebase treadmill on a ~2M-line codebase.
- Embed `openvscode-server` in a `WebContentsView`: fastest route to "all
  features", but the IDE becomes a web app in a tab — the deck, the block model
  and the agent-as-peer design all die. **This kills the design just approved.**

## Recommendation

**Path A**, with Path B as the fallback if full extension-marketplace and
debugger parity becomes non-negotiable sooner than expected.

Reasoning: it is the only path that both closes the PRD gap _and_ preserves the
browser-first design settled this week. It is incremental — LSP alone (task 12.2)
removes the single biggest capability gap and is independently shippable. Path C
is rejected because the design and the VS Code shell cannot both survive.

**This is a product decision, not a technical one, and it is yours to make.**
Path B costs a shell rewrite; Path A accepts that a few workbench features stay
out of reach. Phase 12 below is written for Path A and needs re-scoping if you
pick B.

## Sources

- [microsoft/vscode](https://github.com/microsoft/vscode) · [VSCodium](https://vscodium.com)
- [openvscode-server](https://github.com/gitpod-io/openvscode-server) · [code-server FAQ](https://coder.com/docs/code-server/FAQ)
- [Open VSX registry](https://github.com/eclipse-openvsx/openvsx) · [Eclipse Open VSX announcement](https://newsroom.eclipse.org/news/community-news/eclipse-open-vsx-free-marketplace-vs-code-extensions/)
- [Choosing Theia or Code OSS](https://newsroom.eclipse.org/eclipse-newsletter/2023/october/choosing-eclipse-theia-or-code-oss-custom-tools-or-ides) · [Theia in production, 2026](https://newsroom.eclipse.org/eclipse-newsletter/2026/march/eclipse-theia-eclipse-foundation-tool-platform-production) · [Theia vs Code OSS](https://eclipsesource.com/blogs/2023/09/08/eclipse-theia-vs-code-oss/)
