import { contextBridge, ipcRenderer } from 'electron'
import { electronAPI } from '@electron-toolkit/preload'

import type { AppSettings, CreateProjectRequest, VorByteApi } from '../shared/types'

const api: VorByteApi = {
  settings: {
    get: () => ipcRenderer.invoke('settings:get'),
    save: (next: AppSettings) => ipcRenderer.invoke('settings:save', next)
  },
  templates: {
    list: () => ipcRenderer.invoke('templates:list')
  },
  projects: {
    list: () => ipcRenderer.invoke('projects:list'),
    create: (req: CreateProjectRequest) => ipcRenderer.invoke('projects:create', req)
  },
  fs: {
    tree: (rootPath: string, opts?: { maxDepth?: number }) =>
      ipcRenderer.invoke('fs:tree', rootPath, opts)
  },
  dialog: {
    selectDirectory: (opts?: { defaultPath?: string }) =>
      ipcRenderer.invoke('dialog:selectDirectory', opts)
  }
}

if (process.contextIsolated) {
  contextBridge.exposeInMainWorld('electron', electronAPI)
  contextBridge.exposeInMainWorld('api', api)
} else {
  // @ts-expect-error fallback when contextIsolation is disabled
  window.electron = electronAPI
  // @ts-expect-error fallback when contextIsolation is disabled
  window.api = api
}
