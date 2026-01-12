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
   */
  overlayDir: string
  tags?: string[]
}

export interface CreateProjectRequest {
  name: string
  /**
   * Omit/undefined means "Start from scratch"
   */
  templateId?: string
  aiMode?: AiMode
  cloudModel?: string
  /**
   * For Milestone 1/2: can be a local model name ("llama3.1") or "ollama:llama3.1".
   * (Later: can become a richer config object.)
   */
  localModel?: string
  enableImageGeneration?: boolean
  initGit?: boolean
}

export interface ProjectSummary {
  name: string
  path: string
  createdAt?: string
  templateId?: string
}

export type FileTreeNodeType = 'file' | 'dir'

export interface FileTreeNode {
  path: string
  name: string
  type: FileTreeNodeType
  children?: FileTreeNode[]
}

export interface EnvVarPair {
  key: string
  value: string
}

export interface AppSettings {
  /**
   * Folder where projects are created/listed.
   */
  projectsRoot?: string

  /**
   * Stored for Milestone 1 persistence; secure storage can be added later.
   */
  openaiApiKey?: string

  aiMode?: AiMode
  cloudModel?: string

  /**
   * For Milestone 1 UI: can be a local model path OR a model name (Ollama).
   * Milestone 2 uses it as a model name by default.
   */
  localModelPath?: string

  /**
   * Simple env var UI storage.
   */
  envVars?: EnvVarPair[]
}

export interface SelectDirectoryOptions {
  title?: string
  defaultPath?: string
}

/**
 * Milestone 2: run a prompt through the AI engine and apply file changes into the project dir.
 */
export interface AiRunRequest {
  projectPath: string
  prompt: string
  /**
   * Optional id for cancellation.
   */
  requestId?: string
}

export interface AiRunResult {
  chat: ChatMessage[]
  appliedFiles: string[]
  installedDependencies: string[]
}

export interface vorbyteApi {
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
