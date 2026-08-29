import React from 'react'
import ReactDOM from 'react-dom/client'
import App from '@/App'
import { DeckWindow } from '@/components/DeckWindow'
import { FloatWindow } from '@/components/FloatWindow'
import { getWindowRole, useShellStore } from '@/store'
import { loadInitialTheme } from '@/theme'
import { installShortcutListener } from '@/shortcuts'
import { useShellSync } from '@/windowSync'
import '@/styles.css'

const role = getWindowRole()

useShellStore.setState({ theme: loadInitialTheme() })
if (role.kind === 'main') installShortcutListener()

function Root(): React.JSX.Element {
  useShellSync(role.kind)
  if (role.kind === 'deck') return <DeckWindow />
  if (role.kind === 'float') return <FloatWindow groupId={role.groupId ?? ''} />
  return <App />
}

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <Root />
  </React.StrictMode>
)
