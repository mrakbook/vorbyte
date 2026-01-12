import type { VorByteApiWithCompat } from '../shared/types'

declare global {
  interface Window {
    api: VorByteApiWithCompat
  }
}

export {}
