import type { VorByteApi } from '@shared/types'

declare global {
  interface Window {
    api: VorByteApi
  }
}

export {}
