/**
 * SVG markup to a DOM node, without a string ever reaching the live document.
 *
 * chrome://webdeck requires Trusted Types for every HTML sink, and the page's
 * default policy refuses HTML strings — so `innerHTML` is out, and so is
 * React's dangerouslySetInnerHTML, which is the same sink. DOMParser is a sink
 * as well: it takes a string. So the markup goes through a policy of its own,
 * `webdeck-inert-parse`, whose one job is to feed that parser. Its output is
 * an inert document: nothing in it runs, and nothing in it reaches the page
 * as markup. The node is scrubbed and then imported — node insertion is not a
 * sink — which is the whole trick.
 *
 * Parsing is also where it gets checked. Mermaid renders from sanitized text
 * (securityLevel: strict), but the output still arrives here as markup, and a
 * reader that trusts markup it did not write is how a document runs code.
 * Anything that could execute — scripts, event handler attributes,
 * javascript: links, embedded HTML frames — is removed before the node is
 * handed back.
 */

interface InertParsePolicy {
  createHTML(input: string): unknown
}

let parsePolicy: InertParsePolicy | null | undefined

/**
 * `markup`, marked as fit for the inert parser and nothing else.
 *
 * The policy is created once and used only here. Where Trusted Types is not
 * enforced (tests, a plain browser) the string passes through unchanged.
 */
function forInertParser(markup: string): string {
  if (parsePolicy === undefined) {
    const tt = (
      window as {
        trustedTypes?: { createPolicy(name: string, rules: InertParsePolicy): InertParsePolicy }
      }
    ).trustedTypes
    parsePolicy = tt
      ? tt.createPolicy('webdeck-inert-parse', { createHTML: (input) => input })
      : null
  }
  return parsePolicy ? (parsePolicy.createHTML(markup) as string) : markup
}

const SVG_NS = 'http://www.w3.org/2000/svg'

/** Elements that can run or load code, wherever they appear in the tree. */
const FORBIDDEN_ELEMENTS = new Set(['script', 'iframe', 'object', 'embed', 'meta', 'base', 'link'])

/** Attribute values that would run code when followed. */
const SCRIPT_URL = /^\s*(javascript|data|vbscript):/i

function scrub(element: Element): void {
  for (const child of [...element.children]) {
    if (FORBIDDEN_ELEMENTS.has(child.localName.toLowerCase())) {
      child.remove()
      continue
    }
    scrub(child)
  }
  for (const attr of [...element.attributes]) {
    const name = attr.name.toLowerCase()
    if (name.startsWith('on')) {
      element.removeAttribute(attr.name)
      continue
    }
    if (
      (name === 'href' || name === 'xlink:href' || name === 'src') &&
      SCRIPT_URL.test(attr.value)
    ) {
      element.removeAttribute(attr.name)
    }
  }
}

/**
 * The root <svg> element of `markup`, scrubbed, as a node of `doc` — or null
 * when the markup holds no SVG at all.
 *
 * Parsed as XML first, which is what an SVG document is. Mermaid's output is
 * not always one: labels are HTML inside <foreignObject>, with `<br>` and
 * `&nbsp;` that XML rejects. That falls back to the HTML parser, which knows
 * SVG as foreign content and builds the same namespaced elements. Both
 * produce an inert document.
 */
export function svgToSafeNode(markup: string, doc: Document = document): SVGSVGElement | null {
  const root = parseRootSvg(markup)
  if (!root) return null
  scrub(root)
  return doc.importNode(root, true) as unknown as SVGSVGElement
}

function parseRootSvg(markup: string): Element | null {
  const parser = new DOMParser()
  const source = forInertParser(markup)
  const xml = parser.parseFromString(source, 'image/svg+xml')
  if (xml.getElementsByTagName('parsererror').length === 0) {
    const root = xml.documentElement
    return root && root.namespaceURI === SVG_NS && root.localName === 'svg' ? root : null
  }
  const html = parser.parseFromString(source, 'text/html')
  const root = html.body.querySelector('svg')
  return root && root.namespaceURI === SVG_NS ? root : null
}
