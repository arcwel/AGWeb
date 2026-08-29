import { useEffect, useState } from 'react'
import type { TaskDefinition, TaskRun } from '@shared/tasks'
import { ensureModel, monaco } from '@/monaco'
import { useShellStore } from '@/store'
import { InlineTerminal } from '@/components/InlineTerminal'

/**
 * Tasks (task 12.5).
 *
 * Lists what the workspace can run and runs it, showing the live terminal in
 * place. When a task exits, whatever its output said becomes editor
 * diagnostics — a build error is more useful as a squiggle on the offending
 * line than as text in a terminal the user has to read and then go find.
 */

/** Marker owner, so task problems can be replaced without touching LSP ones. */
const MARKER_OWNER = 'agweb.tasks'

const SEVERITIES = {
  error: monaco.MarkerSeverity.Error,
  warning: monaco.MarkerSeverity.Warning,
  info: monaco.MarkerSeverity.Info
} as const

export function TasksBlock(): React.JSX.Element {
  const workspace = useShellStore((s) => s.workspace)
  const openFile = useShellStore((s) => s.openFile)
  const [tasks, setTasks] = useState<TaskDefinition[]>([])
  const [runs, setRuns] = useState<Record<string, TaskRun>>({})

  useEffect(() => {
    let live = true
    void window.agweb.tasks.list().then((next) => {
      if (live) setTasks(next)
    })
    void window.agweb.tasks.runs().then((next) => {
      if (live) setRuns(Object.fromEntries(next.map((r) => [r.task, r])))
    })
    return () => {
      live = false
    }
  }, [workspace?.path])

  useEffect(
    () =>
      window.agweb.tasks.onUpdate((run) => {
        setRuns((prev) => ({ ...prev, [run.task]: run }))
        if (run.exitCode !== undefined) void applyMarkers(run)
      }),
    []
  )

  const allProblems = Object.values(runs).flatMap((run) =>
    run.problems.map((problem) => ({ ...problem, task: run.task }))
  )

  return (
    <div className="flex h-full flex-col text-xs">
      <div className="min-h-0 flex-1 overflow-y-auto">
        {tasks.length === 0 && (
          <div className="flex flex-col gap-2 p-4 text-slate-500">
            <span className="text-[13px] font-semibold text-slate-600 dark:text-slate-300">
              Nothing to run here
            </span>
            <span className="leading-relaxed">
              Tasks come from <span className="font-mono">package.json</span> scripts and{' '}
              <span className="font-mono">.vscode/tasks.json</span>.
            </span>
          </div>
        )}

        {tasks.map((task) => {
          const run = runs[task.name]
          const running = run !== undefined && run.exitCode === undefined && run.terminalId !== ''
          return (
            <div key={task.name} className="border-b border-slate-200 dark:border-slate-800">
              <div className="flex items-center gap-2 px-2.5 py-1.5">
                <button
                  onClick={() =>
                    running
                      ? void window.agweb.tasks.stop(task.name)
                      : void window.agweb.tasks.run(task.name)
                  }
                  className={`flex-none rounded border px-1.5 py-0.5 text-[10px] font-semibold ${
                    running
                      ? 'border-amber-400/60 text-amber-600 hover:bg-amber-50 dark:text-amber-400 dark:hover:bg-amber-500/10'
                      : 'border-slate-300 text-slate-500 hover:bg-slate-100 dark:border-slate-600 dark:hover:bg-slate-800'
                  }`}
                  data-testid={`task-run-${task.name}`}
                >
                  {running ? 'Stop' : 'Run'}
                </button>
                <span className="min-w-0 flex-1 truncate font-medium text-slate-700 dark:text-slate-200">
                  {task.name}
                </span>
                {run?.exitCode !== undefined && (
                  <span
                    className={`flex-none font-mono text-[10px] ${
                      run.exitCode === 0 ? 'text-emerald-500' : 'text-amber-500'
                    }`}
                  >
                    {run.exitCode === 0 ? 'passed' : `exit ${run.exitCode}`}
                  </span>
                )}
                <span
                  className="flex-none font-mono text-[10px] text-slate-400"
                  title={task.command}
                >
                  {task.source === 'tasks.json' ? 'tasks.json' : 'npm'}
                </span>
              </div>

              {run?.terminalId && (
                <div className="px-2.5 pb-2">
                  <InlineTerminal
                    terminalId={run.terminalId}
                    command={task.command}
                    exitCode={run.exitCode}
                  />
                </div>
              )}
            </div>
          )
        })}
      </div>

      {allProblems.length > 0 && (
        <div className="max-h-48 flex-none overflow-y-auto border-t border-slate-200 dark:border-slate-800">
          <div className="sticky top-0 border-b border-slate-200 bg-white px-2.5 py-1 text-[10px] font-bold uppercase tracking-wider text-slate-400 dark:border-slate-800 dark:bg-[#0e1420]">
            Problems ({allProblems.length})
          </div>
          {allProblems.map((problem, i) => (
            <button
              key={i}
              onClick={() => openFile(problem.path, problem.line)}
              className="flex w-full items-start gap-2 px-2.5 py-1 text-left hover:bg-slate-50 dark:hover:bg-slate-900"
              data-testid="task-problem"
            >
              <span
                className={`mt-0.5 h-1.5 w-1.5 flex-none rounded-full ${
                  problem.severity === 'error' ? 'bg-rose-500' : 'bg-amber-500'
                }`}
              />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-slate-600 dark:text-slate-300">
                  {problem.message}
                </span>
                <span className="block truncate font-mono text-[10px] text-slate-400">
                  {problem.path}:{problem.line}
                  {problem.code ? ` · ${problem.code}` : ''}
                </span>
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

/**
 * Put a finished run's problems on the editor as markers.
 *
 * Models are created for files that are not open, so a build error squiggles
 * the moment the user opens the file rather than only if it happened to be
 * open when the task ran. Markers are set per file under our own owner, which
 * is what keeps them from fighting with the language server's (12.2).
 */
async function applyMarkers(run: TaskRun): Promise<void> {
  const byPath = new Map<string, TaskRun['problems']>()
  for (const problem of run.problems) {
    const list = byPath.get(problem.path) ?? []
    list.push(problem)
    byPath.set(problem.path, list)
  }

  // Clear this owner's markers everywhere first, so a fixed error disappears.
  for (const model of monaco.editor.getModels()) {
    monaco.editor.setModelMarkers(model, MARKER_OWNER, [])
  }

  for (const [path, problems] of byPath) {
    const model = await ensureModel(path)
    if (!model) continue
    monaco.editor.setModelMarkers(
      model,
      MARKER_OWNER,
      problems.map((problem) => ({
        severity: SEVERITIES[problem.severity],
        message: problem.code ? `${problem.message} (${problem.code})` : problem.message,
        startLineNumber: problem.line,
        startColumn: problem.column,
        endLineNumber: problem.line,
        // The tools give a point, not a range; to the end of the line reads
        // better than a one-character squiggle.
        endColumn: model.getLineMaxColumn(Math.min(problem.line, model.getLineCount()))
      }))
    )
  }
}
