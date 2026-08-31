#!/usr/bin/env node
// Turns Chromium's generated Mojo TypeScript bindings into a plain ES module
// the WebDeck page can load at runtime.
//
// The generated file cannot go through Vite or tsc. It imports
// `//resources/mojo/mojo/public/js/bindings.js`, which exists only for a WebUI
// page inside the browser, and it references Chromium-only globals like
// MojoHandle. Bundling it would fail the build on every host that is not the
// fork; typechecking it would fail everywhere.
//
// So it is transpiled once, with that import left external, and shipped as a
// static asset. The page loads it with a runtime import the bundler ignores.
//
// Usage: node scripts/gen-mojo-bindings.mjs [--chromium <src>] [--check]
import { build } from 'esbuild'
import { existsSync, mkdirSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = dirname(dirname(fileURLToPath(import.meta.url)))
const argIndex = process.argv.indexOf('--chromium')
const chromium =
  argIndex !== -1 && process.argv[argIndex + 1]
    ? resolve(process.argv[argIndex + 1])
    : '/Volumes/BG_Dev/webdeck-chromium/chromium/src'

const generated = join(
  chromium,
  'out/webdeck/gen/chrome/browser/ui/webui/webdeck/webdeck.mojom-webui.ts'
)
const outFile = join(root, 'src/renderer/public/mojo/webdeck.mojom-webui.js')

if (!existsSync(generated)) {
  console.error(`no generated bindings at ${generated}`)
  console.error('build them first:')
  console.error(
    '  autoninja -C out/webdeck chrome/browser/ui/webui/webdeck:mojo_bindings_ts__generator'
  )
  process.exit(2)
}

mkdirSync(dirname(outFile), { recursive: true })

await build({
  entryPoints: [generated],
  outfile: outFile,
  bundle: true,
  format: 'esm',
  target: 'es2022',
  // The browser resolves this, not us. Bundling it is impossible and inlining
  // a stub would produce a module that silently does nothing.
  external: ['//resources/*'],
  logLevel: 'warning'
})

console.log(`mojo bindings -> ${outFile.replace(root + '/', '')}`)
