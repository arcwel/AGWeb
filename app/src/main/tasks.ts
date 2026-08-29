import fsp from 'node:fs/promises'
import { join } from 'node:path'
import type { TaskDefinition, TaskProblem, TaskRun } from '@shared/tasks'
import { IpcEvents } from '@shared/ipc'
import { broadcast } from './windows'
import { getCurrentWorkspace } from './workspace'
import { runInTerminal, stopTerminal } from './terminal'

/**
 * Tasks (task 12.5).
 *
 * Runs `package.json` scripts and `.vscode/tasks.json` entries, and turns what
 * they print into editor diagnostics. That last part is the whole point: a
 * build error is far more useful as a squiggle on the line that caused it than
 * as a line of text in a terminal the user has to read and then go find.
 *
 * Runs go through the same `runInTerminal` the agent uses, so a task is a real
 * pty the user can watch, scroll and stop — not output captured invisibly.
 */

/**
 * Problem matchers, in VS Code's spelling so a copied `tasks.json` works.
 *
 * Only the shapes that actually differ are separate matchers; most tools emit
 * something the generic `file:line:col: severity: message` pattern already
 * handles.
 */
interface Matcher {
  /** Applied per line; named groups feed the problem. */
  pattern: RegExp
  /** Matchers whose file paths are on a preceding line of their own. */
  fileFromPreviousLine?: RegExp
}

const MATCHERS: Record<string, Matcher> = {
  // src/x.ts(12,5): error TS2322: Type 'a' is not assignable to type 'b'.
  $tsc: {
    pattern:
      /^(?<path>[^\s(].*?)\((?<line>\d+),(?<column>\d+)\):\s+(?<severity>error|warning)\s+(?<code>[A-Z]+\d+):\s+(?<message>.*)$/
  },
  // eslint stylish: the file is a bare line, then indented "12:5  error  msg  rule"
  '$eslint-stylish': {
    pattern:
      /^\s+(?<line>\d+):(?<column>\d+)\s+(?<severity>error|warning)\s+(?<message>.+?)(?:\s\s+(?<code>[\w@/-]+))?$/,
    fileFromPreviousLine: /^(?<path>[^\s].*\.\w+)$/
  },
  // file.py:12:5: message  — the shape most other tools land on.
  $generic: {
    pattern:
      /^(?<path>[^\s:][^:]*):(?<line>\d+):(?<column>\d+):\s*(?:(?<severity>error|warning|info):\s*)?(?<message>.*)$/
  }
}

/** Guess a matcher from the command when the task does not name one. */
function inferMatcher(command: string): string | undefined {
  if (/\btsc\b|type-?check/.test(command)) return '$tsc'
  if (/\beslint\b|\blint\b/.test(command)) return '$eslint-stylish'
  return undefined
}

/** Strip ANSI so a matcher sees the text, not the colour codes. */
// eslint-disable-next-line no-control-regex
const ANSI = /\[[0-9;]*[A-Za-z]/g

export function parseProblems(output: string, matcherId?: string): TaskProblem[] {
  const matcher = matcherId ? MATCHERS[matcherId] : undefined
  if (!matcher) return []

  const problems: TaskProblem[] = []
  let currentFile: string | null = null

  for (const raw of output.split(/\r?\n/)) {
    const line = raw.replace(ANSI, '').trimEnd()
    if (!line) continue

    if (matcher.fileFromPreviousLine) {
      const fileMatch = matcher.fileFromPreviousLine.exec(line)
      if (fileMatch?.groups?.path) {
        currentFile = fileMatch.groups.path
        continue
      }
    }

    const groups = matcher.pattern.exec(line)?.groups
    if (!groups) continue

    const path = groups.path ?? currentFile
    if (!path) continue

    const severity =
      groups.severity === 'warning' ? 'warning' : groups.severity === 'info' ? 'info' : 'error'
    problems.push({
      path: relativize(path),
      line: Number(groups.line) || 1,
      column: Number(groups.column) || 1,
      severity,
      message: groups.message?.trim() ?? '',
      code: groups.code
    })
  }
  return problems
}

/** Tools report a mix of absolute and relative paths; the editor wants relative. */
function relativize(path: string): string {
  const root = getCurrentWorkspace()?.path
  if (root && path.startsWith(root)) return path.slice(root.length).replace(/^\//, '')
  return path.replace(/^\.\//, '')
}

interface VsCodeTask {
  label?: string
  type?: string
  command?: string
  script?: string
  args?: string[]
  problemMatcher?: string | string[]
}

/**
 * Every runnable task in the workspace.
 *
 * `package.json` scripts come first because that is what most projects
 * actually use; `.vscode/tasks.json` is read so an existing VS Code setup
 * keeps working without being rewritten.
 */
export async function listTasks(): Promise<TaskDefinition[]> {
  const root = getCurrentWorkspace()?.path
  if (!root) return []
  const tasks: TaskDefinition[] = []

  try {
    const pkg = JSON.parse(await fsp.readFile(join(root, 'package.json'), 'utf8')) as {
      scripts?: Record<string, string>
    }
    for (const [name, script] of Object.entries(pkg.scripts ?? {})) {
      tasks.push({
        name,
        command: `npm run ${name}`,
        source: 'package.json',
        matcher: inferMatcher(`${name} ${script}`)
      })
    }
  } catch {
    // No package.json, or it is not valid JSON — tasks.json may still have some.
  }

  try {
    const raw = await fsp.readFile(join(root, '.vscode', 'tasks.json'), 'utf8')
    // tasks.json is JSON with comments; strip them rather than failing outright.
    const stripped = raw.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|\s)\/\/.*$/gm, '$1')
    const parsed = JSON.parse(stripped) as { tasks?: VsCodeTask[] }
    for (const task of parsed.tasks ?? []) {
      const name = task.label ?? task.script ?? task.command
      if (!name) continue
      const command =
        task.type === 'npm' && task.script
          ? `npm run ${task.script}`
          : [task.command, ...(task.args ?? [])].filter(Boolean).join(' ')
      if (!command) continue
      const matcher = Array.isArray(task.problemMatcher)
        ? task.problemMatcher[0]
        : task.problemMatcher
      tasks.push({
        name,
        command,
        source: 'tasks.json',
        matcher: matcher ?? inferMatcher(command)
      })
    }
  } catch {
    // No tasks.json, or unparseable even after stripping comments.
  }

  return tasks
}

const runs = new Map<string, TaskRun>()

export function listTaskRuns(): TaskRun[] {
  return [...runs.values()]
}

/**
 * Start a task.
 *
 * Returns as soon as the pty exists so the terminal appears immediately; the
 * problems are broadcast when the command exits.
 */
export async function runTask(name: string): Promise<TaskRun> {
  const root = getCurrentWorkspace()?.path
  if (!root) return { task: name, terminalId: '', problems: [], error: 'No workspace open.' }

  const task = (await listTasks()).find((t) => t.name === name)
  if (!task) return { task: name, terminalId: '', problems: [], error: `No task named '${name}'.` }

  // A re-run replaces the previous one, including its problems: stale
  // diagnostics from a build two edits ago are worse than none.
  const previous = runs.get(name)
  if (previous && previous.exitCode === undefined) stopTerminal(previous.terminalId)

  const { sessionId, done } = runInTerminal(task.command, root, () => {})
  const run: TaskRun = { task: name, terminalId: sessionId, problems: [] }
  runs.set(name, run)
  broadcast(IpcEvents.taskUpdate, run, null)

  void done.then(({ code, output }) => {
    const finished: TaskRun = {
      ...run,
      exitCode: code,
      problems: parseProblems(output, task.matcher)
    }
    runs.set(name, finished)
    broadcast(IpcEvents.taskUpdate, finished, null)
  })

  return run
}

export function stopTask(name: string): void {
  const run = runs.get(name)
  if (run && run.exitCode === undefined) stopTerminal(run.terminalId)
}
