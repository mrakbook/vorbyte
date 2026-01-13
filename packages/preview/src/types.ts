export type PreviewState = 'stopped' | 'starting' | 'running' | 'error'

export interface PreviewStartOptions {
  projectPath: string
  port?: number
  /**
   * When true, automatically runs a dependency install step (e.g. `pnpm install`)
   * in the project folder if node_modules is missing.
   *
   * Default: true
   */
  autoInstallDeps?: boolean
  /**
   * Host interface to bind. Default: 127.0.0.1
   */
  host?: string
}

export interface PreviewStatus {
  projectPath: string
  state: PreviewState
  url?: string
  host?: string
  port?: number
  pid?: number
  startedAt?: string
  error?: string
  lastLog?: string
}

export interface PreviewLogsOptions {
  tail?: number
}

export interface PreviewManager {
  start(opts: PreviewStartOptions): Promise<PreviewStatus>
  stop(projectPath: string): Promise<boolean>
  status(projectPath: string): PreviewStatus
  logs(projectPath: string, opts?: PreviewLogsOptions): string[]
  stopAll(): Promise<void>
}
