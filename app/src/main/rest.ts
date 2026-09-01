import type { RestRequest, RestResponse } from '@shared/ipc'
import { IpcChannels } from '@shared/ipc'
import { core } from '../core/rpc'

/**
 * REST client (roadmap C7): a Postman-lite whose requests execute in the core.
 *
 * The renderer is `chrome://webdeck` under a strict CSP — it cannot fetch
 * arbitrary cross-origin URLs, set arbitrary headers, or use arbitrary methods.
 * So the block hands the request here and Node's global `fetch` (undici) does
 * the sending, with none of those restrictions. This is the only reason the
 * feature needs a core domain at all.
 *
 * Unlike `git.ts` this is not the user shelling out to a binary — it is a plain
 * HTTP call — but the shape mirrors that domain exactly: coerce the arguments,
 * never throw, and return a result object with an optional `error`.
 *
 * SSRF note: this is a developer tool, so localhost and LAN targets are allowed
 * on purpose — hitting your own dev server is the whole point. What is refused
 * is a non-http(s) scheme: `file:` would read the disk and `data:` would let a
 * crafted request smuggle bytes back, neither of which is an HTTP request.
 */

/** Abort a request that never answers, so a dead host can't wedge the block. */
const TIMEOUT_MS = 30_000
/** Cap the body we buffer: a multi-GB download must not blow up the core heap. */
const MAX_BODY_BYTES = 5 * 1024 * 1024

/**
 * Well-known cloud/CI metadata endpoints, blocked by default so a REST run
 * inside a cloud sandbox can't pull IAM credentials. This is a hostname/literal-IP
 * blocklist, not a resolved-IP check: a determined user could still reach the
 * metadata service via a rebinding CNAME that resolves to the link-local address.
 * That gap is accepted here — full resolved-IP filtering is a larger change and
 * this is a local dev tool, not a shared server.
 */
const BLOCKED_METADATA_HOSTS = new Set([
  '169.254.169.254', // AWS / GCP / Azure IMDS
  'metadata.google.internal', // GCP
  'metadata', // GCP short name
  'fd00:ec2::254', // AWS IMDS over IPv6
  '[fd00:ec2::254]', // …as a bracketed URL host
  '100.100.100.200' // Alibaba Cloud
])

const ALLOWED_METHODS = new Set(['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS'])
/** Methods that never carry a request body — a body on these is dropped. */
const BODYLESS_METHODS = new Set(['GET', 'HEAD'])

function errorResponse(error: string, timeMs = 0): RestResponse {
  return { status: 0, statusText: '', headers: {}, body: '', timeMs, size: 0, error }
}

/** Read the response body up to the cap, flagging when it was cut short. */
async function readCapped(
  response: Response
): Promise<{ body: string; size: number; truncated: boolean }> {
  const reader = response.body?.getReader()
  if (!reader) return { body: '', size: 0, truncated: false }

  const chunks: Buffer[] = []
  let size = 0
  let truncated = false
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    if (!value) continue
    size += value.byteLength
    if (size > MAX_BODY_BYTES) {
      // Keep only the bytes up to the cap, then stop pulling: no reason to
      // stream (or count) the rest of a response we will not show.
      const keep = MAX_BODY_BYTES - (size - value.byteLength)
      if (keep > 0) chunks.push(Buffer.from(value.subarray(0, keep)))
      truncated = true
      await reader.cancel().catch(() => {})
      break
    }
    chunks.push(Buffer.from(value))
  }
  return { body: Buffer.concat(chunks).toString('utf8'), size, truncated }
}

/**
 * Execute one HTTP request. Never throws: a bad URL, a refused scheme, a
 * timeout, or a network error all come back as `{ error }` so the block renders
 * the reason inline instead of catching a rejection.
 */
export async function sendRequest(req: RestRequest): Promise<RestResponse> {
  const method = req.method.toUpperCase()
  if (!ALLOWED_METHODS.has(method)) return errorResponse(`Unsupported method: ${req.method}`)

  let parsed: URL
  try {
    parsed = new URL(req.url)
  } catch {
    return errorResponse('Enter a valid absolute URL (e.g. https://api.example.com/…).')
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    return errorResponse(`Only http and https URLs are allowed, not ${parsed.protocol}`)
  }
  if (BLOCKED_METADATA_HOSTS.has(parsed.hostname.toLowerCase())) {
    return errorResponse('Requests to cloud metadata endpoints are blocked.')
  }

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS)
  const started = Date.now()
  try {
    const hasBody = req.body != null && req.body !== '' && !BODYLESS_METHODS.has(method)
    const response = await fetch(parsed, {
      method,
      headers: req.headers,
      body: hasBody ? req.body : undefined,
      signal: controller.signal,
      // A REST client inspects what the server actually returns — the 3xx
      // included — rather than silently chasing it somewhere else.
      redirect: 'manual'
    })

    const headers: Record<string, string> = {}
    response.headers.forEach((value, name) => {
      headers[name] = value
    })

    const { body, size, truncated } = await readCapped(response)
    return {
      status: response.status,
      statusText: response.statusText,
      headers,
      body,
      timeMs: Date.now() - started,
      size,
      ...(truncated ? { truncated: true } : {})
    }
  } catch (e) {
    const timeMs = Date.now() - started
    if (controller.signal.aborted) {
      return errorResponse(`Request timed out after ${Math.round(TIMEOUT_MS / 1000)}s.`, timeMs)
    }
    const err = e as { cause?: { message?: string }; message?: string }
    return errorResponse((err.cause?.message || err.message || String(e)).trim(), timeMs)
  } finally {
    clearTimeout(timer)
  }
}

/** Narrow an untrusted request payload into a well-formed RestRequest. */
function coerceRequest(value: unknown): RestRequest {
  const obj = (value ?? {}) as Record<string, unknown>
  const method = typeof obj.method === 'string' ? obj.method : 'GET'
  const url = typeof obj.url === 'string' ? obj.url : ''
  const headers: Record<string, string> = {}
  if (obj.headers && typeof obj.headers === 'object') {
    for (const [name, headerValue] of Object.entries(obj.headers as Record<string, unknown>)) {
      if (typeof headerValue === 'string') headers[name] = headerValue
    }
  }
  const body = typeof obj.body === 'string' ? obj.body : undefined
  return { method, url, headers, body }
}

/** Register the REST-client domain with webdeck-core (roadmap C7). */
export function registerRestRpc(): void {
  core.register(IpcChannels.restSend, (request) => sendRequest(coerceRequest(request)))
}
