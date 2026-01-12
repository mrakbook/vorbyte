export type AiMode = 'local' | 'cloud'

export type ChatRole = 'system' | 'user' | 'assistant'

export interface ChatMessage {
  id: string
  role: ChatRole
  content: string
  createdAt: string
}

/**
 * Template definitions live under packages/templates.
 */
export interface TemplateSummary {
  id: string
  name: string
  description: string
  /**
   * Path relative to templates root (example: "templates/landing-page/thumbnail.png")
   * Renderer should NOT load this directly; use templates.thumbnailData(templateId).
   */
  thumbnail?: string
  /**
   * Path relative to templates root (example: "templates/landing-page/overlay")
   * Used by the main process when copying template files.
   */
  overlayDir: string
}

export interface ProjectSummary {
  name: string
  path: string
  createdAt?: string
  templateId?: string
}

export interface FileTreeNode {
  name: string
  path: string
  type: 'file' | 'dir'
  children?: FileTreeNode[]
}

export interface EnvVar {
  key: string
  value: string
}

export interface AppSettings {
  projectsRoot: string
  openaiApiKey: string
  localModelPath: string
  envVars: EnvVar[]
}

export interface CreateProjectRequest {
  name: string
  templateId: string
  aiMode: AiMode
  cloudModel?: string
  localModel?: string
  enableImageGeneration?: boolean
  initGit?: boolean
}

export interface SelectDirectoryOptions {
  title?: string
  defaultPath?: string
}

export type EngineProvider = 'ollama' | 'openai'

export interface AiRunRequest {
  requestId: string
  projectPath: string
  provider: EngineProvider
  model: string
  messages: { role: 'system' | 'user' | 'assistant'; content: string }[]
  /**
   * If true, stream partial output back to the UI.
   * (In Milestone 2 we still return the final text; streaming is optional.)
   */
  stream?: boolean
}

export interface AiRunResult {
  summary: string
  writtenFiles: string[]
  installedDependencies: string[]
  raw: string
}

export interface VorByteApi {
  projects: {
    list: () => Promise<ProjectSummary[]>
    create: (req: CreateProjectRequest) => Promise<ProjectSummary>
  }
  templates: {
    list: () => Promise<TemplateSummary[]>
    /**
     * Returns a data URL (data:image/...;base64,...) for the template thumbnail.
     * Works with CSP (img-src 'self' data:).
     */
    thumbnailData: (templateId: string) => Promise<string | null>
  }
  fs: {
    tree: (rootPath: string, opts?: { maxDepth?: number }) => Promise<FileTreeNode>
  }
  settings: {
    get: () => Promise<AppSettings>
    save: (settings: AppSettings) => Promise<AppSettings>
  }
  chat: {
    load: (projectPath: string) => Promise<ChatMessage[]>
    clear: (projectPath: string) => Promise<void>
  }
  ai: {
    run: (req: AiRunRequest) => Promise<AiRunResult>
    cancel: (requestId: string) => Promise<void>
  }
  dialog: {
    selectDirectory: (opts?: SelectDirectoryOptions) => Promise<string | null>
  }
}

/**
 * Back-compat helpers.
 * Some older UI code used flat function names (window.api.projectsCreate).
 * Keep these around so refactors don't break the renderer.
 */
export interface VorByteApiCompat {
  projectsList: () => Promise<ProjectSummary[]>
  projectsCreate: (req: CreateProjectRequest) => Promise<ProjectSummary>
}

export type VorByteApiWithCompat = VorByteApi & VorByteApiCompat
