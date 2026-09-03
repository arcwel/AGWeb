import { useEffect, useState } from 'react'
import type { CustomPolicyRules, PermissionMode, PolicyDecision, PolicyStatus } from '@shared/ipc'
import { POLICY_GUARDS } from '@shared/ipc'

/**
 * The one place every permission decision lives: the mode, the guards, custom
 * rules, and the standing per-site decisions. Opened from the permission pill
 * beside the model pill in the composer (the per-run decision, made where the
 * run starts) and from the shield in the Agents header.
 */
export const MODES: { id: PermissionMode; label: string; hint: string }[] = [
  { id: 'secure', label: 'Secure', hint: 'confirm everything' },
  { id: 'review', label: 'Review-driven', hint: 'writes auto, the rest confirms' },
  { id: 'agent', label: 'Agent-driven', hint: 'autonomous in the workspace' },
  { id: 'autonomous', label: 'Full autonomy', hint: 'never asks; the audit log is the record' },
  { id: 'custom', label: 'Custom', hint: 'your rules' }
]

const DECISIONS: PolicyDecision[] = ['allow', 'confirm', 'deny']

/** Live policy status, shared by the pill and the popover. */
export function usePolicyStatus(): PolicyStatus | null {
  const [policy, setPolicy] = useState<PolicyStatus | null>(null)
  useEffect(() => {
    let cancelled = false
    void window.agweb.policy.get().then((status) => {
      // The window can close before this async read resolves: guard the
      // setState so it never fires on an unmounted component.
      if (!cancelled) setPolicy(status)
    })
    // Reflect changes made in any other window so this never goes stale.
    const off = window.agweb.policy.onChanged(setPolicy)
    return () => {
      cancelled = true
      off()
    }
  }, [])
  return policy
}

/** "Full autonomy · 2 guards" — what the pill reads. */
export function policySummary(policy: PolicyStatus): string {
  const mode = MODES.find((m) => m.id === policy.mode)?.label ?? policy.mode
  const on = POLICY_GUARDS.filter((g) => policy.guards[g.id]).length
  return on > 0 ? `${mode} · ${on} guard${on === 1 ? '' : 's'}` : mode
}

/**
 * The guards only change something where the mode does not already confirm
 * every navigation: Secure and Review-driven ask about every remote site
 * anyway. They still apply under those modes (the engine checks guards before
 * the mode); the popover just does not pretend the switch changes anything.
 */
function guardsApply(mode: PermissionMode): boolean {
  return mode === 'agent' || mode === 'autonomous' || mode === 'custom'
}

export function PermissionPopover({
  policy,
  className
}: {
  policy: PolicyStatus
  className?: string
}): React.JSX.Element {
  // The hosts field: what the user is typing, else what the policy holds. A
  // draft is cleared once committed, so an edit made in another window shows
  // through as soon as this one stops typing.
  const [hostsDraft, setHostsDraft] = useState<string | null>(null)
  const hosts = hostsDraft ?? policy.custom.allowedHosts.join(', ')
  const setHosts = setHostsDraft

  const setMode = (mode: PermissionMode): void => {
    void window.agweb.policy.setMode(mode)
  }
  const setCustom = (patch: Partial<CustomPolicyRules>): void => {
    const rules: CustomPolicyRules = {
      ...policy.custom,
      ...patch,
      allowedHosts: hosts
        .split(',')
        .map((h) => h.trim())
        .filter(Boolean)
    }
    void window.agweb.policy.setCustom(rules)
    setHostsDraft(null)
  }

  const applies = guardsApply(policy.mode)
  const section =
    'px-1 pb-1 pt-2.5 text-[10px] font-semibold uppercase tracking-[0.12em] text-slate-400'

  return (
    <div
      // Width comes from the AnchoredPopover that hosts this (300px, or the
      // viewport when narrower); nothing in here sets a pixel width.
      className={`w-full rounded-xl border border-slate-200 bg-white p-2 text-[12px] shadow-xl dark:border-slate-700 dark:bg-[#0e1420] ${className ?? ''}`}
      data-testid="permission-popover"
      role="dialog"
      aria-label="Agent permissions"
    >
      <div className={section}>Permission mode</div>
      {MODES.map((m) => (
        <button
          key={m.id}
          onClick={() => setMode(m.id)}
          data-testid={`policy-mode-${m.id}`}
          aria-pressed={policy.mode === m.id}
          className={`flex w-full min-w-0 items-center justify-between gap-3 rounded-md px-2 py-1.5 text-left ${
            policy.mode === m.id
              ? 'bg-slate-100 shadow-[inset_3px_0_0_var(--wd-accent)] dark:bg-slate-800'
              : 'hover:bg-slate-50 dark:hover:bg-slate-800/60'
          }`}
        >
          {/* The label never wraps; the hint gives way (ellipsis) when the
              panel is narrow. A two-line "Full / autonomy" is what a squeezed
              flex row does by default, and it reads as a broken layout. */}
          <span className="shrink-0 whitespace-nowrap font-medium">{m.label}</span>
          <span className="min-w-0 truncate text-right text-[11px] text-slate-400" title={m.hint}>
            {m.hint}
          </span>
        </button>
      ))}

      {policy.mode === 'custom' && (
        <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1.5 px-2 text-[11px]">
          {(
            [
              ['writes', 'fileWrites'],
              ['commands', 'commands'],
              ['navigation', 'navigation']
            ] as const
          ).map(([label, key]) => (
            <label key={key} className="flex items-center gap-1.5">
              <span className="text-slate-500">{label}</span>
              <select
                value={policy.custom[key]}
                onChange={(e) => setCustom({ [key]: e.target.value as PolicyDecision })}
                className="rounded border border-slate-300 bg-transparent px-1 py-0.5 text-[11px] dark:border-slate-600 dark:bg-[#0e1420]"
              >
                {DECISIONS.map((d) => (
                  <option key={d} value={d}>
                    {d}
                  </option>
                ))}
              </select>
            </label>
          ))}
          <input
            value={hosts}
            onChange={(e) => setHosts(e.target.value)}
            onBlur={() => setCustom({})}
            onKeyDown={(e) => e.key === 'Enter' && setCustom({})}
            placeholder="allowed hosts, comma-separated"
            className="min-w-40 flex-1 rounded border border-slate-300 bg-transparent px-1.5 py-0.5 outline-none focus:border-sky-500 dark:border-slate-600"
          />
        </div>
      )}

      <div className={section}>
        Always ask before acting on
        {!applies && (
          <span className="ml-1 normal-case tracking-normal text-slate-400">
            — {MODES.find((m) => m.id === policy.mode)?.label} already confirms
          </span>
        )}
      </div>
      {POLICY_GUARDS.map((g) => (
        <label
          key={g.id}
          title={g.hint}
          className={`flex min-w-0 items-center justify-between gap-3 rounded-md px-2 py-1.5 ${
            applies ? 'hover:bg-slate-50 dark:hover:bg-slate-800/60' : 'opacity-50'
          }`}
        >
          <span className="min-w-0 truncate">{g.label}</span>
          <input
            type="checkbox"
            role="switch"
            aria-checked={policy.guards[g.id]}
            checked={policy.guards[g.id]}
            onChange={(e) => void window.agweb.policy.setGuard(g.id, e.target.checked)}
            data-testid={`policy-guard-${g.id}`}
            className="h-3.5 w-3.5 shrink-0 accent-[var(--wd-accent)]"
          />
        </label>
      ))}

      {/* Standing per-site decisions. A grant the user cannot see is a grant
          they cannot revoke, and these are made from a prompt in the middle of
          a task — exactly when nobody is keeping track. */}
      {policy.sites.length > 0 && (
        <>
          <div className={section}>Sites you decided</div>
          {policy.sites.map((site) => (
            <div
              key={site.host}
              className="flex items-center justify-between gap-2 px-2 py-1"
              title={`Set ${new Date(site.grantedAt).toLocaleString()}`}
            >
              <span className="truncate">
                {site.host}
                <span
                  className={`ml-1.5 text-[11px] ${
                    site.decision === 'allow'
                      ? 'text-emerald-600 dark:text-emerald-400'
                      : 'text-rose-600 dark:text-rose-400'
                  }`}
                >
                  {site.decision === 'allow' ? 'always allow' : 'always deny'}
                </span>
              </span>
              <button
                onClick={() => void window.agweb.policy.clearSite(site.host)}
                aria-label={`Forget ${site.host}`}
                className="text-slate-400 hover:text-slate-700 dark:hover:text-slate-200"
              >
                ×
              </button>
            </div>
          ))}
        </>
      )}
    </div>
  )
}
