import { app, BrowserWindow, dialog, ipcMain } from 'electron'
import path from 'node:path'
import os from 'node:os'
import fs from 'node:fs/promises'
import fssync from 'node:fs'
import crypto from 'node:crypto'
import dotenv from 'dotenv'

import type { AppSettings, CreateProjectRequest, FileTreeNode, ProjectSummary, TemplateSummary } from '../shared/types'

// Milestone 2 packages (provider-agnostic engine + codegen)
import { createAIEngine } from '../../../../packages/engine/src/createAIEngine'
import type { ChatMessage as EngineChatMessage } from '../../../../packages/engine/src/types'
import { parseAiResponse } from '../../../../packages/codegen/src/parse'
import { applyChanges } from '../../../../packages/codegen/src/apply'

dotenv.config()

// ---------------------------
// Paths & constants
// ---------------------------

const SETTINGS_FILE = 'settings.json'
const PROJECT_META_PATH = path.join('.vorbyte', 'project.json')
const CHAT_HISTORY_PATH = path.join('.vorbyte', 'chat.json')

const SKIP_TREE_NAMES = new Set(['node_modules', '.git', '.next', 'dist', 'out'])
const SKIP_COPY_NAMES = new Set(['node_modules', '.git', '.next', 'dist', 'out'])

function expandHome(p: string): string {
  if (p === '~') return os.homedir()
  if (p.startsWith('~/')) return path.join(os.homedir(), p.slice(2))
  return p
}

function resolveFromCwd(p: string): string {
  const expanded = expandHome(p)
  return path.isAbsolute(expanded) ? expanded : path.resolve(process.cwd(), expanded)
}

function envPath(name: string): string | null {
  const raw = process.env[name]
  if (!raw) return null
  return resolveFromCwd(raw)
}

function findRepoRoot(startDir: string): string {
  let cur = startDir
  for (;;) {
    if (
      fssync.existsSync(path.join(cur, 'pnpm-workspace.yaml')) ||
      fssync.existsSync(path.join(cur, 'turbo.json')) ||
      fssync.existsSync(path.join(cur, '.git'))
    ) {
      return cur
    }
    const parent = path.dirname(cur)
    if (parent === cur) return startDir
    cur = parent
  }
}

const REPO_ROOT = findRepoRoot(process.cwd())

function templatesRoot(): string {
  return envPath('VORBYTE_TEMPLATES_PATH') ?? path.resolve(REPO_ROOT, 'packages/templates')
}

function templateKitRoot(): string {
  return envPath('VORBYTE_TEMPLATE_KIT_PATH') ?? path.resolve(REPO_ROOT, 'packages/template-kit')
}

async function ensureDir(p: string) {
  await fs.mkdir(p, { recursive: true })
}

function sanitizeFolderName(name: string): string {
  const trimmed = (name ?? '').trim()
  const base = trimmed.length ? trimmed : 'Untitled'
  // Prevent path traversal / separators & keep it reasonably filesystem-friendly
  return base
    .replace(/[\\/\0]/g, '-') // path separators and NUL
    .replace(/[:*?"<>|]/g, '-') // Windows-illegal chars (also safe on macOS)
    .trim()
    .slice(0, 80)
}

async function readJson<T>(filePath: string, fallback: T): Promise<T> {
  try {
    const txt = await fs.readFile(filePath, 'utf-8')
    return JSON.parse(txt) as T
  } catch {
    return fallback
  }
}

async function writeJsonAtomic(filePath: string, data: unknown): Promise<void> {
  await ensureDir(path.dirname(filePath))
  const tmp = `${filePath}.tmp`
  await fs.writeFile(tmp, JSON.stringify(data, null, 2), 'utf-8')
  await fs.rename(tmp, filePath)
}

function defaultProjectsRoot(): string {
  const envRoot = envPath('VORBYTE_PROJECTS_ROOT')
  return envRoot ?? path.join(os.homedir(), 'VorByteProjects')
}

function defaultSettings(): AppSettings {
  return {
    projectsRoot: defaultProjectsRoot(),
    openaiApiKey: '',
    localModelPath: '',
    envVars: []
  }
}

function settingsPath(): string {
  return path.join(app.getPath('userData'), SETTINGS_FILE)
}

async function loadSettings(): Promise<AppSettings> {
  return readJson<AppSettings>(settingsPath(), defaultSettings())
}

async function saveSettings(next: AppSettings): Promise<AppSettings> {
  await writeJsonAtomic(settingsPath(), next)
  return next
}

// ---------------------------
// Templates
// ---------------------------

async function loadTemplatesIndex(): Promise<TemplateSummary[]> {
  const root = templatesRoot()
  const indexPath = path.join(root, 'templates.index.json')
  return readJson<TemplateSummary[]>(indexPath, [])
}

async function templateThumbnailData(templateId: string): Promise<string | null> {
  if (templateId === 'scratch') return null
  const root = templatesRoot()
  const templates = await loadTemplatesIndex()
  const t = templates.find((x) => x.id === templateId)
  const thumb = t?.thumbnail
  if (!thumb) return null
  const filePath = path.isAbsolute(thumb) ? thumb : path.join(root, thumb)
  try {
    const buf = await fs.readFile(filePath)
    const ext = path.extname(filePath).slice(1).toLowerCase()
    const mime =
      ext === 'png'
        ? 'image/png'
        : ext === 'jpg' || ext === 'jpeg'
          ? 'image/jpeg'
          : ext === 'webp'
            ? 'image/webp'
            : 'application/octet-stream'
    return `data:${mime};base64,${buf.toString('base64')}`
  } catch {
    return null
  }
}

// ---------------------------
// Project list & creation
// ---------------------------

async function readProjectMeta(projectPath: string): Promise<any | null> {
  const metaPath = path.join(projectPath, PROJECT_META_PATH)
  return readJson<any | null>(metaPath, null)
}

async function listProjects(): Promise<ProjectSummary[]> {
  const settings = await loadSettings()
  const root = settings.projectsRoot || defaultProjectsRoot()
  await ensureDir(root)

  const entries = await fs.readdir(root, { withFileTypes: true })
  const dirs = entries.filter((e) => e.isDirectory()).map((e) => e.name)

  const results: ProjectSummary[] = []
  for (const dirName of dirs) {
    const projectPath = path.join(root, dirName)
    const meta = await readProjectMeta(projectPath)
    results.push({
      name: meta?.name ?? dirName,
      path: projectPath,
      createdAt: meta?.createdAt,
      templateId: meta?.templateId
    })
  }

  results.sort((a, b) => (b.createdAt ?? '').localeCompare(a.createdAt ?? ''))
  return results
}

async function copyDir(src: string, dest: string): Promise<void> {
  await fs.cp(src, dest, {
    recursive: true,
    force: true,
    filter: (srcPath) => {
      const base = path.basename(srcPath)
      if (SKIP_COPY_NAMES.has(base)) return false
      return true
    }
  })
}

async function createProject(req: CreateProjectRequest): Promise<ProjectSummary> {
  const settings = await loadSettings()
  const projectsRoot = settings.projectsRoot || defaultProjectsRoot()
  await ensureDir(projectsRoot)

  const displayName = (req.name || 'Untitled').trim() || 'Untitled'
  const folderBase = sanitizeFolderName(displayName)

  // Ensure a unique folder (avoid hard error if a user repeats a name)
  let projectPath = path.join(projectsRoot, folderBase)
  let n = 2
  while (fssync.existsSync(projectPath)) {
    projectPath = path.join(projectsRoot, `${folderBase}-${n}`)
    n += 1
  }

  // 1) Copy template kit scaffold
  const kitPath = templateKitRoot()
  if (!fssync.existsSync(kitPath)) {
    throw new Error(
      `Template kit not found at: ${kitPath}. Ensure packages/template-kit exists, or set VORBYTE_TEMPLATE_KIT_PATH.`
    )
  }
  await copyDir(kitPath, projectPath)

  // 2) Apply template overlay (optional)
  const templateId = (req.templateId ?? 'scratch').trim() || 'scratch'
  if (templateId !== 'scratch') {
    const templatesRootAbs = templatesRoot()
    const templates = await loadTemplatesIndex()
    const t = templates.find((x) => x.id === templateId)
    if (!t) throw new Error(`Template not found: ${templateId}`)

    const overlayPath = path.isAbsolute(t.overlayDir) ? t.overlayDir : path.join(templatesRootAbs, t.overlayDir)
    if (!fssync.existsSync(overlayPath)) {
      throw new Error(`Overlay directory not found for template '${templateId}': ${overlayPath}`)
    }
    await copyDir(overlayPath, projectPath)
  }

  // 3) Write project metadata
  const createdAt = new Date().toISOString()
  const meta = {
    name: displayName,
    createdAt,
    templateId,
    ai: {
      aiMode: req.aiMode,
      cloudModel: req.cloudModel ?? null,
      localModel: req.localModel ?? null,
      enableImageGeneration: !!req.enableImageGeneration
    },
    initGit: !!req.initGit
  }

  const metaPath = path.join(projectPath, PROJECT_META_PATH)
  await writeJsonAtomic(metaPath, meta)

  // 4) Create chat history file
  const chatPath = path.join(projectPath, CHAT_HISTORY_PATH)
  await writeJsonAtomic(chatPath, [])

  // 5) Optionally init git
  if (req.initGit) {
    // No-op for now (Milestone 1 already had this stub).
    // You can add: spawn('git', ['init'], { cwd: projectPath }) in Milestone 3/4.
  }

  return { name: displayName, path: projectPath, createdAt, templateId }
}

// ---------------------------
// File tree
// ---------------------------

async function buildTree(rootPath: string, maxDepth = 5, depth = 0): Promise<FileTreeNode> {
  const name = path.basename(rootPath)
  const stat = await fs.stat(rootPath)

  if (!stat.isDirectory()) {
    return { name, path: rootPath, type: 'file' }
  }

  const node: FileTreeNode = { name, path: rootPath, type: 'dir', children: [] }
  if (depth >= maxDepth) return node

  const entries = await fs.readdir(rootPath, { withFileTypes: true })
  const filtered = entries
    .filter((e) => !SKIP_TREE_NAMES.has(e.name))
    .sort((a, b) => Number(b.isDirectory()) - Number(a.isDirectory()) || a.name.localeCompare(b.name))

  for (const e of filtered) {
    const childPath = path.join(rootPath, e.name)
    if (e.isDirectory()) {
      node.children!.push(await buildTree(childPath, maxDepth, depth + 1))
    } else {
      node.children!.push({ name: e.name, path: childPath, type: 'file' })
    }
  }

  return node
}

// ---------------------------
// Chat persistence (Milestone 2)
// ---------------------------

async function loadChat(projectPath: string) {
  const filePath = path.join(projectPath, CHAT_HISTORY_PATH)
  return readJson<any[]>(filePath, [])
}

async function saveChat(projectPath: string, messages: any[]) {
  const filePath = path.join(projectPath, CHAT_HISTORY_PATH)
  await writeJsonAtomic(filePath, messages)
}

// ---------------------------
// AI run orchestration (Milestone 2)
// ---------------------------

const running = new Map<string, AbortController>()

function makeId(): string {
  return crypto.randomBytes(8).toString('hex')
}

function buildSystemPrompt(): string {
  return [
    'You are an expert Next.js + Tailwind developer.',
    'Generate or modify code for the project.',
    '',
    'Output format:',
    '- Start with a short summary (1-6 lines) describing what you changed.',
    '- Then emit one or more file blocks using either of these formats:',
    '  1) File: path/to/file.ext',
    '     ```',
    '     <full file content>',
    '     ```',
    '  2) ```file path/to/file.ext',
    '     <full file content>',
    '     ```',
    '',
    'Also list dependencies if you add new packages:',
    'Dependencies: ["some-pkg", "@scope/other-pkg"]',
    '',
    'Constraints:',
    '- Use Next.js + Tailwind CSS and shadcn/ui where appropriate.',
    '- Prefer full file outputs (not diffs).',
    '- Never write outside the project directory.'
  ].join('\n')
}

function toEngineMessages(input: { role: string; content: string }[]): EngineChatMessage[] {
  return input.map((m) => ({
    role: m.role as any,
    content: m.content
  }))
}

async function runAiAndApply(opts: {
  requestId?: string
  projectPath: string
  provider: 'ollama' | 'openai'
  model: string
  messages: { role: 'system' | 'user' | 'assistant'; content: string }[]
}): Promise<{ summary: string; writtenFiles: string[]; installedDependencies: string[]; raw: string }> {
  const requestId = opts.requestId || makeId()

  // Cancel any prior request with same id
  const prev = running.get(requestId)
  if (prev) prev.abort()

  const controller = new AbortController()
  running.set(requestId, controller)

  try {
    const settings = await loadSettings()

    const engine =
      opts.provider === 'openai'
        ? createAIEngine({
            provider: 'openai',
            openai: {
              apiKey: settings.openaiApiKey,
              model: opts.model
            }
          })
        : createAIEngine({
            provider: 'ollama',
            ollama: {
              baseUrl: process.env.OLLAMA_BASE_URL ?? 'http://localhost:11434',
              model: opts.model
            }
          })

    const system = buildSystemPrompt()

    const merged: EngineChatMessage[] = [{ role: 'system', content: system }, ...toEngineMessages(opts.messages)]

    const { text } = await engine.chat({ messages: merged, signal: controller.signal })

    const parsed = parseAiResponse(text)

    const applied = await applyChanges({
      projectDir: opts.projectPath,
      files: parsed.files,
      dependencies: parsed.dependencies
    })

    return {
      summary: parsed.summary || 'Applied changes.',
      writtenFiles: applied.writtenFiles,
      installedDependencies: applied.installedDependencies,
      raw: text
    }
  } finally {
    running.delete(requestId)
  }
}

// ---------------------------
// Electron window
// ---------------------------

function createWindow(): void {
  const mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    show: false,
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, '../preload/index.js'),
      sandbox: true
    }
  })

  mainWindow.on('ready-to-show', () => mainWindow.show())

  if (process.env.ELECTRON_RENDERER_URL) {
    mainWindow.loadURL(process.env.ELECTRON_RENDERER_URL)
  } else {
    mainWindow.loadFile(path.join(__dirname, '../renderer/index.html'))
  }
}

app.whenReady().then(() => {
  app.on('activate', function () {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })

  ipcMain.handle('settings:get', async () => loadSettings())
  ipcMain.handle('settings:save', async (_evt, next: AppSettings) => saveSettings(next))

  ipcMain.handle('templates:list', async () => loadTemplatesIndex())
  ipcMain.handle('templates:thumbnailData', async (_evt, templateId: string) => templateThumbnailData(templateId))

  ipcMain.handle('projects:list', async () => listProjects())
  ipcMain.handle('projects:create', async (_evt, req: CreateProjectRequest) => createProject(req))

  ipcMain.handle('fs:tree', async (_evt, rootPath: string, opts?: { maxDepth?: number }) => {
    const maxDepth = Math.max(1, Math.min(12, opts?.maxDepth ?? 5))
    return buildTree(rootPath, maxDepth)
  })

  ipcMain.handle('dialog:selectDirectory', async (_evt, opts?: { title?: string; defaultPath?: string }) => {
    const res = await dialog.showOpenDialog({
      title: opts?.title ?? 'Select Folder',
      defaultPath: opts?.defaultPath,
      properties: ['openDirectory', 'createDirectory']
    })
    if (res.canceled) return null
    return res.filePaths?.[0] ?? null
  })

  ipcMain.handle('chat:load', async (_evt, projectPath: string) => loadChat(projectPath))
  ipcMain.handle('chat:clear', async (_evt, projectPath: string) => saveChat(projectPath, []))

  ipcMain.handle('ai:run', async (_evt, req: any) => {
    const result = await runAiAndApply({
      requestId: req.requestId,
      projectPath: req.projectPath,
      provider: req.provider,
      model: req.model,
      messages: req.messages
    })

    // Append to chat history (persist)
    const prior = await loadChat(req.projectPath)
    const now = new Date().toISOString()
    const next = [
      ...prior,
      ...req.messages.map((m: any) => ({
        id: crypto.randomBytes(8).toString('hex'),
        role: m.role,
        content: m.content,
        createdAt: now
      })),
      {
        id: crypto.randomBytes(8).toString('hex'),
        role: 'assistant',
        content: result.summary,
        createdAt: now
      }
    ]
    await saveChat(req.projectPath, next)

    return result
  })

  ipcMain.handle('ai:cancel', async (_evt, requestId: string) => {
    const ctrl = running.get(requestId)
    if (ctrl) ctrl.abort()
  })

  createWindow()
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
