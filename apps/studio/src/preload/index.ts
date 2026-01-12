import { contextBridge, ipcRenderer } from 'electron'

const api = {
  projects: {
    list: () => ipcRenderer.invoke('projects:list'),
    create: (req: any) => ipcRenderer.invoke('projects:create', req)
  },
  templates: {
    list: () => ipcRenderer.invoke('templates:list'),
    thumbnailData: (templateId: string) => ipcRenderer.invoke('templates:thumbnailData', templateId)
  },
  fs: {
    tree: (rootPath: string, opts?: { maxDepth?: number }) => ipcRenderer.invoke('fs:tree', rootPath, opts)
  },
  settings: {
    get: () => ipcRenderer.invoke('settings:get'),
    save: (settings: any) => ipcRenderer.invoke('settings:save', settings)
  },
  chat: {
    load: (projectPath: string) => ipcRenderer.invoke('chat:load', projectPath),
    clear: (projectPath: string) => ipcRenderer.invoke('chat:clear', projectPath)
  },
  ai: {
    run: (req: any) => ipcRenderer.invoke('ai:run', req),
    cancel: (requestId: string) => ipcRenderer.invoke('ai:cancel', requestId)
  },
  dialog: {
    selectDirectory: (opts?: any) => ipcRenderer.invoke('dialog:selectDirectory', opts)
  }
}

contextBridge.exposeInMainWorld('api', api)
