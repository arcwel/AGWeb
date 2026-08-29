import { useEffect, useState } from 'react'
import type { AiProvider, SecretsStatus } from '@shared/ipc'

/**
 * AI providers.
 *
 * Where the API keys for the built-in agent live, and where more can be added.
 * The keys are held encrypted in the OS keychain by the main process (see
 * secrets.ts) — this panel only ever sends a key down and asks back which
 * providers are configured, so a saved key is never read back into the
 * renderer or shown again.
 *
 * Account sign-in (OAuth with a Claude / ChatGPT / Gemini subscription instead
 * of a pay-as-you-go API key) is a larger, provider-specific flow; it is
 * flagged here as the next step rather than faked with a dead button.
 */

interface ProviderMeta {
  id: AiProvider
  name: string
  hint: string
  keyPrefix: string
  keysUrl: string
}

const PROVIDERS: ProviderMeta[] = [
  {
    id: 'anthropic',
    name: 'Anthropic (Claude)',
    hint: 'Powers the built-in agent. Keys start with sk-ant-.',
    keyPrefix: 'sk-ant-',
    keysUrl: 'https://console.anthropic.com/settings/keys'
  },
  {
    id: 'openai',
    name: 'OpenAI (GPT)',
    hint: 'For GPT-backed tools. Keys start with sk-.',
    keyPrefix: 'sk-',
    keysUrl: 'https://platform.openai.com/api-keys'
  },
  {
    id: 'gemini',
    name: 'Google (Gemini)',
    hint: 'For Gemini-backed tools.',
    keyPrefix: 'AI',
    keysUrl: 'https://aistudio.google.com/app/apikey'
  }
]

export function AiSettings(): React.JSX.Element {
  const [status, setStatus] = useState<SecretsStatus | null>(null)

  const refresh = (): void => {
    void window.agweb.secrets.list().then(setStatus)
  }
  useEffect(refresh, [])

  return (
    <div className="flex flex-col gap-3 p-3 text-[12px]">
      {status && !status.encryptionAvailable && (
        <p className="rounded-lg bg-amber-500/10 px-3 py-2 text-[11px] text-amber-600 dark:text-amber-400">
          This system has no OS keychain available, so API keys can’t be stored securely and saving
          is disabled. Set the provider’s environment variable instead.
        </p>
      )}

      {PROVIDERS.map((provider) => (
        <ProviderRow
          key={provider.id}
          provider={provider}
          configured={status?.configured[provider.id] ?? false}
          canSave={status?.encryptionAvailable ?? false}
          onChange={refresh}
        />
      ))}

      <section className="mt-1 rounded-lg border border-dashed border-[var(--wd-glass-border)] px-3 py-2">
        <h3 className="text-[11px] font-semibold text-[var(--wd-text)]">
          Sign in with your account
        </h3>
        <p className="mt-0.5 text-[11px] text-[var(--wd-dim)]">
          Using a Claude, ChatGPT, or Gemini subscription instead of a pay-as-you-go API key needs
          each provider’s OAuth flow. It’s on the roadmap — for now, paste an API key above.
        </p>
      </section>
    </div>
  )
}

function ProviderRow({
  provider,
  configured,
  canSave,
  onChange
}: {
  provider: ProviderMeta
  configured: boolean
  canSave: boolean
  onChange: () => void
}): React.JSX.Element {
  const [value, setValue] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const save = async (): Promise<void> => {
    setBusy(true)
    setError(null)
    const ok = await window.agweb.secrets.set(provider.id, value)
    setBusy(false)
    if (!ok) {
      setError('Could not save the key. Is the OS keychain available?')
      return
    }
    setValue('')
    onChange()
  }

  const clear = async (): Promise<void> => {
    await window.agweb.secrets.clear(provider.id)
    onChange()
  }

  return (
    <section className="rounded-lg bg-[var(--wd-well)] px-3 py-2.5">
      <div className="flex items-center gap-2">
        <span className="font-semibold text-[var(--wd-text)]">{provider.name}</span>
        {configured && (
          <span className="rounded-full bg-emerald-500/15 px-1.5 py-0.5 text-[9.5px] font-semibold uppercase text-emerald-500">
            Configured
          </span>
        )}
      </div>
      <p className="mt-0.5 text-[11px] text-[var(--wd-dim)]">{provider.hint}</p>

      <div className="mt-2 flex items-center gap-1.5">
        <input
          type="password"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          placeholder={configured ? 'Replace saved key…' : `${provider.keyPrefix}…`}
          disabled={!canSave}
          className="min-w-0 flex-1 rounded-md border border-[var(--wd-glass-border)] bg-[var(--wd-field)] px-2 py-1 text-[11px] outline-none focus:border-[var(--wd-accent)] disabled:opacity-40"
          autoComplete="off"
          spellCheck={false}
        />
        <button
          onClick={() => void save()}
          disabled={!canSave || busy || value.trim() === ''}
          className="rounded-md bg-[var(--wd-accent)] px-2.5 py-1 text-[11px] font-semibold text-[var(--wd-accent-ink)] disabled:opacity-40"
        >
          {busy ? 'Saving…' : 'Save'}
        </button>
        {configured && (
          <button
            onClick={() => void clear()}
            className="rounded-md px-2 py-1 text-[11px] font-medium text-[var(--wd-dim)] hover:text-rose-500"
          >
            Remove
          </button>
        )}
      </div>

      {error && <p className="mt-1 text-[11px] text-rose-500">{error}</p>}
    </section>
  )
}
