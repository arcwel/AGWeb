import { promises as fsp } from 'node:fs'
import { join, resolve } from 'node:path'
import { app } from 'electron'
import type { AgentLogEntry, AgentSessionInfo } from '@shared/agents'

/**
 * Artifact store + execution reports (Phase 8). Each finished session gets a
 * directory under userData/artifacts/<sessionId> holding a self-contained
 * report.html: task, plan, full timeline, every code diff, command output,
 * and screenshot (embedded as data URIs so the report survives workspace
 * cleanup). Old artifact directories are pruned with their sessions.
 */

export function artifactsRoot(): string {
  return join(app.getPath('userData'), 'artifacts')
}

export function reportPath(sessionId: string): string {
  return join(artifactsRoot(), sessionId, 'report.html')
}

export async function removeArtifacts(sessionId: string): Promise<void> {
  await fsp.rm(join(artifactsRoot(), sessionId), { recursive: true, force: true })
}

const esc = (s: string): string =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

const time = (ts: number): string => new Date(ts).toLocaleTimeString()

/** Read a workspace screenshot as a data URI; null if it's gone. */
async function inlineImage(session: AgentSessionInfo, rel: string): Promise<string | null> {
  if (!session.workspacePath) return null
  const full = resolve(session.workspacePath, rel)
  if (full !== session.workspacePath && !full.startsWith(session.workspacePath + '/')) return null
  try {
    const data = await fsp.readFile(full)
    return `data:image/png;base64,${data.toString('base64')}`
  } catch {
    return null
  }
}

const KIND_LABELS: Record<AgentLogEntry['kind'], string> = {
  status: 'status',
  text: 'agent',
  tool: 'tool',
  edit: 'edit',
  command: 'command',
  browser: 'browser',
  screenshot: 'shot',
  error: 'error'
}

function timelineRow(entry: AgentLogEntry): string {
  const body =
    entry.kind === 'edit' && entry.path
      ? `${esc(entry.text)}
        <details><summary>diff</summary>
          <div class="diff">
            <div><h4>before</h4><pre>${esc(entry.before ?? '')}</pre></div>
            <div><h4>after</h4><pre>${esc(entry.after ?? '')}</pre></div>
          </div>
        </details>`
      : esc(entry.text)
  return `<tr class="k-${entry.kind}">
    <td class="ts">${time(entry.ts)}</td>
    <td class="kind"><span>${KIND_LABELS[entry.kind]}</span></td>
    <td class="body">${body}</td>
  </tr>`
}

const PLAN_GLYPHS: Record<string, string> = {
  edit: '✎',
  command: '❯',
  inspect: '🔍',
  verify: '✓',
  other: '·'
}

const REPORT_CSS = `
  :root { color-scheme: light dark; }
  body { margin: 0; padding: 32px 40px 64px; font: 13px/1.55 -apple-system, 'Segoe UI', Roboto, sans-serif;
         background: #f8fafc; color: #1e293b; max-width: 960px; margin-inline: auto; }
  h1 { font-size: 20px; margin: 0 0 4px; }
  h2 { font-size: 13px; text-transform: uppercase; letter-spacing: 0.08em; color: #64748b; margin: 32px 0 10px; }
  .meta { color: #64748b; font-size: 12px; }
  .pill { display: inline-block; padding: 2px 10px; border-radius: 999px; font-weight: 600; font-size: 11px; }
  .pill.done { background: #d1fae5; color: #047857; } .pill.error { background: #fee2e2; color: #b91c1c; }
  .pill.stopped, .pill.rejected { background: #e2e8f0; color: #475569; }
  ol.plan { margin: 0; padding-left: 4px; list-style: none; }
  ol.plan li { padding: 3px 0; } ol.plan .g { color: #94a3b8; margin-right: 8px; }
  ol.plan .d { color: #64748b; }
  table { border-collapse: collapse; width: 100%; }
  td { vertical-align: top; padding: 4px 10px 4px 0; border-top: 1px solid #e2e8f0; }
  td.ts { white-space: nowrap; color: #94a3b8; font-size: 11px; font-variant-numeric: tabular-nums; }
  td.kind span { font-size: 10px; font-weight: 700; text-transform: uppercase; color: #64748b; }
  tr.k-error td.body { color: #b91c1c; } tr.k-command td.body { font-family: ui-monospace, monospace; }
  tr.k-text td.body { white-space: pre-wrap; }
  pre { background: #0f172a; color: #e2e8f0; padding: 10px 12px; border-radius: 8px; overflow-x: auto;
        font: 11px/1.5 ui-monospace, 'SF Mono', Menlo, monospace; white-space: pre-wrap; }
  .diff { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; margin-top: 6px; }
  .diff h4 { margin: 0 0 4px; font-size: 10px; text-transform: uppercase; color: #94a3b8; }
  details summary { cursor: pointer; color: #0284c7; font-size: 12px; margin-top: 2px; }
  figure { margin: 0 0 18px; }
  figure img { max-width: 100%; border: 1px solid #e2e8f0; border-radius: 10px; }
  figcaption { font-size: 11px; color: #64748b; margin-top: 4px; }
  @media (prefers-color-scheme: dark) {
    body { background: #0b0f14; color: #e2e8f0; }
    td { border-top-color: #1e293b; }
    .pill.done { background: rgba(16,185,129,.15); color: #34d399; }
    .pill.error { background: rgba(239,68,68,.15); color: #f87171; }
    .pill.stopped, .pill.rejected { background: rgba(148,163,184,.15); color: #94a3b8; }
    figure img { border-color: #1e293b; }
  }
`

export async function generateReport(session: AgentSessionInfo): Promise<string> {
  const finishedAt = session.log.length ? session.log[session.log.length - 1].ts : session.createdAt
  const edits = session.log.filter((e) => e.kind === 'edit' && e.path)
  const shots = session.log.filter((e) => e.kind === 'screenshot' && e.path)

  const figures: string[] = []
  for (const shot of shots) {
    const uri = await inlineImage(session, shot.path ?? '')
    if (uri) {
      figures.push(
        `<figure><img src="${uri}" alt="${esc(shot.path ?? '')}"><figcaption>${esc(shot.path ?? '')} · ${time(shot.ts)}</figcaption></figure>`
      )
    }
  }

  const html = `<!doctype html>
<html><head><meta charset="utf-8">
<title>Agent report · ${esc(session.task.slice(0, 60))}</title>
<style>${REPORT_CSS}</style></head>
<body>
  <h1>Agent execution report</h1>
  <p><span class="pill ${session.status}">${session.status}</span></p>
  <p class="meta">
    ${esc(session.task)}<br>
    ${session.id} · started ${new Date(session.createdAt).toLocaleString()} ·
    finished ${new Date(finishedAt).toLocaleString()} ·
    workspace ${esc(session.workspacePath ?? '(none)')}
  </p>

  <h2>Plan</h2>
  <ol class="plan">${session.plan
    .map(
      (s) =>
        `<li><span class="g">${PLAN_GLYPHS[s.kind] ?? '·'}</span>${esc(s.title)}${
          s.detail ? ` <span class="d">— ${esc(s.detail)}</span>` : ''
        }</li>`
    )
    .join('')}</ol>

  <h2>Timeline</h2>
  <table>${session.log.map(timelineRow).join('')}</table>

  ${figures.length ? `<h2>Screenshots</h2>${figures.join('')}` : ''}

  ${
    edits.length
      ? `<h2>File changes</h2>${edits
          .map(
            (e) => `<details open><summary>${esc(e.path ?? '')}</summary>
              <div class="diff">
                <div><h4>before</h4><pre>${esc(e.before ?? '')}</pre></div>
                <div><h4>after</h4><pre>${esc(e.after ?? '')}</pre></div>
              </div></details>`
          )
          .join('')}`
      : ''
  }
</body></html>`

  const path = reportPath(session.id)
  await fsp.mkdir(join(artifactsRoot(), session.id), { recursive: true })
  await fsp.writeFile(path, html, 'utf8')
  return path
}
