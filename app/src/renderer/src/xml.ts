import { XMLBuilder, XMLParser, XMLValidator } from 'fast-xml-parser'

/**
 * XML support for Document Studio.
 *
 * fast-xml-parser gives us three things in one small, dependency-light package:
 * parse (XML → plain JS object) for the tree/graph inspector and JSON
 * conversion, build (object → XML) for Beautify/Minify, and validate for
 * readable error messages. No DOM or heavy schema tooling is pulled in.
 */

const ATTR_PREFIX = '@_'

// Readable mapping for the inspector and JSON conversion: elements become keys,
// attributes are prefixed with @_, text content lands under #text. Order is not
// preserved here on purpose — a plain object reads better in the tree/graph.
const readableParser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: ATTR_PREFIX,
  parseTagValue: true,
  trimValues: true,
  ignoreDeclaration: true
})

// Order-preserving parse/build pair for faithful reformatting. preserveOrder
// keeps sibling order, comments, and mixed content intact so Beautify/Minify
// round-trip the document instead of reshaping it.
const faithfulParser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: ATTR_PREFIX,
  preserveOrder: true,
  parseTagValue: false,
  trimValues: true,
  commentPropName: '#comment'
})

function faithfulBuilder(format: boolean): XMLBuilder {
  return new XMLBuilder({
    ignoreAttributes: false,
    attributeNamePrefix: ATTR_PREFIX,
    preserveOrder: true,
    commentPropName: '#comment',
    format,
    indentBy: '  ',
    suppressEmptyNode: false
  })
}

/** Throw with a readable, located message when the XML is malformed. */
function assertValid(content: string): void {
  const result = XMLValidator.validate(content, { allowBooleanAttributes: true })
  if (result !== true) {
    const { msg, line, col } = result.err
    throw new Error(`${msg} (line ${line}, column ${col})`)
  }
}

/** Parse XML into a plain-object tree for the inspector and JSON conversion. */
export function parseXml(content: string): unknown {
  assertValid(content)
  return readableParser.parse(content) as unknown
}

/** Pretty-print XML with two-space indentation. Throws on invalid input. */
export function beautifyXml(content: string): string {
  assertValid(content)
  const tree: unknown = faithfulParser.parse(content)
  return faithfulBuilder(true).build(tree).trim() + '\n'
}

/** Collapse XML onto a single line. Throws on invalid input. */
export function minifyXml(content: string): string {
  assertValid(content)
  const tree: unknown = faithfulParser.parse(content)
  return faithfulBuilder(false).build(tree).trim() + '\n'
}

/** XML → pretty JSON, via the readable object mapping. */
export function xmlToJson(content: string): string {
  return JSON.stringify(parseXml(content), null, 2) + '\n'
}

/** Conversion targets offered for an XML source, mirroring convert.ts's shape. */
export const XML_CONVERSION_TARGETS: readonly string[] = ['json']

/** Convert XML `content` to a supported target. Throws with a readable message. */
export function convertXml(content: string, target: string): string {
  if (target === 'json') return xmlToJson(content)
  throw new Error(`Unsupported target .${target} for XML.`)
}
