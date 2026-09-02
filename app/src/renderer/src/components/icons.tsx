import type { BlockType } from '@shared/deck'
interface IconProps {
  size?: number
  className?: string
}

export function GripIcon({ size = 14, className }: IconProps): React.JSX.Element {
  return (
    <svg
      width={size * 0.7}
      height={size}
      viewBox="0 0 10 16"
      fill="currentColor"
      className={className}
    >
      <circle cx="2.5" cy="3" r="1.4" />
      <circle cx="7.5" cy="3" r="1.4" />
      <circle cx="2.5" cy="8" r="1.4" />
      <circle cx="7.5" cy="8" r="1.4" />
      <circle cx="2.5" cy="13" r="1.4" />
      <circle cx="7.5" cy="13" r="1.4" />
    </svg>
  )
}

export function CloseIcon({ size = 13, className }: IconProps): React.JSX.Element {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      className={className}
    >
      <path d="M6 6l12 12M18 6L6 18" />
    </svg>
  )
}

export function ReloadIcon({ size = 15, className }: IconProps): React.JSX.Element {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
    >
      <path d="M21 12a9 9 0 1 1-2.64-6.36" />
      <path d="M21 3v6h-6" />
    </svg>
  )
}

export function DeckIcon({ size = 14, className }: IconProps): React.JSX.Element {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinejoin="round"
      className={className}
    >
      <rect x="3" y="3" width="11" height="11" rx="1.5" />
      <rect x="17" y="3" width="4" height="11" rx="1.5" />
      <rect x="3" y="17" width="18" height="4" rx="1.5" />
    </svg>
  )
}

export function PopOutIcon({ size = 13, className }: IconProps): React.JSX.Element {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinejoin="round"
      className={className}
    >
      <path d="M14 4h6v6" />
      <path d="M20 4L11 13" />
      <path d="M20 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1h5" />
    </svg>
  )
}

export function GlobeIcon({ size = 14, className }: IconProps): React.JSX.Element {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      className={className}
    >
      <circle cx="12" cy="12" r="9" />
      <path d="M3 12h18M12 3c2.5 2.6 3.8 5.7 3.8 9s-1.3 6.4-3.8 9c-2.5-2.6-3.8-5.7-3.8-9s1.3-6.4 3.8-9z" />
    </svg>
  )
}

export function MinusIcon({ size = 13, className }: IconProps): React.JSX.Element {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      className={className}
    >
      <path d="M5 12h14" />
    </svg>
  )
}

export function BlockTypeIcon({
  type,
  size = 15,
  className
}: IconProps & { type: BlockType }): React.JSX.Element {
  const common = {
    width: size,
    height: size,
    viewBox: '0 0 24 24',
    fill: 'none',
    stroke: 'currentColor',
    strokeWidth: 2,
    strokeLinecap: 'round' as const,
    strokeLinejoin: 'round' as const,
    className
  }
  switch (type) {
    case 'editor':
      return (
        <svg {...common}>
          <path d="M8 6l-5 6 5 6M16 6l5 6-5 6" />
        </svg>
      )
    case 'files':
      return (
        <svg {...common}>
          <path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
        </svg>
      )
    case 'terminal':
      return (
        <svg {...common}>
          <path d="M5 8l5 4-5 4M12 17h7" />
        </svg>
      )
    case 'agents':
      return (
        <svg {...common}>
          <rect x="5" y="8" width="14" height="11" rx="2" />
          <path d="M12 8V4M9 13h.01M15 13h.01" />
        </svg>
      )
    case 'logs':
      return (
        <svg {...common}>
          <path d="M4 6h16M4 12h16M4 18h10" />
        </svg>
      )
    case 'search':
      return (
        <svg {...common}>
          <circle cx="11" cy="11" r="7" />
          <path d="M21 21l-4.3-4.3" />
        </svg>
      )
    case 'preview':
      return (
        <svg {...common}>
          <rect x="3" y="4" width="18" height="14" rx="2" />
          <path d="M3 9h18M10 13l3 2-3 2z" />
        </svg>
      )
    case 'debug':
      return (
        <svg {...common}>
          <path d="M9 6a3 3 0 0 1 6 0" />
          <rect x="7" y="8" width="10" height="11" rx="4" />
          <path d="M4 11h3M17 11h3M4 17h3M17 17h3M12 12v5" />
        </svg>
      )
    case 'settings':
      return (
        <svg {...common}>
          <circle cx="12" cy="12" r="3" />
          <path d="M12 2v3M12 19v3M4.2 4.2l2.1 2.1M17.7 17.7l2.1 2.1M2 12h3M19 12h3M4.2 19.8l2.1-2.1M17.7 6.3l2.1-2.1" />
        </svg>
      )
    case 'tasks':
      return (
        <svg {...common}>
          <path d="M9 11l3 3 7-7" />
          <path d="M20 12v7a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h9" />
        </svg>
      )
    case 'scm':
      return (
        <svg {...common}>
          <circle cx="6" cy="6" r="2.5" />
          <circle cx="6" cy="18" r="2.5" />
          <circle cx="18" cy="9" r="2.5" />
          <path d="M6 8.5v7M18 11.5c0 3-3 4-6 4.5" />
        </svg>
      )
    case 'chat':
      return (
        <svg {...common}>
          <path d="M21 12a8 8 0 0 1-11.5 7.2L4 20l1-4.2A8 8 0 1 1 21 12z" />
          <path d="M9 11h6M9 8h4" />
        </svg>
      )
    case 'gitgraph':
      return (
        <svg {...common}>
          <circle cx="6" cy="5" r="2.2" />
          <circle cx="6" cy="19" r="2.2" />
          <circle cx="17" cy="12" r="2.2" />
          <path d="M6 7.2v9.6M6 12h4.5a4.5 4.5 0 0 0 4.5-2.4" />
        </svg>
      )
    case 'rest':
      return (
        <svg {...common}>
          <path d="M8 16l-4-4 4-4M16 8l4 4-4 4M13.5 6l-3 12" />
        </svg>
      )
    case 'db':
      return (
        <svg {...common}>
          <ellipse cx="12" cy="6" rx="7" ry="2.8" />
          <path d="M5 6v12c0 1.5 3.1 2.8 7 2.8s7-1.3 7-2.8V6" />
          <path d="M5 12c0 1.5 3.1 2.8 7 2.8s7-1.3 7-2.8" />
        </svg>
      )
    case 'jupyter':
      return (
        <svg {...common}>
          <rect x="4" y="4" width="16" height="16" rx="2" />
          <path d="M8 4v16" />
          <path d="M11 9l3 3-3 3" />
        </svg>
      )
    case 'extensions':
    case 'extview':
      return (
        <svg {...common}>
          <rect x="3" y="3" width="8" height="8" rx="1.5" />
          <rect x="13" y="3" width="8" height="8" rx="1.5" />
          <rect x="3" y="13" width="8" height="8" rx="1.5" />
          <path d="M17 13v8M13 17h8" />
        </svg>
      )
  }
}

export function DockInIcon({ size = 13, className }: IconProps): React.JSX.Element {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
    >
      <rect x="4" y="4" width="16" height="16" rx="2" />
      <path d="M15 9l-6 6M9 9h6v6" />
    </svg>
  )
}

/* ---- Composer icons (Phase 11), same 24-grid stroke family as the rest ---- */

const stroke = (size: number, className?: string): Record<string, unknown> => ({
  width: size,
  height: size,
  viewBox: '0 0 24 24',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.9,
  strokeLinecap: 'round' as const,
  strokeLinejoin: 'round' as const,
  className
})

export function AttachIcon({ size = 15, className }: IconProps): React.JSX.Element {
  return (
    <svg {...stroke(size, className)}>
      <path d="M20 11.5l-8.2 8.2a4.6 4.6 0 0 1-6.5-6.5l8.5-8.5a3.1 3.1 0 0 1 4.4 4.4l-8.5 8.5a1.6 1.6 0 0 1-2.2-2.2l7.8-7.8" />
    </svg>
  )
}

export function ImageIcon({ size = 15, className }: IconProps): React.JSX.Element {
  return (
    <svg {...stroke(size, className)}>
      <rect x="3" y="5" width="18" height="14" rx="2.5" />
      <circle cx="8.5" cy="10" r="1.4" />
      <path d="M3 16l5-4 4 3 3-2 6 5" />
    </svg>
  )
}

export function FolderIcon({ size = 15, className }: IconProps): React.JSX.Element {
  return (
    <svg {...stroke(size, className)}>
      <path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
    </svg>
  )
}

/** A styled-document (Document Studio) tab — a page with a folded corner. */
export function DocIcon({ size = 13, className }: IconProps): React.JSX.Element {
  return (
    <svg {...stroke(size, className)}>
      <path d="M6 3h7l5 5v12a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1z" />
      <path d="M13 3v5h5" />
      <path d="M8.5 13h7M8.5 16.5h7M8.5 9.5h3" />
    </svg>
  )
}

export function SlashIcon({ size = 15, className }: IconProps): React.JSX.Element {
  return (
    <svg {...stroke(size, className)}>
      <path d="M9 20L15 4" />
    </svg>
  )
}

export function MicIcon({ size = 15, className }: IconProps): React.JSX.Element {
  return (
    <svg {...stroke(size, className)}>
      <rect x="9" y="3" width="6" height="11" rx="3" />
      <path d="M5.5 11.5a6.5 6.5 0 0 0 13 0" />
      <path d="M12 18v3" />
    </svg>
  )
}

export function SendIcon({ size = 15, className }: IconProps): React.JSX.Element {
  return (
    <svg {...stroke(size, className)}>
      <path d="M12 19V5M6 11l6-6 6 6" />
    </svg>
  )
}

/** Reader Mode — an open book, same 24-grid stroke family as the rest. */
export function ReaderIcon({ size = 15, className }: IconProps): React.JSX.Element {
  return (
    <svg {...stroke(size, className)}>
      <path d="M12 6.5C10.5 5 8 4.5 4 5v13c4-.5 6.5 0 8 1.5 1.5-1.5 4-2 8-1.5V5c-4-.5-6.5 0-8 1.5z" />
      <path d="M12 6.5V20" />
    </svg>
  )
}
