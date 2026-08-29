import type { monaco as Monaco } from '@/monaco'

/**
 * Prettier formatting for web languages, loaded on demand so the heavy
 * parsers stay out of the startup bundle. Python (ruff/black) arrives with
 * the Python tooling workspace.
 */

const PARSERS: Record<string, string> = {
  ts: 'babel-ts',
  tsx: 'babel-ts',
  mts: 'babel-ts',
  js: 'babel',
  jsx: 'babel',
  mjs: 'babel',
  cjs: 'babel',
  json: 'json',
  css: 'css',
  scss: 'scss',
  html: 'html',
  htm: 'html',
  md: 'markdown',
  markdown: 'markdown',
  yaml: 'yaml',
  yml: 'yaml'
}

export function canFormat(path: string): boolean {
  const ext = path.split('.').pop()?.toLowerCase() ?? ''
  return ext in PARSERS
}

/** Format the model in place (single undo step). Returns an error message or null. */
export async function formatModel(
  path: string,
  model: Monaco.editor.ITextModel
): Promise<string | null> {
  const ext = path.split('.').pop()?.toLowerCase() ?? ''
  const parser = PARSERS[ext]
  if (!parser) return `No formatter for .${ext} files yet.`
  try {
    const [prettier, babel, estree, postcss, html, markdown, yaml] = await Promise.all([
      import('prettier/standalone'),
      import('prettier/plugins/babel'),
      import('prettier/plugins/estree'),
      import('prettier/plugins/postcss'),
      import('prettier/plugins/html'),
      import('prettier/plugins/markdown'),
      import('prettier/plugins/yaml')
    ])
    const formatted = await prettier.format(model.getValue(), {
      parser,
      plugins: [
        babel.default,
        estree.default as import('prettier').Plugin,
        postcss.default,
        html.default,
        markdown.default,
        yaml.default
      ],
      semi: false,
      singleQuote: true,
      printWidth: 100
    })
    if (formatted !== model.getValue()) {
      model.pushEditOperations(
        [],
        [{ range: model.getFullModelRange(), text: formatted }],
        () => null
      )
    }
    return null
  } catch (error) {
    return String(error).split('\n')[0]
  }
}
