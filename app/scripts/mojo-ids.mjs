// Do the Mojo bindings the page ships agree with the browser they run in?
//
// The browser side's message IDs live in the build's generated
// `webdeck.mojom-shared-message-ids.h`; the page side's are literals in the
// transpiled `webdeck.mojom-webui.js`. An official build scrambles the IDs, a
// component build does not, and a mojom edit renumbers both — any of which
// makes a page built for one browser send messages the other kills the
// renderer for. This compares the two so packing can refuse the mismatch.
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

export const MESSAGE_IDS_HEADER =
  'gen/chrome/browser/ui/webui/webdeck/webdeck.mojom-shared-message-ids.h'

/** `Interface.method` → id, from the generated C++ header. */
export function messageIdsFromHeader(source) {
  const ids = new Map()
  const re = /enum class (\w+) : uint32_t \{([^}]*)\}/g
  for (const [, iface, body] of source.matchAll(re)) {
    for (const [, method, id] of body.matchAll(/\bk(\w+) = (\d+),/g)) {
      ids.set(`${iface}.${method[0].toLowerCase()}${method.slice(1)}`, Number(id))
    }
  }
  return ids
}

/** `Interface.method` → id, from the transpiled JS bindings the page loads. */
export function messageIdsFromBindings(source) {
  const ids = new Map()
  // Each interface is `var FooRemote = class { … }`; inside, every method is
  // `name(args) { … sendMessage(\n <id>, …`. Split on the class markers so a
  // method name is attributed to the right interface.
  const parts = source.split(/\bvar (\w+)Remote = class \{/)
  for (let i = 1; i < parts.length; i += 2) {
    const iface = parts[i]
    const body = parts[i + 1] ?? ''
    const methodRe = /\n {2}(\w+)\([^)]*\) \{\s*(?:return )?this\.proxy\.sendMessage\(\s*(\d+),/g
    for (const [, method, id] of body.matchAll(methodRe)) {
      ids.set(`${iface}.${method}`, Number(id))
    }
  }
  return ids
}

/**
 * Compare page bindings against a build. `ok` only when every method the page
 * can send has the same id the browser expects; `missing` lists methods the
 * page has that the build does not know at all (a mojom the page outran).
 */
export function compareMessageIds(bindings, header) {
  const mismatches = []
  const missing = []
  for (const [key, id] of bindings) {
    if (!header.has(key)) missing.push(key)
    else if (header.get(key) !== id) mismatches.push({ key, page: id, browser: header.get(key) })
  }
  return { ok: mismatches.length === 0 && missing.length === 0, mismatches, missing }
}

/** Convenience for the scripts: read both files from disk. */
export function checkBindingsAgainstBuild(bindingsPath, chromiumSrc, buildDir) {
  const headerPath = join(chromiumSrc, buildDir, MESSAGE_IDS_HEADER)
  const header = messageIdsFromHeader(readFileSync(headerPath, 'utf8'))
  const bindings = messageIdsFromBindings(readFileSync(bindingsPath, 'utf8'))
  if (bindings.size === 0) throw new Error(`no Mojo methods found in ${bindingsPath}`)
  if (header.size === 0) throw new Error(`no message ids found in ${headerPath}`)
  return { ...compareMessageIds(bindings, header), headerPath, methods: bindings.size }
}
