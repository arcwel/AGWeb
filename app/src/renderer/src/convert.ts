import { dump as dumpYaml, load as parseYaml } from 'js-yaml'
import { parse as parseToml, stringify as stringifyToml } from 'smol-toml'
import Papa from 'papaparse'

/** Format conversion for Document Studio: JSON ↔ YAML ↔ TOML ↔ CSV. */

export function conversionTargets(ext: string): string[] {
  switch (ext) {
    case 'json':
      return ['yaml', 'toml', 'csv']
    case 'yaml':
    case 'yml':
      return ['json', 'toml']
    case 'toml':
      return ['json', 'yaml']
    case 'csv':
    case 'tsv':
      return ['json']
    default:
      return []
  }
}

/** Convert `content` from one format to another. Throws with a readable message. */
export function convertContent(content: string, fromExt: string, toExt: string): string {
  const data: unknown =
    fromExt === 'json'
      ? JSON.parse(content)
      : fromExt === 'toml'
        ? parseToml(content)
        : fromExt === 'csv' || fromExt === 'tsv'
          ? Papa.parse(content.trim(), {
              header: true,
              skipEmptyLines: true,
              delimiter: fromExt === 'tsv' ? '\t' : undefined
            }).data
          : parseYaml(content)

  switch (toExt) {
    case 'json':
      return JSON.stringify(data, null, 2) + '\n'
    case 'yaml':
      return dumpYaml(data)
    case 'toml': {
      if (data === null || typeof data !== 'object' || Array.isArray(data)) {
        throw new Error('TOML requires an object at the top level.')
      }
      return stringifyToml(data as Record<string, unknown>) + '\n'
    }
    case 'csv': {
      if (!Array.isArray(data) || data.some((row) => typeof row !== 'object' || row === null)) {
        throw new Error('CSV conversion needs an array of flat objects.')
      }
      return Papa.unparse(data as object[]) + '\n'
    }
    default:
      throw new Error(`Unsupported target .${toExt}`)
  }
}

/** Parse a tree-type document (json/yaml/yml/toml) for the Studio's views. */
export function parseTreeDoc(ext: string, content: string): { data: unknown } | { error: string } {
  try {
    return {
      data:
        ext === 'json'
          ? (JSON.parse(content) as unknown)
          : ext === 'toml'
            ? parseToml(content)
            : parseYaml(content)
    }
  } catch (error) {
    return { error: String(error) }
  }
}
