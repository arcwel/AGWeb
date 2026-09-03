import { useCallback, useMemo, useRef, useState } from 'react'
import type { RestRequest, RestResponse } from '@shared/ipc'
import { useShellStore } from '@/store'
import { JsonTree } from '@/components/JsonTree'
import { CloseIcon, SendIcon } from '@/components/icons'

/**
 * REST client (roadmap C7): a Postman-lite Deck block.
 *
 * The request never leaves the renderer as a real `fetch` — `chrome://webdeck`
 * runs under a strict CSP that forbids arbitrary cross-origin calls, headers and
 * methods. Instead the block assembles a RestRequest and hands it to the core
 * (`window.agweb.rest.send`), which sends it with Node's `fetch` and streams the
 * response back. So everything here is pure UI: build the request, show what
 * came back, and keep a small history to replay.
 */

const METHODS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS'] as const
type Method = (typeof METHODS)[number]

/** Methods for which the Body tab is meaningful; others send no body. */
const BODY_METHODS = new Set<Method>(['POST', 'PUT', 'PATCH', 'DELETE'])

const HISTORY_CAP = 20

/** One editable header row. Carries a stable id so the list key is never an index. */
interface HeaderRow {
  id: string
  name: string
  value: string
}

/** A replayable past request. Persisted per workspace. */
interface HistoryItem {
  id: string
  method: Method
  url: string
  headers: HeaderRow[]
  body: string
  bodyMode: BodyMode
  status: number
  error?: string
}

type BodyMode = 'json' | 'text'
type Tab = 'headers' | 'body'

let nextRowId = 1
let nextHistoryId = 1
const makeRow = (name = '', value = ''): HeaderRow => ({ id: `hdr-${nextRowId++}`, name, value })

const historyKey = (workspacePath: string | null): string =>
  `agweb.rest.history:${workspacePath ?? 'default'}`

function loadHistory(workspacePath: string | null): HistoryItem[] {
  try {
    const raw = localStorage.getItem(historyKey(workspacePath))
    if (!raw) return []
    const parsed = JSON.parse(raw) as HistoryItem[]
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

function saveHistory(workspacePath: string | null, items: HistoryItem[]): void {
  try {
    localStorage.setItem(historyKey(workspacePath), JSON.stringify(items))
  } catch {
    // storage unavailable — history just won't persist
  }
}

/** Green/amber/red by status class; 0 is a client-side failure (no response). */
function statusColor(status: number): string {
  if (status === 0) return 'text-rose-500'
  if (status < 300) return 'text-emerald-600 dark:text-emerald-400'
  if (status < 400) return 'text-sky-600 dark:text-sky-400'
  if (status < 500) return 'text-amber-600 dark:text-amber-400'
  return 'text-rose-600 dark:text-rose-400'
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`
}

/** Try to read a body as JSON: explicit content-type wins, else sniff the text. */
function parseJsonBody(body: string, contentType: string | undefined): unknown | undefined {
  const looksJson = contentType?.toLowerCase().includes('json') ?? false
  const trimmed = body.trim()
  const sniffed = trimmed.startsWith('{') || trimmed.startsWith('[')
  if (!looksJson && !sniffed) return undefined
  try {
    return JSON.parse(body)
  } catch {
    return undefined
  }
}

export function RestClientBlock(): React.JSX.Element {
  const workspace = useShellStore((s) => s.workspace)
  const workspacePath = workspace?.path ?? null

  const [method, setMethod] = useState<Method>('GET')
  const [url, setUrl] = useState('')
  const [headers, setHeaders] = useState<HeaderRow[]>([makeRow()])
  const [body, setBody] = useState('')
  const [bodyMode, setBodyMode] = useState<BodyMode>('json')
  const [tab, setTab] = useState<Tab>('headers')

  const [sending, setSending] = useState(false)
  const [response, setResponse] = useState<RestResponse | null>(null)

  // A token bumped whenever the form is rewritten out from under an in-flight
  // send (a history reload). The send captures it at start and discards its
  // response if the token moved, so a late reply can't land against a form that
  // now describes a different request.
  const sendGenRef = useRef(0)

  // History is workspace-scoped, so key the initial read to the current path and
  // reset when the workspace changes. A ref tracks the path the loaded history
  // belongs to so a workspace switch re-reads rather than saving into the wrong key.
  const [history, setHistory] = useState<HistoryItem[]>(() => loadHistory(workspacePath))
  const loadedPath = useRef(workspacePath)
  if (loadedPath.current !== workspacePath) {
    loadedPath.current = workspacePath
    setHistory(loadHistory(workspacePath))
  }

  const canSend = url.trim().length > 0 && !sending
  const showBodyTab = BODY_METHODS.has(method)

  const send = useCallback(async (): Promise<void> => {
    const trimmedUrl = url.trim()
    if (!trimmedUrl) return
    const gen = sendGenRef.current
    setSending(true)
    setResponse(null)

    const headerMap: Record<string, string> = {}
    for (const row of headers) {
      const name = row.name.trim()
      if (name) headerMap[name] = row.value
    }
    // Default a JSON body's content-type when the user didn't set one — a
    // convenience Postman also does, and easy to override with an explicit row.
    const usesBody = BODY_METHODS.has(method) && body.length > 0
    if (
      usesBody &&
      bodyMode === 'json' &&
      !Object.keys(headerMap).some((h) => /content-type/i.test(h))
    ) {
      headerMap['Content-Type'] = 'application/json'
    }

    const request: RestRequest = {
      method,
      url: trimmedUrl,
      headers: headerMap,
      body: usesBody ? body : undefined
    }

    const result = await window.agweb.rest.send(request)
    // A history reload rewrote the form while this was in flight — its response
    // belongs to the old request, so drop it rather than mismatching the form.
    if (sendGenRef.current !== gen) return
    setResponse(result)
    setSending(false)

    const item: HistoryItem = {
      id: `req-${nextHistoryId++}`,
      method,
      url: trimmedUrl,
      headers: headers.filter((row) => row.name.trim() || row.value.trim()),
      body,
      bodyMode,
      status: result.status,
      error: result.error
    }
    setHistory((prev) => {
      const next = [item, ...prev].slice(0, HISTORY_CAP)
      saveHistory(workspacePath, next)
      return next
    })
  }, [url, headers, method, body, bodyMode, workspacePath])

  const reload = useCallback((item: HistoryItem): void => {
    // Invalidate any in-flight send: its response describes the request we're
    // replacing, and clear the sending flag so the reloaded form can be re-sent.
    sendGenRef.current += 1
    setSending(false)
    setMethod(item.method)
    setUrl(item.url)
    setHeaders(
      item.headers.length ? item.headers.map((h) => makeRow(h.name, h.value)) : [makeRow()]
    )
    setBody(item.body)
    setBodyMode(item.bodyMode)
    setTab(BODY_METHODS.has(item.method) ? 'body' : 'headers')
  }, [])

  const clearHistory = useCallback((): void => {
    setHistory([])
    saveHistory(workspacePath, [])
  }, [workspacePath])

  const setHeaderRow = (id: string, patch: Partial<HeaderRow>): void =>
    setHeaders((prev) => prev.map((row) => (row.id === id ? { ...row, ...patch } : row)))
  const addHeaderRow = (): void => setHeaders((prev) => [...prev, makeRow()])
  const removeHeaderRow = (id: string): void =>
    setHeaders((prev) => {
      const next = prev.filter((row) => row.id !== id)
      return next.length ? next : [makeRow()]
    })

  return (
    <div className="flex h-full min-h-0 text-xs">
      <div className="flex min-w-0 flex-1 flex-col">
        <RequestBar
          method={method}
          url={url}
          canSend={canSend}
          sending={sending}
          onMethod={setMethod}
          onUrl={setUrl}
          onSend={() => void send()}
        />
        <TabBar tab={tab} showBodyTab={showBodyTab} onTab={setTab} />

        <div className="min-h-0 flex-none border-b border-slate-200 dark:border-slate-800">
          {tab === 'headers' ? (
            <HeadersEditor
              rows={headers}
              onChange={setHeaderRow}
              onAdd={addHeaderRow}
              onRemove={removeHeaderRow}
            />
          ) : (
            <BodyEditor value={body} mode={bodyMode} onValue={setBody} onMode={setBodyMode} />
          )}
        </div>

        <ResponsePane sending={sending} response={response} />
      </div>

      <HistoryPane history={history} onReload={reload} onClear={clearHistory} />
    </div>
  )
}

function RequestBar({
  method,
  url,
  canSend,
  sending,
  onMethod,
  onUrl,
  onSend
}: {
  method: Method
  url: string
  canSend: boolean
  sending: boolean
  onMethod: (method: Method) => void
  onUrl: (url: string) => void
  onSend: () => void
}): React.JSX.Element {
  return (
    <div className="flex flex-none items-center gap-1.5 border-b border-slate-200 p-2 dark:border-slate-800">
      <select
        value={method}
        onChange={(e) => onMethod(e.target.value as Method)}
        aria-label="HTTP method"
        className="flex-none rounded-md border border-slate-300 bg-slate-50 px-1.5 py-1 font-mono text-[11px] font-semibold outline-none focus:border-sky-500 dark:border-slate-700 dark:bg-[#0b0f14]"
      >
        {METHODS.map((m) => (
          <option key={m} value={m}>
            {m}
          </option>
        ))}
      </select>
      <input
        value={url}
        onChange={(e) => onUrl(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && canSend) onSend()
        }}
        placeholder="https://api.example.com/endpoint"
        aria-label="Request URL"
        spellCheck={false}
        className="min-w-0 flex-1 rounded-md border border-slate-300 bg-slate-50 px-2 py-1 font-mono text-[11px] outline-none focus:border-sky-500 dark:border-slate-700 dark:bg-[#0b0f14]"
      />
      <button
        onClick={onSend}
        disabled={!canSend}
        data-testid="rest-send"
        className="flex flex-none items-center gap-1 rounded-md bg-sky-600 px-2.5 py-1 text-[11px] font-semibold text-white hover:bg-sky-500 disabled:opacity-40"
      >
        {sending ? <Spinner /> : <SendIcon size={13} />}
        {sending ? 'Sending' : 'Send'}
      </button>
    </div>
  )
}

function TabBar({
  tab,
  showBodyTab,
  onTab
}: {
  tab: Tab
  showBodyTab: boolean
  onTab: (tab: Tab) => void
}): React.JSX.Element {
  const tabClass = (active: boolean): string =>
    `px-3 py-1.5 text-[11px] font-semibold ${
      active
        ? 'border-b-2 border-sky-500 text-slate-700 dark:text-slate-200'
        : 'text-slate-500 hover:text-slate-700 dark:hover:text-slate-300'
    }`
  return (
    <div className="flex flex-none items-center border-b border-slate-200 dark:border-slate-800">
      <button className={tabClass(tab === 'headers')} onClick={() => onTab('headers')}>
        Headers
      </button>
      {showBodyTab && (
        <button className={tabClass(tab === 'body')} onClick={() => onTab('body')}>
          Body
        </button>
      )}
    </div>
  )
}

function HeadersEditor({
  rows,
  onChange,
  onAdd,
  onRemove
}: {
  rows: HeaderRow[]
  onChange: (id: string, patch: Partial<HeaderRow>) => void
  onAdd: () => void
  onRemove: (id: string) => void
}): React.JSX.Element {
  const cell =
    'min-w-0 flex-1 rounded border border-slate-300 bg-slate-50 px-2 py-1 font-mono text-[11px] outline-none focus:border-sky-500 dark:border-slate-700 dark:bg-[#0b0f14]'
  return (
    <div className="max-h-40 overflow-auto p-2">
      <div className="flex flex-col gap-1.5">
        {rows.map((row) => (
          <div key={row.id} className="flex items-center gap-1.5">
            <input
              value={row.name}
              onChange={(e) => onChange(row.id, { name: e.target.value })}
              placeholder="Header"
              spellCheck={false}
              className={cell}
            />
            <input
              value={row.value}
              onChange={(e) => onChange(row.id, { value: e.target.value })}
              placeholder="Value"
              spellCheck={false}
              className={cell}
            />
            <button
              onClick={() => onRemove(row.id)}
              aria-label="Remove header"
              className="flex-none rounded p-1 text-slate-400 hover:bg-slate-100 hover:text-rose-500 dark:hover:bg-slate-800"
            >
              <CloseIcon size={11} />
            </button>
          </div>
        ))}
      </div>
      <button
        onClick={onAdd}
        className="mt-1.5 rounded px-2 py-0.5 text-[11px] font-semibold text-sky-600 hover:bg-sky-500/10 dark:text-sky-400"
      >
        + Add header
      </button>
    </div>
  )
}

function BodyEditor({
  value,
  mode,
  onValue,
  onMode
}: {
  value: string
  mode: BodyMode
  onValue: (value: string) => void
  onMode: (mode: BodyMode) => void
}): React.JSX.Element {
  const toggle = (m: BodyMode): string =>
    `rounded px-2 py-0.5 text-[10px] font-semibold ${
      mode === m
        ? 'bg-sky-500/15 text-sky-600 dark:text-sky-300'
        : 'text-slate-500 hover:text-slate-700 dark:hover:text-slate-300'
    }`
  return (
    <div className="flex max-h-40 flex-col p-2">
      <div className="mb-1.5 flex flex-none items-center gap-1">
        <button className={toggle('json')} onClick={() => onMode('json')}>
          JSON
        </button>
        <button className={toggle('text')} onClick={() => onMode('text')}>
          Text
        </button>
      </div>
      <textarea
        value={value}
        onChange={(e) => onValue(e.target.value)}
        placeholder={mode === 'json' ? '{\n  "key": "value"\n}' : 'Request body…'}
        spellCheck={false}
        className="h-28 w-full resize-none rounded border border-slate-300 bg-slate-50 px-2 py-1.5 font-mono text-[11px] outline-none focus:border-sky-500 dark:border-slate-700 dark:bg-[#0b0f14]"
      />
    </div>
  )
}

function ResponsePane({
  sending,
  response
}: {
  sending: boolean
  response: RestResponse | null
}): React.JSX.Element {
  if (sending && !response) {
    return (
      <div className="flex min-h-0 flex-1 items-center justify-center gap-2 text-slate-400">
        <Spinner />
        <span>Waiting for response…</span>
      </div>
    )
  }
  if (!response) {
    return (
      <div className="flex min-h-0 flex-1 items-center justify-center p-4 text-center text-slate-400">
        Build a request above and press Send.
      </div>
    )
  }
  if (response.error) {
    return (
      <div className="flex min-h-0 flex-1 flex-col gap-1 p-4">
        <span className="font-semibold text-rose-500">Request failed</span>
        <span className="leading-relaxed text-slate-500">{response.error}</span>
      </div>
    )
  }

  const contentType = response.headers['content-type']
  const json = parseJsonBody(response.body, contentType)

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex flex-none flex-wrap items-center gap-3 border-b border-slate-200 px-3 py-1.5 dark:border-slate-800">
        <span className={`font-mono text-[12px] font-bold ${statusColor(response.status)}`}>
          {response.status} {response.statusText}
        </span>
        <span className="text-[10px] text-slate-400">{response.timeMs} ms</span>
        <span className="text-[10px] text-slate-400">{formatBytes(response.size)}</span>
        {response.truncated && (
          <span className="text-[10px] font-semibold text-amber-500">body truncated</span>
        )}
      </div>

      <ResponseHeaders headers={response.headers} />

      <div className="min-h-0 flex-1 overflow-hidden">
        {json !== undefined ? (
          <JsonTree data={json} />
        ) : (
          <pre className="h-full overflow-auto whitespace-pre-wrap break-words p-3 font-mono text-[11px] text-slate-700 dark:text-slate-300">
            {response.body || <span className="text-slate-400">(empty body)</span>}
          </pre>
        )}
      </div>
    </div>
  )
}

function ResponseHeaders({ headers }: { headers: Record<string, string> }): React.JSX.Element {
  const [open, setOpen] = useState(false)
  const entries = useMemo(() => Object.entries(headers), [headers])
  if (entries.length === 0) return <></>
  return (
    <div className="flex-none border-b border-slate-200 dark:border-slate-800">
      <button
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center gap-1.5 px-3 py-1 text-left text-[11px] font-semibold text-slate-500 hover:text-slate-700 dark:hover:text-slate-300"
      >
        <span className="w-2.5 text-slate-400">{open ? '▾' : '▸'}</span>
        Response headers
        <span className="text-[10px] font-normal text-slate-400">({entries.length})</span>
      </button>
      {open && (
        <div className="max-h-28 overflow-auto px-3 pb-1.5 font-mono text-[10px]">
          {entries.map(([name, value]) => (
            <div key={name} className="flex gap-2 py-px">
              <span className="flex-none text-sky-700 dark:text-sky-300">{name}:</span>
              <span className="min-w-0 break-all text-slate-600 dark:text-slate-400">{value}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

function HistoryPane({
  history,
  onReload,
  onClear
}: {
  history: HistoryItem[]
  onReload: (item: HistoryItem) => void
  onClear: () => void
}): React.JSX.Element {
  return (
    <div className="flex w-44 max-w-[45%] min-w-0 flex-none flex-col border-l border-slate-200 dark:border-slate-800">
      <div className="flex flex-none items-center gap-1 border-b border-slate-200 px-2.5 py-1.5 dark:border-slate-800">
        <span className="font-semibold text-slate-500">History</span>
        {history.length > 0 && (
          <button
            onClick={onClear}
            className="ml-auto rounded px-1 text-[10px] text-slate-400 hover:text-rose-500"
          >
            Clear
          </button>
        )}
      </div>
      <div className="min-h-0 flex-1 overflow-auto">
        {history.length === 0 ? (
          <div className="p-3 text-[10px] text-slate-400">No requests yet.</div>
        ) : (
          history.map((item) => (
            <button
              key={item.id}
              onClick={() => onReload(item)}
              title={item.url}
              className="flex w-full flex-col gap-0.5 border-b border-slate-100 px-2.5 py-1.5 text-left hover:bg-slate-500/10 dark:border-slate-800/60"
            >
              <span className="flex items-center gap-1.5">
                <span className="flex-none font-mono text-[9px] font-bold text-slate-500">
                  {item.method}
                </span>
                <span className={`flex-none font-mono text-[9px] ${statusColor(item.status)}`}>
                  {item.error ? 'ERR' : item.status}
                </span>
              </span>
              <span className="truncate font-mono text-[10px] text-slate-600 dark:text-slate-400">
                {item.url}
              </span>
            </button>
          ))
        )}
      </div>
    </div>
  )
}

function Spinner(): React.JSX.Element {
  return (
    <svg width={12} height={12} viewBox="0 0 24 24" className="animate-spin" aria-hidden="true">
      <circle
        cx="12"
        cy="12"
        r="9"
        fill="none"
        stroke="currentColor"
        strokeWidth="3"
        strokeOpacity="0.25"
      />
      <path
        d="M12 3a9 9 0 0 1 9 9"
        fill="none"
        stroke="currentColor"
        strokeWidth="3"
        strokeLinecap="round"
      />
    </svg>
  )
}
