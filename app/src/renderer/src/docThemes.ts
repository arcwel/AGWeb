/**
 * Document Studio themes and the standalone CSS used for HTML/PDF export.
 * The in-app look lives in styles.css (.doc-md + .doc-theme-*); this export
 * stylesheet mirrors it so exported documents stand alone.
 */

export type DocTheme = 'default' | 'serif' | 'compact'

export const DOC_THEMES: { id: DocTheme; label: string; hint: string }[] = [
  { id: 'default', label: 'Default', hint: 'System sans, comfortable rhythm' },
  { id: 'serif', label: 'Serif', hint: 'Book-style reading' },
  { id: 'compact', label: 'Compact', hint: 'Dense, small type' }
]

const themeKey = (workspacePath: string | null): string =>
  `agweb.docTheme:${workspacePath ?? 'default'}`

export function loadDocTheme(workspacePath: string | null): DocTheme {
  try {
    const saved = localStorage.getItem(themeKey(workspacePath))
    if (saved === 'serif' || saved === 'compact' || saved === 'default') return saved
  } catch {
    // storage unavailable
  }
  return 'default'
}

export function saveDocTheme(workspacePath: string | null, theme: DocTheme): void {
  try {
    localStorage.setItem(themeKey(workspacePath), theme)
  } catch {
    // storage unavailable
  }
}

/** Standalone stylesheet for exported documents (mirrors styles.css). */
export function exportCss(theme: DocTheme): string {
  const themed =
    theme === 'serif'
      ? 'body{font-family:Georgia,"Times New Roman",serif;font-size:17px;line-height:1.7}'
      : theme === 'compact'
        ? 'body{font-size:13px;line-height:1.5}'
        : ''
  return `
body{margin:0 auto;max-width:760px;padding:48px 32px;font-family:ui-sans-serif,system-ui,-apple-system,'Segoe UI',sans-serif;font-size:15px;line-height:1.65;color:#1e293b;background:#ffffff}
h1,h2{margin:1.4em 0 .6em;padding-bottom:.3em;border-bottom:1px solid #e2e8f0;font-weight:700;line-height:1.25}
h1{margin-top:0;font-size:1.9em}h2{font-size:1.45em}
h3,h4{margin:1.2em 0 .5em;font-weight:650;font-size:1.15em}
p,ul,ol{margin:0 0 1em}ul,ol{padding-left:1.6em}li{margin:.25em 0}
a{color:#0284c7;text-decoration:none}a:hover{text-decoration:underline}
code{font-family:ui-monospace,'SF Mono',Menlo,monospace;font-size:.86em;background:#f1f5f9;border-radius:5px;padding:.15em .35em}
pre{margin:0 0 1em;padding:14px 16px;overflow-x:auto;background:#f1f5f9;border-radius:8px}
pre code{background:none;padding:0}
blockquote{margin:0 0 1em;padding:.2em 1em;border-left:3px solid #cbd5e1;color:#64748b}
table{margin:0 0 1em;border-collapse:collapse}th,td{border:1px solid #e2e8f0;padding:6px 12px}th{background:#f8fafc;font-weight:650}
hr{margin:1.6em 0;border:none;border-top:1px solid #e2e8f0}
img{max-width:100%}
.hljs-keyword,.hljs-selector-tag{color:#9333ea}.hljs-string,.hljs-attr{color:#15803d}
.hljs-title,.hljs-name{color:#0369a1}.hljs-comment{color:#64748b}.hljs-number,.hljs-literal{color:#b45309}
${themed}
`.trim()
}

/** Wrap rendered document HTML as a standalone page. */
export function standaloneHtml(title: string, bodyHtml: string, theme: DocTheme): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${title.replace(/[<>&]/g, '')}</title>
<style>${exportCss(theme)}</style>
</head>
<body>
${bodyHtml}
</body>
</html>`
}
