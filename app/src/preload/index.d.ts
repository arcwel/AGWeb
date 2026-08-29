import type { AgwebApi } from '@shared/ipc'

declare global {
  interface Window {
    agweb: AgwebApi
  }
}

export {}
