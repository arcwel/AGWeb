// Launches the built app against a throwaway workspace and drives the whole
// shell: browser, Deck reveal, Files→Editor→save-to-disk, live terminal,
// presets, drag-to-stack, rail, float window, detached deck window.
// Usage: node scripts/smoke.mjs [screenshot.png]   (run under xvfb on CI)
import { _electron as electron } from 'playwright-core'
import { execFileSync } from 'node:child_process'
import { existsSync, mkdtempSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { createServer } from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const screenshotPath = process.argv[2] ?? 'smoke.png'

// Throwaway workspace + user data so runs are deterministic and never touch
// real projects or accumulated layout state.
const workspace = mkdtempSync(join(tmpdir(), 'agweb-ws-'))
writeFileSync(
  join(workspace, 'hello.md'),
  [
    '# Hello Studio',
    '',
    'hello agweb',
    '',
    '- [x] tasks render',
    '',
    '| col | value |',
    '| --- | ----- |',
    '| one | 1 |',
    '',
    '```js',
    'const greeting = "hi"',
    '```',
    '',
    'Euler: $e^{i\\pi} + 1 = 0$',
    '',
    '```mermaid',
    'graph LR',
    '  A[Browser] --> B[Deck]',
    '```',
    ''
  ].join('\n')
)
writeFileSync(join(workspace, 'data.json'), '{"name":"agweb","tags":["ide","browser"]}\n')
writeFileSync(join(workspace, 'table.csv'), 'city,pop\nTokyo,37\nDelhi,32\n')
mkdirSync(join(workspace, 'src'))
writeFileSync(join(workspace, 'src', 'index.ts'), 'export const answer = 42\n')
writeFileSync(join(workspace, 'src', 'messy.ts'), 'const messy={alpha:1,beta:2}\n')
// A deliberate type error: the language server (12.2) is the only thing in the
// app that can find it, so a squiggle here proves real LSP diagnostics arrived.
writeFileSync(join(workspace, 'src', 'broken.ts'), 'export const wrong: number = "a string"\n')
// Preview fixtures: a dev script the manager can detect + run, and an
// index.html the built-in static server can pick up directly.
writeFileSync(
  join(workspace, 'package.json'),
  JSON.stringify({
    name: 'smoke-ws',
    private: true,
    scripts: {
      dev: 'node server.mjs',
      // Runs a script that prints one line in tsc's shape. Deliberately a
      // separate file rather than an inline printf: the pty echoes the command
      // it runs, so a diagnostic-shaped string inside the command itself would
      // be parsed as a problem and the test would pass for the wrong reason.
      typecheck: 'node problems.mjs'
    }
  })
)
writeFileSync(
  join(workspace, 'server.mjs'),
  [
    "import { createServer } from 'node:http'",
    "import { readFileSync } from 'node:fs'",
    'const s = createServer((req, res) => {',
    "  res.writeHead(200, { 'content-type': 'text/html', 'cache-control': 'no-store' })",
    "  res.end(readFileSync(new URL('./index.html', import.meta.url)))",
    '})',
    "s.listen(0, '127.0.0.1', () => console.log('Local: http://127.0.0.1:' + s.address().port + '/'))",
    ''
  ].join('\n')
)
writeFileSync(join(workspace, 'index.html'), '<title>preview page</title><h1>preview-live</h1>')
// Debuggee for 12.4: a function with a local worth inspecting on line 2.
writeFileSync(
  join(workspace, 'debuggee.js'),
  [
    'function compute(a, b) {',
    '  const total = a + b',
    '  return total',
    '}',
    'compute(2, 3)',
    ''
  ].join('\n')
)
// Stands in for a compiler: prints one tsc-shaped diagnostic and fails.
writeFileSync(
  join(workspace, 'problems.mjs'),
  [
    "console.log('src/index.ts(1,14): error TS2322: Type not assignable.')",
    'process.exit(2)',
    ''
  ].join('\n')
)
writeFileSync(
  join(workspace, 'pitch.slides.md'),
  '# Slide One\n\nhello deck\n\n---\n\n# Slide Two\n\n- a point\n'
)

// Source control fixture (12.3): a real repo with one commit, so the Source
// Control block has history to diff against and something to stage.
const git = (...args) =>
  execFileSync('git', args, {
    cwd: workspace,
    stdio: 'pipe',
    env: { ...process.env, GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_SYSTEM: '/dev/null' }
  })
git('init', '--initial-branch=main')
git('config', 'user.email', 'smoke@agweb.test')
git('config', 'user.name', 'Smoke')
git('config', 'commit.gpgsign', 'false')
git('add', '-A')
git('commit', '-m', 'initial')
// An uncommitted change for the block to show.
writeFileSync(join(workspace, 'data.json'), '{"name":"agweb","tags":["ide","browser","scm"]}\n')

// Unpacked MV3 extension fixture: its content script tags page titles so the
// tab strip proves it ran inside the browser session.
const extDir = mkdtempSync(join(tmpdir(), 'agweb-ext-'))
writeFileSync(
  join(extDir, 'manifest.json'),
  JSON.stringify({
    manifest_version: 3,
    name: 'Smoke Extension',
    version: '1.0.0',
    content_scripts: [
      { matches: ['http://127.0.0.1/*'], js: ['content.js'], run_at: 'document_end' }
    ]
  })
)
writeFileSync(join(extDir, 'content.js'), "document.title = 'EXT:' + document.title\n")

// Local dev server for the browser-feature checks: a frame-busting page, a
// same-origin host that reports whether framing worked via its title, an
// attachment download, and a page that requests a web permission.
const server = createServer((req, res) => {
  if (req.url === '/framed') {
    res.writeHead(200, { 'content-type': 'text/html', 'x-frame-options': 'DENY' })
    res.end('<title>framed</title><p>framed-content</p>')
  } else if (req.url === '/host') {
    res.writeHead(200, { 'content-type': 'text/html' })
    res.end(`<title>host-loading</title><iframe id="f" src="/framed"></iframe><script>
      const f = document.getElementById('f')
      f.addEventListener('load', () => {
        try {
          const text = f.contentDocument.body.textContent
          document.title = text.includes('framed-content') ? 'frame-ok' : 'frame-blocked'
        } catch { document.title = 'frame-blocked' }
      })
      setTimeout(() => { if (document.title === 'host-loading') document.title = 'frame-blocked' }, 4000)
    </script>`)
  } else if (req.url === '/dl') {
    res.writeHead(200, {
      'content-type': 'application/octet-stream',
      'content-disposition': 'attachment; filename="smoke-download.bin"'
    })
    res.end('download-payload')
  } else if (req.url === '/perm') {
    res.writeHead(200, { 'content-type': 'text/html' })
    res.end(`<title>perm-page</title><script>
      navigator.geolocation.getCurrentPosition(
        () => { document.title = 'geo-granted' },
        (err) => { document.title = err.code === 1 ? 'geo-denied' : 'geo-granted' },
        { timeout: 8000 }
      )
    </script>`)
  } else {
    res.writeHead(404)
    res.end()
  }
})
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
const devOrigin = `http://127.0.0.1:${server.address().port}`

const downloadDir = join(workspace, '_downloads')
mkdirSync(downloadDir)

// A second folder the session can be granted (3B.4), plus a file outside every
// root that must stay unreachable however the path is spelled.
const extraRoot = mkdtempSync(join(tmpdir(), 'agweb-extra-'))
writeFileSync(join(extraRoot, 'granted.txt'), 'from the granted folder\n')
const forbidden = mkdtempSync(join(tmpdir(), 'agweb-forbidden-'))
writeFileSync(join(forbidden, 'secret.txt'), 'must never be readable\n')

const userData = mkdtempSync(join(tmpdir(), 'agweb-data-'))
const app = await electron.launch({
  args: ['out/main/index.js', '--no-sandbox'],
  cwd: new URL('..', import.meta.url).pathname,
  env: {
    ...process.env,
    AGWEB_WORKSPACE: workspace,
    AGWEB_USER_DATA: userData,
    AGWEB_DOWNLOAD_DIR: downloadDir,
    AGWEB_EXTRA_ROOTS: extraRoot,
    // Deterministic offline agent provider: same plan/approve/execute flow,
    // no API key or network.
    AGWEB_AGENT_MOCK: '1'
  }
})

try {
  const window = await app.firstWindow()

  // Browser-first default: start page, then navigate via the address bar and
  // verify the page title round-trips Chromium → main → tab strip.
  await window.waitForSelector('text=WebDeck', { timeout: 15000 })
  const dataUrl = 'data:text/html,<title>Smoke Page</title><h1>ok</h1>'
  await window.fill('input[placeholder="Enter URL or search…"]', dataUrl)
  await window.press('input[placeholder="Enter URL or search…"]', 'Enter')
  await window.waitForSelector('text=Smoke Page', { timeout: 15000 })

  const strip = (text) => `[data-testid="tab-strip"] >> text=${text}`
  const goTo = async (url) => {
    await window.fill('input[placeholder="Enter URL or search…"]', url)
    await window.press('input[placeholder="Enter URL or search…"]', 'Enter')
  }

  // Address bar (P1-13): a bare localhost host must go to http, not https —
  // typing the dev-server address is the app's most common navigation.
  await goTo(`127.0.0.1:${server.address().port}/framed`)
  await window.waitForSelector(strip('framed'), { timeout: 15000 })

  // Embed proxy (2.5/2.6): a frame-busting page blocks embedding by default;
  // with the proxy on, the same host page frames it successfully. The host
  // page reports the outcome through its title → the tab strip.
  await goTo(`${devOrigin}/host`)
  await window.waitForSelector(strip('frame-blocked'), { timeout: 15000 })
  // The standalone Web menu folded into the browser menu when the chrome
  // became a single row.
  await window.click('[data-testid="browser-menu"]')
  await window.click('button[aria-label="Toggle embed proxy"]')
  // Escape dismisses popovers (P2-10); the overlay guard also un-hides the
  // native view that was hidden while the menu was open (P1-12).
  await window.keyboard.press('Escape')
  await window.waitForSelector('button[aria-label="Toggle embed proxy"]', {
    state: 'hidden',
    timeout: 5000
  })
  await window.waitForSelector('[data-testid="proxy-indicator"]', { timeout: 5000 })
  await window.click('button[aria-label="Reload"]')
  await window.waitForSelector(strip('frame-ok'), { timeout: 15000 })

  // Downloads (2.7): an attachment lands in the download dir with a progress
  // pill in the toolbar; Clear finished empties the list again.
  await goTo(`${devOrigin}/dl`)
  await waitFor(
    () => readFileSync(join(downloadDir, 'smoke-download.bin'), 'utf8') === 'download-payload',
    15000,
    'download did not reach disk'
  )
  await window.click('[data-testid="downloads-indicator"]')
  await window.waitForSelector('text=smoke-download.bin', { timeout: 5000 })
  await window.click('button:has-text("Clear finished")')
  await window.waitForSelector('[data-testid="downloads-indicator"]', {
    state: 'detached',
    timeout: 5000
  })

  // Permission prompts (2.7): geolocation pauses on the shell's banner; Allow
  // resolves it (macOS has no position source, so any non-denied error counts).
  await goTo(`${devOrigin}/perm`)
  await window.waitForSelector('[data-testid="permission-prompt"]', { timeout: 15000 })
  await window.waitForSelector(`text=${devOrigin}`)
  await window.click('[data-testid="permission-allow"]')
  await window.waitForSelector(strip('geo-granted'), { timeout: 15000 })

  // Extensions (2.4): load the unpacked MV3 fixture; its content script tags
  // titles of pages on the dev origin.
  const loaded = await window.evaluate((path) => window.agweb.extensions.loadPath(path), extDir)
  if (!loaded.extension) throw new Error(`extension failed to load: ${loaded.error}`)
  await goTo(`${devOrigin}/framed`)
  await window.waitForSelector(strip('EXT:framed'), { timeout: 15000 })

  // Back to the original page so later steps see the expected tab title.
  await goTo(dataUrl)
  await window.waitForSelector(strip('Smoke Page'), { timeout: 15000 })

  // Reveal the Dev Deck.
  await window.keyboard.press('ControlOrMeta+d')
  await window.waitForSelector('.workspace.revealed', { timeout: 5000 })

  // Files tree → editor: open a source file, verify, edit, save, check disk.
  await window.waitForSelector('text=src', { timeout: 10000 })
  await window.click('text=src')
  await window.waitForSelector('text=index.ts')
  await window.click('text=index.ts')
  await window.waitForSelector('.monaco-editor', { timeout: 15000 })
  await window.waitForSelector('text=answer', { timeout: 15000 })
  await window.click('.monaco-editor .view-lines')
  await window.keyboard.press('ControlOrMeta+End')
  await window.keyboard.type('// smoke-edit')
  await window.keyboard.press('ControlOrMeta+s')
  await waitFor(
    () => readFileSync(join(workspace, 'src', 'index.ts'), 'utf8').includes('smoke-edit'),
    10000,
    'file save did not reach disk'
  )

  // Terminal: run a real command through the pty and see its output.
  await window.waitForSelector('.xterm', { timeout: 15000 })
  await window.click('.xterm')
  await window.keyboard.type('echo smoke-$((40+2))')
  await window.keyboard.press('Enter')
  await window.waitForSelector('text=smoke-42', { timeout: 15000 })

  // Formatter: Prettier normalizes messy.ts; save; verify on disk. Prettier's
  // chunks load lazily, so retry the format→save cycle until disk shows it.
  await window.click('text=messy.ts')
  await window.waitForSelector('text=messy', { timeout: 15000 })
  await waitForAsync(
    async () => {
      await window.click('button:has-text("Format")')
      await window.waitForTimeout(800)
      await window.click('.monaco-editor .view-lines')
      await window.keyboard.press('ControlOrMeta+s')
      await window.waitForTimeout(300)
      return readFileSync(join(workspace, 'src', 'messy.ts'), 'utf8').includes('alpha: 1')
    },
    20000,
    'formatted content did not reach disk'
  )

  // Language server (12.2): tsserver reports the deliberate type error in
  // broken.ts, and it renders as an error squiggle in the editor. Given a
  // generous budget because the server has to start and index on first open.
  await window.click('text=broken.ts')
  await waitForAsync(
    async () =>
      (await window.evaluate(
        () => document.querySelectorAll('.monaco-editor .squiggly-error').length
      )) > 0,
    60000,
    'no LSP diagnostics reached the editor for src/broken.ts'
  )
  await window.click('text=messy.ts')

  // Editor completeness (12.7): the View menu writes real VS Code settings, so
  // toggling the minimap has to change the editor itself, not just the tick.
  await window.click('[data-testid="editor-view-menu"]')
  await window.waitForSelector('[data-testid="editor-view-options"]', { timeout: 5000 })
  await window.click('button:has-text("Minimap")')
  await waitForAsync(
    async () =>
      (await window.evaluate(() => document.querySelectorAll('.monaco-editor .minimap').length)) >
      0,
    10000,
    'toggling Minimap did not reach the editor'
  )
  await window.click('button:has-text("Minimap")')
  await window.keyboard.press('Escape')
  await window.waitForSelector('[data-testid="editor-view-options"]', {
    state: 'hidden',
    timeout: 5000
  })

  // Breadcrumbs come from the language server's document symbols, so their
  // presence is a second, independent check that 12.2 is answering.
  await waitForAsync(
    async () =>
      (await window.evaluate(
        () => document.querySelectorAll('[data-testid="breadcrumb-symbol"]').length
      )) > 0,
    30000,
    'no symbol breadcrumb — document symbols did not arrive'
  )

  // Workspace roots (3B.4). The grant itself goes through a native folder
  // picker, so it is driven here through the IPC the picker resolves to; what
  // matters for the boundary is what the fs layer accepts afterwards.
  const roots = await window.evaluate(() => window.agweb.workspaceRoots())
  if (roots.length !== 2) throw new Error(`expected primary + granted root, got ${roots.length}`)

  // The granted folder is reachable by absolute path...
  const granted = await window.evaluate((p) => window.agweb.fs.read(p + '/granted.txt'), extraRoot)
  if (!granted.content?.includes('from the granted folder')) {
    throw new Error('a granted folder was not readable')
  }

  // ...but a bare relative path still resolves against the primary root only,
  // so granting a folder cannot change what an existing caller means.
  const relative = await window.evaluate(() => window.agweb.fs.read('granted.txt'))
  if (relative.content !== undefined) {
    throw new Error('a relative path escaped the primary root')
  }

  // A file outside every root stays refused for the whole run.
  const secret = await window.evaluate((p) => window.agweb.fs.read(p + '/secret.txt'), forbidden)
  if (secret.content !== undefined) throw new Error('a path outside every root was readable')

  // Traversal out of the primary root is refused too.
  const escaped = await window.evaluate(() => window.agweb.fs.read('../../etc/hosts'))
  if (escaped.content !== undefined) throw new Error('a traversal escaped the workspace')

  // Debugging (12.4): open the debuggee, set a breakpoint in the gutter, run
  // it under js-debug, and assert we stop with a real call stack.
  await window.click('[data-testid="deck-menu"]')
  await window.click('button:has-text("Debug")')
  await window.waitForSelector('[data-testid="debug-start"]', { timeout: 15000 })

  await window.click('text=debuggee.js')
  await window.waitForSelector('text=compute', { timeout: 15000 })
  // Line 2 (`const total = a + b`) in the editor's glyph margin.
  const line2 = await window.evaluate(() => {
    const lines = [...document.querySelectorAll('.monaco-editor .margin-view-overlays > div')]
    const el = lines[1]
    if (!el) return null
    const r = el.getBoundingClientRect()
    return { x: r.left + 8, y: r.top + r.height / 2 }
  })
  if (!line2) throw new Error('could not find the editor glyph margin')
  await window.mouse.click(line2.x, line2.y)
  await window.waitForSelector('.agweb-breakpoint', { timeout: 10000 })

  await window.click('[data-testid="debug-start"]')
  await window.waitForSelector('[data-testid="debug-frame"]', { timeout: 60000 })
  await waitForAsync(
    async () => (await window.evaluate(() => document.body.innerText)).includes('compute'),
    20000,
    'the debugger stopped but showed no frame for compute()'
  )
  await window.click('[data-testid="debug-stop"]')

  // Settings (12.6): the Workspace scope writes .vscode/settings.json, which
  // is verified on disk rather than trusted from the UI.
  await window.click('[data-testid="deck-menu"]')
  await window.click('button:has-text("Settings")')
  await window.waitForSelector('[data-testid="settings-tab-workspace"]', { timeout: 15000 })
  await window.click('[data-testid="settings-tab-workspace"]')
  await window.waitForTimeout(500)
  // Scoped to this block's editor: several Monaco instances are on screen.
  await window.click('[data-testid="settings-editor"] .view-lines')
  await window.keyboard.press('ControlOrMeta+a')
  // No closing brace: Monaco auto-closes it, and typing our own would double it.
  await window.keyboard.type('{ "editor.tabSize": 8')
  await window.click('[data-testid="settings-save"]')
  await waitForAsync(
    async () =>
      existsSync(join(workspace, '.vscode', 'settings.json')) &&
      readFileSync(join(workspace, '.vscode', 'settings.json'), 'utf8').includes(
        '"editor.tabSize"'
      ),
    10000,
    'workspace settings were not written to .vscode/settings.json'
  )

  // Tasks (12.5): run a task and check its output becomes an editor
  // diagnostic, not just text in a terminal.
  //
  // The fixture reports its error in src/index.ts, which is otherwise clean —
  // so a squiggle there cannot have come from the language server, and this
  // distinguishes the problem matcher from 12.2's diagnostics.
  await window.click('[data-testid="deck-menu"]')
  await window.click('button:has-text("Tasks")')
  await window.waitForSelector('[data-testid="task-run-typecheck"]', { timeout: 15000 })
  await window.click('[data-testid="task-run-typecheck"]')

  // The parsed problem, with the compiler's own code.
  await window.waitForSelector('[data-testid="task-problem"]', { timeout: 30000 })
  await waitForAsync(
    async () => (await window.evaluate(() => document.body.innerText)).includes('TS2322'),
    15000,
    'the task problem did not surface with its compiler code'
  )

  // Clicking it opens the file, where the marker renders as a squiggle.
  await window.click('[data-testid="task-problem"]')
  await waitForAsync(
    async () =>
      (await window.evaluate(() => {
        const tab = document.querySelector('[data-testid="editor-breadcrumbs"]')
        const onIndex = tab?.textContent?.includes('index.ts') ?? false
        const squiggles = document.querySelectorAll('.monaco-editor .squiggly-error').length
        return onIndex && squiggles > 0
      })) === true,
    20000,
    'the task problem did not become a marker in the editor'
  )

  // Source control (12.3): the block sees the uncommitted change, opens its
  // diff in the Monaco diff component, stages it, and records a revision —
  // verified against the repo itself rather than against the UI's own claims.
  await window.click('[data-testid="deck-menu"]')
  await window.click('button:has-text("Source Control")')
  await window.waitForSelector('[data-testid="git-branch"]', { timeout: 15000 })
  await window.waitForSelector('text=data.json', { timeout: 15000 })
  await window.click('[data-testid="git-branch"]')
  await window.waitForSelector('[data-testid="git-branch-menu"]', { timeout: 5000 })
  // Popovers dismiss on Escape everywhere in the shell; this one included.
  await window.keyboard.press('Escape')
  await window.waitForSelector('[data-testid="git-branch-menu"]', {
    state: 'hidden',
    timeout: 5000
  })
  await window.click('button:has-text("Stage all")')
  await waitForAsync(
    async () =>
      execFileSync('git', ['diff', '--cached', '--name-only'], { cwd: workspace })
        .toString()
        .includes('data.json'),
    10000,
    'Stage all did not stage data.json'
  )
  await window.fill('[data-testid="git-message"]', 'smoke: staged from the block')
  await window.click('[data-testid="git-commit"]')
  await waitForAsync(
    async () =>
      execFileSync('git', ['log', '-1', '--format=%s'], { cwd: workspace })
        .toString()
        .includes('smoke: staged from the block'),
    10000,
    'the revision recorded from the Source Control block did not reach the repo'
  )

  // Diff: buffer vs disk overlay opens and closes.
  await window.click('button:has-text("Diff")')
  await window.waitForSelector('text=saved on disk', { timeout: 10000 })
  await window.click('button[aria-label="Close diff"]')

  // Project search: add a Search block, find a symbol.
  await window.click('[data-testid="deck-menu"]')
  await window.click('button:has-text("Search")')
  await window.fill('input[placeholder="Search project…"]', 'answer')
  await window.press('input[placeholder="Search project…"]', 'Enter')
  await window.waitForSelector('text=src/index.ts', { timeout: 15000 })

  // Files (P1-5): moving onto a directory that already holds that name must
  // refuse rather than silently destroying the destination file.
  const clobber = await window.evaluate(async () => {
    await window.agweb.fs.write('src/collide.md', 'kept')
    await window.agweb.fs.write('collide.md', 'incoming')
    const result = await window.agweb.fs.rename('collide.md', 'src/collide.md')
    const survivor = await window.agweb.fs.read('src/collide.md')
    return { error: result.error ?? null, content: survivor.content }
  })
  if (!clobber.error || clobber.content !== 'kept') {
    throw new Error(`rename clobbered the destination: ${JSON.stringify(clobber)}`)
  }

  // Live preview (4.1/4.2): add a Preview block, run the detected dev script,
  // and see the served page render inside the sandboxed iframe; then switch
  // to the built-in static server over the workspace root.
  await window.click('[data-testid="deck-menu"]')
  await window.click('button:has-text("Preview")')
  await window.waitForSelector('[data-testid="preview-block"]', { timeout: 5000 })
  const previewFrame = window.frameLocator('[data-testid="preview-block"] iframe')
  await window.click('button[aria-label="Start dev server"]')
  await window.waitForSelector('[data-testid="preview-status"]:has-text("http://127.0.0.1")', {
    timeout: 30000
  })
  await previewFrame.locator('text=preview-live').waitFor({ timeout: 15000 })
  await window.click('button[aria-label="Stop dev server"]')
  await window.click('button[aria-label="Serve folder statically"]')
  await window.waitForSelector('[data-testid="preview-status"]:has-text("http://127.0.0.1")', {
    timeout: 15000
  })
  await previewFrame.locator('text=preview-live').waitFor({ timeout: 15000 })
  await window.click('button[aria-label="Stop dev server"]')

  // Slide runtime (4.4): a *.slides.md file opens as a Reveal deck in a
  // browser tab, served by the lazy slide server with live-reload polling.
  await window.click('text=pitch.slides.md')
  await window.waitForSelector(strip('pitch.slides.md'), { timeout: 15000 })
  const slideDeck = await window.evaluate((rel) => window.agweb.slides.open(rel), 'pitch.slides.md')
  if (!slideDeck.url) throw new Error(`slides.open failed: ${slideDeck.error}`)
  const deckHtml = await (await fetch(slideDeck.url)).text()
  if (!deckHtml.includes('/reveal/reveal.js')) throw new Error('deck html missing reveal runtime')
  const rawMd = await (await fetch(slideDeck.url.replace('/deck/', '/raw/'))).text()
  if (!rawMd.includes('Slide Two')) throw new Error('raw deck markdown not served')

  // Slide templates (4.5): "+ deck" creates a deck from the Pitch template
  // and opens it as a presentation tab.
  await window.click('button[aria-label="New slide deck"]')
  await window.click('[data-testid="deck-template-pitch"]')
  await window.waitForSelector(strip('deck.slides.md'), { timeout: 15000 })

  // Deck exports (4.6): standalone JSON structure and a self-contained HTML
  // bundle, served as attachments (they ride the 2.7 download flow in-app).
  const deckJson = await (await fetch(slideDeck.url.replace('/deck/', '/export/json/'))).json()
  if (deckJson.slides.length !== 2 || deckJson.title !== 'Slide One') {
    throw new Error(`deck JSON export wrong: ${JSON.stringify(deckJson).slice(0, 200)}`)
  }
  const deckBundle = await (await fetch(slideDeck.url.replace('/deck/', '/export/html/'))).text()
  if (!deckBundle.includes('Slide Two') || !deckBundle.includes('Reveal.initialize')) {
    throw new Error('deck HTML bundle incomplete')
  }

  // Agent orchestration (mock provider): plan → approve → execute, with the
  // written file landing on disk and the session finishing as Done.
  // Composer (11.x): @mention attaches a workspace file as explicit context,
  // and the task is sent through the composer rather than a bare textarea.
  await window.fill('[data-testid="agent-task-input"]', '@index')
  await window.waitForSelector('[data-testid="composer-mentions"]', { timeout: 10000 })
  await window.click('[data-testid="composer-mentions"] >> text=src/index.ts')
  await window.waitForSelector('[data-testid="composer-chips"] >> text=src/index.ts', {
    timeout: 5000
  })
  await window.fill('[data-testid="agent-task-input"]', 'Record this smoke task')
  await window.click('[data-testid="agent-plan-button"]')
  await window.waitForSelector('[data-testid="agent-status"]:has-text("Awaiting approval")', {
    timeout: 15000
  })
  await window.waitForSelector('text=Write AGENT_NOTE.md')
  // Permission policy (9.1-9.3): review mode auto-approves the mock's
  // workspace writes and local browser work, but pauses every command-class
  // action — its `ls`, and (since P0-2) its browser_eval — on the inline
  // prompt. Allow each one as it appears until the session finishes.
  const policyMode = await window.locator('[data-testid="policy-mode"]').inputValue()
  if (policyMode !== 'review') throw new Error(`unexpected default permission mode: ${policyMode}`)
  await window.click('[data-testid="agent-approve"]')
  await window.waitForSelector('[data-testid="policy-prompt"]', { timeout: 15000 })
  let prompts = 0
  const doneStatus = window.locator('[data-testid="agent-status"]:has-text("Done")')
  while ((await doneStatus.count()) === 0) {
    if (await window.locator('[data-testid="policy-allow"]').count()) {
      await window.click('[data-testid="policy-allow"]')
      prompts++
    } else {
      await window.waitForTimeout(200)
    }
    if (prompts > 10) throw new Error('policy prompts did not drain')
  }
  // browser_eval is command-class now, so it must have prompted too (P0-2).
  if (prompts < 2) throw new Error(`expected browser_eval + ls prompts, saw ${prompts}`)
  await window.waitForSelector('[data-testid="agent-status"]:has-text("Done")', { timeout: 30000 })

  // Policy (P1-4): switching mode clears "don't ask again" grants; a deny
  // rule outranks any grant. Verify the switch takes effect in main.
  await window.selectOption('[data-testid="policy-mode"]', 'secure')
  const secureMode = await window.evaluate(() => window.agweb.policy.get().then((p) => p.mode))
  if (secureMode !== 'secure') throw new Error('policy mode did not switch to secure')
  await window.selectOption('[data-testid="policy-mode"]', 'review')

  // Inline terminal (11.10): the agent's command rendered where it was run,
  // and collapsed to a summary row once it exited.
  await window.waitForSelector('[data-testid="inline-terminal"]', { timeout: 15000 })
  await window.waitForSelector('[data-testid="inline-terminal"] >> text=ls', { timeout: 5000 })

  // Every decision lands in the audit log — including the human one above.
  await waitFor(
    () => {
      const lines = readFileSync(join(userData, 'audit.jsonl'), 'utf8')
      return lines.includes('"kind":"command"') && lines.includes('"byUser":true')
    },
    5000,
    'audit log missing the user decision'
  )
  await window.waitForSelector('text=Task complete.')
  await waitFor(
    () => readFileSync(join(workspace, 'AGENT_NOTE.md'), 'utf8').includes('Record this smoke task'),
    10000,
    'agent-written file did not reach disk'
  )

  // Browser-verification loop (Phase 7): the agent opened a real tab (visible
  // in the tab strip), clicked it, asserted on the DOM, and saved a screenshot.
  await window.waitForSelector('text=Agent Target', { timeout: 10000 })
  await window.waitForSelector('text=clicked-ok')
  // Agent Vision (P0): the DOM said "clicked-ok", but the browser also saw a
  // console error and a dead request — and the agent surfaced them on its own,
  // without a human asking, in its verify step.
  await window.waitForSelector('text=Agent Vision verified', { timeout: 10000 })
  await waitFor(
    () => statSync(join(workspace, 'agent-shot.png')).size > 1000,
    10000,
    'agent screenshot did not reach disk'
  )
  // Session recording (7.4): the mock records its browser dance and saves a
  // self-contained HTML replay with the captured frames inlined.
  await waitFor(
    () =>
      readFileSync(join(workspace, 'recordings', 'verify.html'), 'utf8').includes('data:image/png'),
    10000,
    'session replay recording did not reach disk'
  )
  await window.screenshot({ path: screenshotPath.replace(/\.png$/, '-agents.png') })

  // Execution report (Phase 8): written to the artifact store with the diff
  // and the screenshot embedded, and opened as a browser tab on demand.
  await window.waitForSelector('text=Execution report ready.', { timeout: 10000 })
  await window.click('[data-testid="agent-report"]')
  await window.waitForSelector('text=Agent report', { timeout: 15000 })
  await waitFor(
    () => {
      const html = readFileSync(join(userData, 'artifacts', 'agent-1', 'report.html'), 'utf8')
      return html.includes('clicked-ok') && html.includes('data:image/png;base64,')
    },
    10000,
    'execution report was not written with embedded artifacts'
  )

  // Document Studio: markdown renders styled in a doc tab (with highlighted
  // code, KaTeX math, and a Mermaid diagram); Source toggles to Monaco;
  // JSON gets the tree inspector; CSV gets the sortable table.
  await window.click('text=hello.md')
  await window.waitForSelector('h1:has-text("Hello Studio")', { timeout: 15000 })
  await window.waitForSelector('text=tasks render')
  await window.waitForSelector('.hljs-keyword', { timeout: 15000 })
  await window.waitForSelector('.katex', { timeout: 15000 })
  await window.waitForSelector('.mermaid-diagram svg', { timeout: 30000 })
  await window.waitForTimeout(400)
  await window.screenshot({ path: screenshotPath })

  await window.click('button:has-text("Source")')
  await window.locator('.stage .monaco-editor').waitFor({ timeout: 15000 })
  await window.click('button:has-text("Styled")')
  await window.waitForSelector('h1:has-text("Hello Studio")')

  await window.click('text=data.json')
  await window.waitForSelector('text=tags', { timeout: 15000 })
  await window.waitForSelector('text=array') // the tags node's type badge (array·2)

  // Node-graph view: root and child container render as connected nodes.
  await window.click('button:has-text("Graph")')
  await window.waitForSelector('.json-graph svg', { timeout: 10000 })
  await window.waitForSelector('.json-graph text:has-text("tags")')
  await window.click('button:has-text("Styled")')

  // Format conversion: JSON → YAML writes a sibling file and opens it.
  await window.click('button:has-text("Convert")')
  await window.click('button:has-text("to .yaml")')
  await waitFor(
    () => readFileSync(join(workspace, 'data.yaml'), 'utf8').includes('name: agweb'),
    15000,
    'converted YAML did not reach disk'
  )

  await window.click('text=table.csv')
  await window.waitForSelector('th:has-text("city")', { timeout: 15000 })
  await window.waitForSelector('text=Tokyo')
  await window.screenshot({ path: screenshotPath.replace(/\.png$/, '-csv.png') })

  // Layout preset: Debugging stacks terminals with a fresh Logs block.
  await window.click('[data-testid="deck-menu"]')
  await window.click('button:has-text("Debugging")')
  await window.waitForSelector('button:has-text("Logs")')

  // The Logs block carries the merged agent activity feed.
  await window.waitForSelector('[data-testid="logs-feed"] >> text=Task complete.', {
    timeout: 10000
  })

  // Drag-and-drop: stack the Logs tab onto the Agents group header.
  const agentsHeader = window
    .locator('[data-deck-header]')
    .filter({ has: window.locator('button', { hasText: 'Agents' }) })
  await window.locator('button', { hasText: 'Logs' }).first().dragTo(agentsHeader.first())
  await agentsHeader
    .filter({ has: window.locator('button', { hasText: 'Logs' }) })
    .first()
    .waitFor({ timeout: 5000 })

  // Rail: collapse the stacked Logs block, then restore it.
  await window.click('button[aria-label="Send Logs to rail"]')
  await window.waitForSelector('button[aria-label="Restore Logs"]')
  await window.click('button[aria-label="Restore Logs"]')
  await window.waitForSelector('button:has-text("Logs")')

  // Float: pop the Files stack out as its own window, then dock it back.
  const floatPromise = app.waitForEvent('window')
  await window.click('button[aria-label="Float Files"]')
  const floatWin = await floatPromise
  await floatWin.waitForSelector('text=hello.md', { timeout: 15000 })
  await floatWin.click('button[aria-label="Dock back"]')
  await window
    .locator('[data-deck-header]')
    .filter({ has: window.locator('button', { hasText: 'Files' }) })
    .first()
    .waitFor({ timeout: 5000 })

  // Detach: the whole deck becomes a standalone IDE window.
  const deckPromise = app.waitForEvent('window')
  await window.click('button[aria-label="Detach deck"]')
  const deckWin = await deckPromise
  await deckWin.waitForSelector('text=Dock back', { timeout: 15000 })
  await deckWin.waitForSelector('text=Terminal 1')
  await window.waitForSelector('[data-testid="deck-detached"]')
  await deckWin.screenshot({ path: screenshotPath.replace(/\.png$/, '-deckwin.png') })
  await deckWin.click('text=Dock back')
  await window.waitForSelector('.workspace.revealed', { timeout: 5000 })

  // Conversation management (11.9): rename relabels the session in place, and
  // export writes the transcript into the session's artifact directory.
  await window.click('[data-testid="agent-menu"]')
  await window.click('text=Export Markdown')
  await waitFor(
    () => existsSync(join(userData, 'artifacts', 'agent-1', 'transcript.md')),
    5000,
    'agent transcript.md was not written'
  )
  await window.click('[data-testid="agent-menu"]')
  await window.click('text=Rename')
  await window.fill('[data-testid="agent-rename"]', 'Renamed run')
  await window.keyboard.press('Enter')
  await window.waitForSelector('text=Renamed run', { timeout: 5000 })

  // Artifact retention control: clearing finished sessions empties the
  // roster (and deletes the session's artifact directory).
  await window.click('[data-testid="agent-clear-finished"]')
  await window.waitForSelector('text=Give the agent a task', { timeout: 5000 })
  await waitFor(
    () => !existsSync(join(userData, 'artifacts', 'agent-1')),
    5000,
    'artifact directory was not removed'
  )

  // Tab reorder (2.2): drag the table.csv tab onto the Smoke Page tab — it
  // inserts before it, making table.csv the first tab in the strip.
  const tabIn = (title) => window.locator(`[data-testid="tab-strip"] > div:has-text("${title}")`)
  await tabIn('table.csv').dragTo(tabIn('Smoke Page'))
  await window
    .locator('[data-testid="tab-strip"] > div')
    .first()
    .filter({ hasText: 'table.csv' })
    .waitFor({ timeout: 5000 })
  await window.waitForTimeout(700) // let the debounced session save flush

  console.log(`smoke OK — screenshot: ${screenshotPath}`)
} finally {
  await app.close()
}

// Session restore (2.2): relaunch on the same profile — the strip returns in
// its reordered form and the active Document Studio tab re-renders.
const app2 = await electron.launch({
  args: ['out/main/index.js', '--no-sandbox'],
  cwd: new URL('..', import.meta.url).pathname,
  env: {
    ...process.env,
    AGWEB_WORKSPACE: workspace,
    AGWEB_USER_DATA: userData,
    AGWEB_AGENT_MOCK: '1'
  }
})
try {
  const window = await app2.firstWindow()
  await window.waitForSelector('[data-testid="tab-strip"]', { timeout: 15000 })
  await window
    .locator('[data-testid="tab-strip"] > div')
    .first()
    .filter({ hasText: 'table.csv' })
    .waitFor({ timeout: 10000 })
  await window.waitForSelector('[data-testid="tab-strip"] >> text=Smoke Page', { timeout: 10000 })
  await window.waitForSelector('th:has-text("city")', { timeout: 15000 })
  console.log('session restore OK — tabs and order survived relaunch')
} finally {
  await app2.close()
  server.close()
}

async function waitForAsync(check, timeoutMs, message) {
  const start = Date.now()
  for (;;) {
    try {
      if (await check()) return
    } catch {
      // retry
    }
    if (Date.now() - start > timeoutMs) throw new Error(message)
  }
}

async function waitFor(check, timeoutMs, message) {
  const start = Date.now()
  for (;;) {
    try {
      if (check()) return
    } catch {
      // e.g. file not present yet
    }
    if (Date.now() - start > timeoutMs) throw new Error(message)
    await new Promise((resolve) => setTimeout(resolve, 200))
  }
}
