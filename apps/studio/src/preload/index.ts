import { contextBridge, ipcRenderer } from 'electron'
import type {
  AiRunRequest,
  ChatMessage,
  CreateProjectRequest,
  SelectDirectoryOptions,
  VorByteApiWithCompat,
  PreviewStartOptions,
  PreviewLogsOptions,
  DesignApplyRequest
} from '../shared/types'

const api: VorByteApiWithCompat = {
  // Nested API (preferred)
  projects: {
    list: () => ipcRenderer.invoke('projects:list'),
    create: (req: CreateProjectRequest) => ipcRenderer.invoke('projects:create', req),
    tree: (projectPath: string, opts?: { maxDepth?: number }) =>
      ipcRenderer.invoke('projects:tree', projectPath, opts)
  },

  // Back-compat flat aliases (some older UI used these)
  projectsList: () => ipcRenderer.invoke('projects:list'),
  projectsCreate: (req: CreateProjectRequest) => ipcRenderer.invoke('projects:create', req),
  projectsTree: (projectPath: string, opts?: { maxDepth?: number }) =>
    ipcRenderer.invoke('projects:tree', projectPath, opts),

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
    clear: (projectPath: string) => ipcRenderer.invoke('chat:clear', projectPath),
    // Back-compat: some builds used chat.read/chat.write
    read: (projectPath: string) => ipcRenderer.invoke('chat:read', projectPath),
    write: (projectPath: string, chat: ChatMessage[]) => ipcRenderer.invoke('chat:write', projectPath, chat)
  },

  // Back-compat flat aliases
  chatRead: (projectPath: string) => ipcRenderer.invoke('chat:read', projectPath),
  chatWrite: (projectPath: string, chat: ChatMessage[]) => ipcRenderer.invoke('chat:write', projectPath, chat),

  previewStart: (projectPath: string, opts?: PreviewStartOptions) =>
    ipcRenderer.invoke('preview:start', projectPath, opts),
  previewStop: (projectPath: string) => ipcRenderer.invoke('preview:stop', projectPath),
  previewStatus: (projectPath: string) => ipcRenderer.invoke('preview:status', projectPath),
  previewLogs: (projectPath: string, opts?: PreviewLogsOptions) =>
    ipcRenderer.invoke('preview:logs', projectPath, opts),

  ai: {
    run: (req: AiRunRequest) => ipcRenderer.invoke('ai:run', req),
    cancel: (requestId: string) => ipcRenderer.invoke('ai:cancel', requestId)
  },

  preview: {
    start: (projectPath: string, opts?: PreviewStartOptions) =>
      ipcRenderer.invoke('preview:start', projectPath, opts),
    stop: (projectPath: string) => ipcRenderer.invoke('preview:stop', projectPath),
    status: (projectPath: string) => ipcRenderer.invoke('preview:status', projectPath),
    logs: (projectPath: string, opts?: PreviewLogsOptions) =>
      ipcRenderer.invoke('preview:logs', projectPath, opts)
  },

  design: {
    apply: (req: DesignApplyRequest) => ipcRenderer.invoke('design:apply', req)
  },

  // Back-compat flat alias
  designApply: (req: DesignApplyRequest) => ipcRenderer.invoke('design:apply', req),

  dialog: {
    selectDirectory: (opts?: SelectDirectoryOptions) => ipcRenderer.invoke('dialog:selectDirectory', opts)
  }
}

contextBridge.exposeInMainWorld('api', api)