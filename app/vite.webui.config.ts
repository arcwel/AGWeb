import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { resolve } from 'node:path'
import type { Plugin } from 'vite'

/**
 * Emits `assets/inline-assets.js`: a map of every bundled text asset the VS Code
 * service layer fetches at runtime (themes, TextMate grammars, snippets).
 *
 * Chromium forbids `fetch()` on chrome:// from page script, so those assets are
 * unreadable once served from the WebUI pak — the editor silently loses its
 * themes and syntax highlighting. The page installs a small fetch shim that
 * answers from this map instead (see src/webui/main.tsx).
 *
 * chrome-untrusted:// would allow the fetch natively, but it is not directly
 * navigable — it has to be iframed by a chrome:// host page, which is a larger
 * change than this.
 */
function inlineFetchedAssets(): Plugin {
  const FETCHED = /\.(json|tmLanguage|code-snippets)$/
  return {
    name: 'webdeck-inline-fetched-assets',
    generateBundle(_options, bundle) {
      const map: Record<string, string> = {}
      for (const [fileName, chunk] of Object.entries(bundle)) {
        if (chunk.type !== 'asset' || !FETCHED.test(fileName)) continue
        map[fileName] =
          typeof chunk.source === 'string'
            ? chunk.source
            : Buffer.from(chunk.source).toString('utf8')
      }
      this.emitFile({
        type: 'asset',
        fileName: 'assets/inline-assets.js',
        source: `globalThis.__WEBDECK_ASSETS = ${JSON.stringify(map)};\n`
      })
    }
  }
}

/**
 * The `chrome://webdeck` bundle.
 *
 * Same renderer sources as the Electron build; only the entry differs (it builds
 * `window.agweb` over a WebSocket instead of receiving it from a preload).
 *
 * Two deliberate differences from the Electron renderer config:
 *
 * - **No content hashes in filenames.** Chromium's grit packs a *fixed* file
 *   list declared in a `.grd`, so hashed names would mean regenerating that list
 *   on every build. WebUI resources are served from the browser's own pak and
 *   versioned with the binary, so cache-busting hashes buy nothing here.
 * - **Relative base**, because the page is served from `chrome://webdeck/`.
 */
export default defineConfig({
  base: './',
  // Rooted at the page so the output is flat for the resource packer. Tailwind's
  // scan root is pinned by an `@source` in styles.css rather than inferred from
  // here — inferring it produced CSS with no utilities and a collapsed layout.
  root: resolve(__dirname, 'src/webui'),
  // The renderer's own public dir, so the static files the shared components
  // reference by relative URL (the start page's brand lockups) are emitted here
  // too and get packed into the browser. Pointing this anywhere else would give
  // the fork a page with broken images while Electron looked fine.
  publicDir: resolve(__dirname, 'src/renderer/public'),
  plugins: [react(), tailwindcss(), inlineFetchedAssets()],
  worker: { format: 'es' },
  resolve: {
    alias: {
      '@shared': resolve(__dirname, 'src/shared'),
      '@': resolve(__dirname, 'src/renderer/src')
    }
  },
  build: {
    outDir: resolve(__dirname, 'out/webui'),
    emptyOutDir: true,
    // Chromium serves these; a source map per chunk would double the pak.
    sourcemap: false,
    // The TextMate tokenizer fetches its oniguruma wasm. fetch() refuses
    // chrome:// URLs, so the file rides inside the bundle as a data: URI —
    // which connect-src allows and fetch() accepts.
    assetsInlineLimit: (file) => (file.endsWith('onig.wasm') ? true : undefined),

    rollupOptions: {
      output: {
        entryFileNames: 'assets/[name].js',
        chunkFileNames: 'assets/[name].js',
        /**
         * Sanitize asset filenames.
         *
         * Chromium's build writes make-style depfiles, which cannot express
         * paths containing parentheses or spaces — one bundled TextMate grammar
         * (`Regular_Expressions_(JavaScript).tmLanguage`) silently corrupted the
         * depfile and failed the build with a nonsense missing-file error.
         * Rollup rewrites every reference to the emitted name, so renaming here
         * is safe.
         */
        assetFileNames: (asset) => {
          const full = asset.names?.[0] ?? asset.name ?? 'asset'
          // Split at the FIRST dot so multi-part extensions (.tmLanguage.json)
          // survive intact — splitting at the last one duplicates them.
          const dot = full.indexOf('.')
          const base = dot === -1 ? full : full.slice(0, dot)
          const ext = dot === -1 ? '' : full.slice(dot)
          return `assets/${base.replace(/[^A-Za-z0-9_-]+/g, '_')}${ext}`
        }
      }
    }
  }
})
