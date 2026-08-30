/**
 * Browser chrome icons, drawn to Chrome's own set.
 *
 * Chrome uses Material Symbols, which are a 24×24 filled grid rather than the
 * stroked outlines the rest of this shell uses. Mixing the two reads as an
 * accident, so every icon that sits in the browser chrome comes from here and
 * every one of them is a filled Material path.
 *
 * `size` is the drawn size; colour is inherited, so a parent's text colour
 * drives it.
 */

interface Props {
  size?: number
  className?: string
}

function Icon({
  size = 18,
  className,
  children
}: Props & { children: React.ReactNode }): React.JSX.Element {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 -960 960 960"
      fill="currentColor"
      className={className}
      aria-hidden="true"
    >
      {children}
    </svg>
  )
}

export function ArrowBackIcon(props: Props): React.JSX.Element {
  return (
    <Icon {...props}>
      <path d="M400-80 0-480l400-400 71 71-329 329 329 329-71 71Z" />
    </Icon>
  )
}

export function ArrowForwardIcon(props: Props): React.JSX.Element {
  return (
    <Icon {...props}>
      <path d="m321-80-71-71 329-329-329-329 71-71 400 400L321-80Z" />
    </Icon>
  )
}

export function RefreshIcon(props: Props): React.JSX.Element {
  return (
    <Icon {...props}>
      <path d="M480-160q-134 0-227-93t-93-227q0-134 93-227t227-93q69 0 132 28.5T720-690v-110h80v280H520v-80h168q-32-56-87.5-88T480-720q-100 0-170 70t-70 170q0 100 70 170t170 70q77 0 139-44t87-116h84q-28 106-114 173t-196 67Z" />
    </Icon>
  )
}

export function StopIcon(props: Props): React.JSX.Element {
  return (
    <Icon {...props}>
      <path d="m256-200-56-56 224-224-224-224 56-56 224 224 224-224 56 56-224 224 224 224-56 56-224-224-224 224Z" />
    </Icon>
  )
}

export function HomeIcon(props: Props): React.JSX.Element {
  return (
    <Icon {...props}>
      <path d="M240-200h120v-240h240v240h120v-360L480-740 240-560v360Zm-80 80v-480l320-240 320 240v480H520v-240h-80v240H160Z" />
    </Icon>
  )
}

export function StarIcon(props: Props): React.JSX.Element {
  return (
    <Icon {...props}>
      <path d="m354-247 126-76 126 77-33-144 111-96-146-13-58-136-58 135-146 13 111 97-33 143ZM233-80l65-281L80-550l288-25 112-265 112 265 288 25-218 189 65 281-247-149L233-80Z" />
    </Icon>
  )
}

export function StarFilledIcon(props: Props): React.JSX.Element {
  return (
    <Icon {...props}>
      <path d="m233-80 65-281L80-550l288-25 112-265 112 265 288 25-218 189 65 281-247-149L233-80Z" />
    </Icon>
  )
}

export function BookmarksIcon(props: Props): React.JSX.Element {
  return (
    <Icon {...props}>
      <path d="M120-80v-680q0-33 23.5-56.5T200-840h560q33 0 56.5 23.5T840-760v680L480-240 120-80Zm80-122 280-120 280 120v-558H200v558Z" />
    </Icon>
  )
}

export function SearchIcon(props: Props): React.JSX.Element {
  return (
    <Icon {...props}>
      <path d="M784-120 532-372q-30 24-69 38t-83 14q-109 0-184.5-75.5T120-580q0-109 75.5-184.5T380-840q109 0 184.5 75.5T640-580q0 44-14 83t-38 69l252 252-56 56ZM380-400q75 0 127.5-52.5T560-580q0-75-52.5-127.5T380-760q-75 0-127.5 52.5T200-580q0 75 52.5 127.5T380-400Z" />
    </Icon>
  )
}

export function ZoomInIcon(props: Props): React.JSX.Element {
  return (
    <Icon {...props}>
      <path d="M340-540h80v-80h60v80h80v60h-80v80h-60v-80h-80v-60ZM784-120 532-372q-30 24-69 38t-83 14q-109 0-184.5-75.5T120-580q0-109 75.5-184.5T380-840q109 0 184.5 75.5T640-580q0 44-14 83t-38 69l252 252-56 56ZM380-400q75 0 127.5-52.5T560-580q0-75-52.5-127.5T380-760q-75 0-127.5 52.5T200-580q0 75 52.5 127.5T380-400Z" />
    </Icon>
  )
}

export function ExtensionIcon(props: Props): React.JSX.Element {
  return (
    <Icon {...props}>
      <path d="M352-120H200q-33 0-56.5-23.5T120-200v-152q48 0 84-30.5t36-77.5q0-47-36-77.5T120-568v-152q0-33 23.5-56.5T200-800h160q0-42 29-71t71-29q42 0 71 29t29 71h160q33 0 56.5 23.5T800-640v160q42 0 71 29t29 71q0 42-29 71t-71 29v160q0 33-23.5 56.5T720-120H568q0-50-31.5-85T460-240q-45 0-76.5 35T352-120Z" />
    </Icon>
  )
}

export function HistoryIcon(props: Props): React.JSX.Element {
  return (
    <Icon {...props}>
      <path d="M480-120q-138 0-240.5-91.5T122-440h82q14 104 92.5 172T480-200q117 0 198.5-81.5T760-480q0-117-81.5-198.5T480-760q-69 0-129 32t-101 88h110v80H120v-240h80v94q51-64 124.5-99T480-840q75 0 140.5 28.5t114 77q48.5 48.5 77 114T840-480q0 75-28.5 140.5t-77 114q-48.5 48.5-114 77T480-120Zm112-192L440-464v-216h80v184l128 128-56 56Z" />
    </Icon>
  )
}

export function PersonIcon(props: Props): React.JSX.Element {
  return (
    <Icon {...props}>
      <path d="M480-480q-66 0-113-47t-47-113q0-66 47-113t113-47q66 0 113 47t47 113q0 66-47 113t-113 47ZM160-160v-112q0-34 17.5-62.5T224-378q62-31 126-46.5T480-440q66 0 130 15.5T736-378q29 15 46.5 43.5T800-272v112H160Z" />
    </Icon>
  )
}

/** Chrome's overflow menu — the vertical three dots. */
export function MoreVertIcon(props: Props): React.JSX.Element {
  return (
    <Icon {...props}>
      <path d="M480-160q-33 0-56.5-23.5T400-240q0-33 23.5-56.5T480-320q33 0 56.5 23.5T560-240q0 33-23.5 56.5T480-160Zm0-240q-33 0-56.5-23.5T400-480q0-33 23.5-56.5T480-560q33 0 56.5 23.5T560-480q0 33-23.5 56.5T480-400Zm0-240q-33 0-56.5-23.5T400-720q0-33 23.5-56.5T480-800q33 0 56.5 23.5T560-720q0 33-23.5 56.5T480-640Z" />
    </Icon>
  )
}

export function CloseIcon(props: Props): React.JSX.Element {
  return (
    <Icon {...props}>
      <path d="M256-200l-56-56 224-224-224-224 56-56 224 224 224-224 56 56-224 224 224 224-56 56-224-224-224 224Z" />
    </Icon>
  )
}

export function LockIcon(props: Props): React.JSX.Element {
  return (
    <Icon {...props}>
      <path d="M240-80q-33 0-56.5-23.5T160-160v-400q0-33 23.5-56.5T240-640h40v-80q0-83 58.5-141.5T480-920q83 0 141.5 58.5T680-720v80h40q33 0 56.5 23.5T800-560v400q0 33-23.5 56.5T720-80H240Zm240-200q33 0 56.5-23.5T560-360q0-33-23.5-56.5T480-440q-33 0-56.5 23.5T400-360q0 33 23.5 56.5T480-280ZM360-640h240v-80q0-50-35-85t-85-35q-50 0-85 35t-35 85v80Z" />
    </Icon>
  )
}

export function SplitscreenIcon(props: Props): React.JSX.Element {
  return (
    <Icon {...props}>
      <path d="M200-120q-33 0-56.5-23.5T120-200v-160q0-33 23.5-56.5T200-440h560q33 0 56.5 23.5T840-360v160q0 33-23.5 56.5T760-120H200Zm0-400q-33 0-56.5-23.5T120-600v-160q0-33 23.5-56.5T200-840h560q33 0 56.5 23.5T840-760v160q0 33-23.5 56.5T760-520H200Z" />
    </Icon>
  )
}

export function SettingsIcon(props: Props): React.JSX.Element {
  return (
    <Icon {...props}>
      <path d="m370-80-16-128q-13-5-24.5-12T307-235l-119 50L78-375l103-78q-1-7-1-13.5v-27q0-6.5 1-13.5L78-585l110-190 119 50q11-8 23-15t24-12l16-128h220l16 128q13 5 24.5 12t22.5 15l119-50 110 190-103 78q1 7 1 13.5v27q0 6.5-2 13.5l103 78-110 190-118-50q-11 8-23 15t-24 12L590-80H370Zm112-260q58 0 99-41t41-99q0-58-41-99t-99-41q-59 0-99.5 41T342-480q0 58 40.5 99t99.5 41Z" />
    </Icon>
  )
}

export function IncognitoIcon(props: Props): React.JSX.Element {
  return (
    <Icon {...props}>
      <path d="M120-440v-80h180l60-240h240l60 240h180v80H120Zm140-40Zm-20 360q-58 0-99-41t-41-99q0-58 41-99t99-41q45 0 80.5 25.5T371-310h218q14-39 49.5-64.5T719-400q58 0 99 41t41 99q0 58-41 99t-99 41q-52 0-90.5-34T585-240h-210q-5 46-43.5 80T240-120Zm0-80q25 0 42.5-17.5T300-260q0-25-17.5-42.5T240-320q-25 0-42.5 17.5T180-260q0 25 17.5 42.5T240-200Zm480 0q25 0 42.5-17.5T780-260q0-25-17.5-42.5T720-320q-25 0-42.5 17.5T660-260q0 25 17.5 42.5T720-200Z" />
    </Icon>
  )
}
