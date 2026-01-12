import { contextBridge, ipcRenderer } from 'electron'
import type { AiRunRequest, CreateProjectRequest, SelectDirectoryOptions, VorByteApiWithCompat } from '../shared/types'

const api: VorByteApiWithCompat = {
  // Nested API (preferred)
  projects: {
    list: () => ipcRenderer.invoke('projects:list'),
    create: (req: CreateProjectRequest) => ipcRenderer.invoke('projects:create', req)
  },

  // Back-compat flat aliases (some older UI used these)
  projectsList: () => ipcRenderer.invoke('projects:list'),
  projectsCreate: (req: CreateProjectRequest) => ipcRenderer.invoke('projects:create', req),

  templates: {
    list: () => ipcRenderer.invoke('templates:list'),
    thumbnailData: (templateId: string) => ipcRenderer.invoke('templates:thumbnailData', templateId)
  },

  fs: {
    tree: (rootPath: string, opts?: { maxDepth?: number }) => ipcRenderer.invoke('fs:tree', rootPath, opts)
  },

  settings: {
    get: () => ipcRenderer.invoke('settings:get'),
    save: (settings) => ipcRenderer.invoke('settings:save', settings)
  },

  chat: {
    load: (projectPath: string) => ipcRenderer.invoke('chat:load', projectPath),
    clear: (projectPath: string) => ipcRenderer.invoke('chat:clear', projectPath)
  },

  ai: {
    run: (req: AiRunRequest) => ipcRenderer.invoke('ai:run', req),
    cancel: (requestId: string) => ipcRenderer.invoke('ai:cancel', requestId)
  },

  dialog: {
    selectDirectory: (opts?: SelectDirectoryOptions) => ipcRenderer.invoke('dialog:selectDirectory', opts)
  }
}

contextBridge.exposeInMainWorld('api', api)
