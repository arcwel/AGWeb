import { useEffect, useState } from 'react'
import type { CustomPolicyRules, PermissionMode, PolicyDecision, PolicyStatus } from '@shared/ipc'

const MODES: { id: PermissionMode; label: string; hint: string }[] = [
  { id: 'secure', label: 'Secure', hint: 'Confirm every file write, command, and navigation' },
  {
    id: 'review',
    label: 'Review-driven',
    hint: 'Workspace writes auto-approve; the rest confirms'
  },
  { id: 'agent', label: 'Agent-driven', hint: 'Autonomous in the workspace and allowlisted hosts' },
  { id: 'custom', label: 'Custom', hint: 'Your rules below' }
]

const DECISIONS: PolicyDecision[] = ['allow', 'confirm', 'deny']

/** Permission-mode selector (and custom-rule editor) for agent sessions. */
export function PolicyControls(): React.JSX.Element | null {
  const [policy, setPolicy] = useState<PolicyStatus | null>(null)
  const [hosts, setHosts] = useState('')

  useEffect(() => {
    let cancelled = false
    const apply = (status: PolicyStatus): void => {
      setPolicy(status)
      setHosts(status.custom.allowedHosts.join(', '))
    }
    void window.agweb.policy.get().then((status) => {
      // The window can close before this async read resolves (P2-7): guard the
      // setState so it never fires on an unmounted component.
      if (!cancelled) apply(status)
    })
    // Reflect changes made in any other window so this panel never goes stale
    // (P2-13).
    const off = window.agweb.policy.onChanged(apply)
    return () => {
      cancelled = true
      off()
    }
  }, [])

  if (!policy) return null
  const mode = MODES.find((m) => m.id === policy.mode) ?? MODES[1]

  const setMode = (value: PermissionMode): void => {
    void window.agweb.policy.setMode(value).then(setPolicy)
  }

  const setCustom = (patch: Partial<CustomPolicyRules>, hostsText?: string): void => {
    const rules: CustomPolicyRules = {
      ...policy.custom,
      ...patch,
      allowedHosts: (hostsText ?? hosts)
        .split(',')
        .map((h) => h.trim())
        .filter(Boolean)
    }
    void window.agweb.policy.setCustom(rules).then(setPolicy)
  }

  const ruleSelect = (
    label: string,
    value: PolicyDecision,
    apply: (d: PolicyDecision) => void
  ): React.JSX.Element => (
    <label className="flex items-center gap-1.5">
      <span className="text-slate-500">{label}</span>
      <select
        value={value}
        onChange={(e) => apply(e.target.value as PolicyDecision)}
        className="rounded border border-slate-300 bg-transparent px-1 py-0.5 text-[11px] dark:border-slate-600 dark:bg-[#0e1420]"
      >
        {DECISIONS.map((d) => (
          <option key={d} value={d}>
            {d}
          </option>
        ))}
      </select>
    </label>
  )

  return (
    <div className="flex-none border-b border-slate-200 px-2.5 py-1.5 dark:border-slate-800">
      <div className="flex items-center gap-2">
        <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400">
          Permissions
        </span>
        <select
          value={policy.mode}
          onChange={(e) => setMode(e.target.value as PermissionMode)}
          data-testid="policy-mode"
          className="rounded border border-slate-300 bg-transparent px-1.5 py-0.5 text-[11px] font-semibold dark:border-slate-600 dark:bg-[#0e1420]"
        >
          {MODES.map((m) => (
            <option key={m.id} value={m.id}>
              {m.label}
            </option>
          ))}
        </select>
        <span className="truncate text-[10px] text-slate-400">{mode.hint}</span>
      </div>
      {policy.mode === 'custom' && (
        <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1.5 text-[11px]">
          {ruleSelect('writes', policy.custom.fileWrites, (d) => setCustom({ fileWrites: d }))}
          {ruleSelect('commands', policy.custom.commands, (d) => setCustom({ commands: d }))}
          {ruleSelect('navigation', policy.custom.navigation, (d) => setCustom({ navigation: d }))}
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
    </div>
  )
}
