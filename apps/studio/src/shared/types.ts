export type AiMode = 'local' | 'cloud'

export interface TemplateSummary {
  id: string
  name: string
  description: string
  /**
   * Path relative to templates root, e.g. "templates/landing-page/thumbnail.png"
   * (Milestone 1 does not render thumbnails yet.)
   */
  thumbnail?: string
  /**
   * Path relative to templates root, e.g. "templates/landing-page/overlay"
   */
  overlayDir: string
  /**
   * Always an array (empty if none).
   */
  tags: string[]
}

export interface CreateProjectRequest {
  name: string
  /**
   * Omit/undefined means "Start from scratch"
   * (scratch means: template-kit only, no overlay).
   */
  templateId?: string
  aiMode?: AiMode
  cloudModel?: string
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

export interface EnvVarEntry {
  key: string
  value: string
}

export interface AppSettings {
  /**
   * Folder where projects are created/listed.
   */
  projectsRoot: string

  /**
   * Stored for Milestone 1 persistence; secure storage can be added later.
   */
  openaiApiKey: string

  /**
   * File path or model ID for local runtime configuration (Milestone 1 stores only).
   */
  localModelPath: string

  /**
   * Simple env var storage for project generation.
   */
  envVars: EnvVarEntry[]
}

export type ChatRole = 'system' | 'user' | 'assistant'

export interface ChatMessage {
  id: string
  role: ChatRole
  content: string
  createdAt: string
}

export interface SelectDirectoryOptions {
  defaultPath?: string
}

export interface VorByteApi {
  projects: {
    list: () => Promise<ProjectSummary[]>
    create: (req: CreateProjectRequest) => Promise<ProjectSummary>
  }
  templates: {
    list: () => Promise<TemplateSummary[]>
  }
  fs: {
    tree: (rootPath: string, opts?: { maxDepth?: number }) => Promise<FileTreeNode>
  }
  settings: {
    get: () => Promise<AppSettings>
    save: (settings: AppSettings) => Promise<AppSettings>
  }
  dialog: {
    selectDirectory: (opts?: SelectDirectoryOptions) => Promise<string | null>
  }
}
