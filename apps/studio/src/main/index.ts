import { app, BrowserWindow, dialog, ipcMain } from 'electron'
import path from 'path'
import fs from 'fs/promises'
import fssync from 'fs'
import os from 'os'
import crypto from 'crypto'

import { electronApp, optimizer, is } from '@electron-toolkit/utils'
import dotenv from 'dotenv'

import type {
  AppSettings,
  CreateProjectRequest,
  ProjectSummary,
  TemplateSummary,
  FileTreeNode,
  ChatMessage,
  AiRunRequest,
  AiRunResult
} from '../shared/types'

// Milestone 2 modules (kept in packages/, imported as source to avoid build-order friction in dev)
import { createAIEngine, type ChatMessage as EngineChatMessage } from '../../../../packages/engine/src/index'
import { parseAiResponse, applyChanges } from '../../../../packages/codegen/src/index'

/**
 * Load .env (in dev, this will pick up apps/studio/.env).
 */
dotenv.config()

const PROJECT_META_PATH = path.join('.vorbyte', 'project.json')
const CHAT_HISTORY_PATH = path.join('.vorbyte', 'chat.json')

const SETTINGS_PATH = path.join(app.getPath('userData'), 'settings.json')

const SKIP_TREE_NAMES = new Set(['node_modules', '.next', '.git', '.vorbyte', 'dist', 'out'])
const SKIP_COPY_NAMES = new Set(['node_modules', '.next', '.git', '.DS_Store', 'dist', 'out'])

/**
 * AbortControllers for in-flight AI runs (for cancel button).
 */
const aiRuns = new Map<string, AbortController>()

function firstEnv(names: string[]): string | undefined {
  for (const n of names) {
    const v = process.env[n]
    if (v && v.trim()) return v.trim()
  }
  return undefined
}

function findRepoRoot(startDir: string): string {
  let dir = startDir
  for (let i = 0; i < 8; i++) {
    if (
      fssync.existsSync(path.join(dir, 'pnpm-workspace.yaml')) ||
      fssync.existsSync(path.join(dir, 'turbo.json')) ||
      fssync.existsSync(path.join(dir, '.git'))
    ) {
      return dir
    }
    const parent = path.dirname(dir)
    if (parent === dir) break
    dir = parent
  }
  return startDir
}

const REPO_ROOT = findRepoRoot(process.cwd())

function resolvePathSmart(p: string): string[] {
  if (!p) return []
  if (path.isAbsolute(p)) return [p]

  // Try a few common bases:
  // - package cwd (apps/studio)
  // - repo root
  // - one and two levels above cwd (often where pnpm/turbo is executed from)
  const bases = [process.cwd(), path.resolve(process.cwd(), '..'), path.resolve(process.cwd(), '../..'), REPO_ROOT]
  const out: string[] = []
  for (const base of bases) {
    out.push(path.resolve(base, p))
  }
  return out
}

function envPathAny(names: string[]): string | undefined {
  const v = firstEnv(names)
  if (!v) return undefined
  const candidates = resolvePathSmart(v)
  for (const c of candidates) {
    if (fssync.existsSync(c)) return c
  }
  return undefined
}


function defaultProjectsRoot(): string {
  // Prefer explicit env if provided
  const p = envPathAny(['VORBYTE_PROJECTS_ROOT', 'vorbyte_PROJECTS_ROOT', 'LOCALFORGE_PROJECTS_ROOT'])
  if (p) return p
  return path.join(os.homedir(), 'VorByteProjects')
}

function templatesRoot(): string {
  return (
    envPathAny(['VORBYTE_TEMPLATES_PATH', 'vorbyte_TEMPLATES_PATH', 'LOCALFORGE_TEMPLATES_PATH']) ??
    path.resolve(REPO_ROOT, 'packages/templates')
  )
}

function templateKitRoot(): string {
  return (
    envPathAny(['VORBYTE_TEMPLATE_KIT_PATH', 'vorbyte_TEMPLATE_KIT_PATH', 'LOCALFORGE_TEMPLATE_KIT_PATH']) ??
    path.resolve(REPO_ROOT, 'packages/template-kit')
  )
}

async function ensureDir(dir: string) {
  await fs.mkdir(dir, { recursive: true })
}

async function readJson<T>(filePath: string): Promise<T | null> {
  try {
    const raw = await fs.readFile(filePath, 'utf-8')
    return JSON.parse(raw) as T
  } catch {
    return null
  }
}

async function writeJsonAtomic(filePath: string, data: unknown) {
  await ensureDir(path.dirname(filePath))
  const tmp = `${filePath}.${Date.now()}.tmp`
  await fs.writeFile(tmp, JSON.stringify(data, null, 2), 'utf-8')
  await fs.rename(tmp, filePath)
}

async function loadSettings(): Promise<AppSettings> {
  const existing = await readJson<AppSettings>(SETTINGS_PATH)
  if (existing) {
    // Normalize envVars to an array (older builds stored Record<string,string>)
    const anySettings = existing as any
    if (anySettings.envVars && !Array.isArray(anySettings.envVars)) {
      const pairs = Object.entries(anySettings.envVars).map(([key, value]) => ({
        key,
        value: String(value)
      }))
      anySettings.envVars = pairs
    }
    return anySettings
  }

  const defaults: AppSettings = {
    projectsRoot: defaultProjectsRoot(),
    openaiApiKey: '',
    aiMode: 'cloud',
    cloudModel: 'gpt-4o-mini',
    localModelPath: 'ollama:llama3.1',
    envVars: []
  }

  await writeJsonAtomic(SETTINGS_PATH, defaults)
  return defaults
}

async function saveSettings(next: AppSettings): Promise<AppSettings> {
  const current = await loadSettings()
  const merged: AppSettings = {
    ...current,
    ...next,
    envVars: Array.isArray(next.envVars) ? next.envVars : current.envVars
  }
  await writeJsonAtomic(SETTINGS_PATH, merged)
  return merged
}

async function loadTemplatesIndex(): Promise<TemplateSummary[]> {
  const root = templatesRoot()
  const indexPath = path.join(root, 'templates.index.json')
  const data = await readJson<any>(indexPath)

  // Support both formats:
  // 1) Array of templates: [ { id, name, ... } ]
  // 2) Wrapped object: { templates: [ ... ] }
  if (Array.isArray(data)) return data as TemplateSummary[]
  if (data && Array.isArray(data.templates)) return data.templates as TemplateSummary[]

  return []
}

async function templateThumbnailData(templateId: string): Promise<string | null> {
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

async function listProjects(): Promise<ProjectSummary[]> {
  const settings = await loadSettings()
  const root = settings.projectsRoot || defaultProjectsRoot()
  await ensureDir(root)

  const dirs = await fs.readdir(root, { withFileTypes: true })
  const out: ProjectSummary[] = []

  for (const d of dirs) {
    if (!d.isDirectory()) continue
    const projectPath = path.join(root, d.name)
    const metaPath = path.join(projectPath, PROJECT_META_PATH)
    const meta = await readJson<any>(metaPath)
    out.push({
      name: meta?.name ?? d.name,
      path: projectPath,
      createdAt: meta?.createdAt,
      templateId: meta?.templateId
    })
  }

  // newest first when createdAt is available
  out.sort((a, b) => (b.createdAt ?? '').localeCompare(a.createdAt ?? ''))
  return out
}

async function copyDir(src: string, dest: string) {
  await ensureDir(dest)
  await fs.cp(src, dest, {
    recursive: true,
    filter: (p) => {
      const base = path.basename(p)
      return !SKIP_COPY_NAMES.has(base)
    }
  })
}

async function createProject(req: CreateProjectRequest): Promise<ProjectSummary> {
  const settings = await loadSettings()
  const projectsRoot = settings.projectsRoot || defaultProjectsRoot()
  await ensureDir(projectsRoot)

  const name = (req.name || 'Untitled').trim()
  const projectPath = path.join(projectsRoot, name)

  if (fssync.existsSync(projectPath)) {
    throw new Error(`Project folder already exists: ${projectPath}`)
  }

  // 1) Copy template kit scaffold
  const kitPath = templateKitRoot()
  if (!fssync.existsSync(kitPath)) {
    throw new Error(
      `Template kit not found at ${kitPath}. Set VORBYTE_TEMPLATE_KIT_PATH (or vorbyte_TEMPLATE_KIT_PATH) to the kit folder.`
    )
  }
  await copyDir(kitPath, projectPath)

  // 2) Apply template overlay (optional)
  const templateId = req.templateId
  if (templateId) {
    const templates = await loadTemplatesIndex()
    const tmpl = templates.find((t) => t.id === templateId)
    if (!tmpl) throw new Error(`Template not found: ${templateId}`)
    const overlayPath = path.isAbsolute(tmpl.overlayDir) ? tmpl.overlayDir : path.join(templatesRoot(), tmpl.overlayDir)
    if (!fssync.existsSync(overlayPath)) throw new Error(`Overlay folder missing: ${overlayPath}`)
    await copyDir(overlayPath, projectPath)
  }

  // 3) Write VorByte project metadata
  const createdAt = new Date().toISOString()
  const meta = {
    name,
    createdAt,
    templateId: templateId ?? null,
    ai: {
      aiMode: req.aiMode ?? settings.aiMode ?? 'local',
      cloudModel: req.cloudModel ?? settings.cloudModel ?? null,
      localModel: req.localModel ?? settings.localModelPath ?? null,
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

  return { name, path: projectPath, createdAt, templateId }
}

async function buildTree(rootPath: string, maxDepth = 5, depth = 0): Promise<FileTreeNode> {
  const name = path.basename(rootPath)
  const node: FileTreeNode = { path: rootPath, name, type: 'dir', children: [] }
  if (depth >= maxDepth) return node

  const entries = await fs.readdir(rootPath, { withFileTypes: true })
  for (const e of entries) {
    if (SKIP_TREE_NAMES.has(e.name)) continue
    const p = path.join(rootPath, e.name)
    if (e.isDirectory()) {
      node.children!.push(await buildTree(p, maxDepth, depth + 1))
    } else {
      node.children!.push({ path: p, name: e.name, type: 'file' })
    }
  }

  node.children!.sort((a, b) => {
    if (a.type !== b.type) return a.type === 'dir' ? -1 : 1
    return a.name.localeCompare(b.name)
  })

  return node
}

function toEngineMessages(chat: ChatMessage[]): EngineChatMessage[] {
  return chat.map((m) => ({ role: m.role, content: m.content }))
}

async function loadChat(projectPath: string): Promise<ChatMessage[]> {
  const chatPath = path.join(projectPath, CHAT_HISTORY_PATH)
  const data = await readJson<ChatMessage[]>(chatPath)
  return Array.isArray(data) ? data : []
}

async function saveChat(projectPath: string, chat: ChatMessage[]) {
  const chatPath = path.join(projectPath, CHAT_HISTORY_PATH)
  await writeJsonAtomic(chatPath, chat)
}

function buildSystemPrompt(): string {
  return [
    'You are VorByte, an expert Next.js (App Router) + Tailwind + shadcn/ui developer.',
    '',
    'Your job is to generate or modify code in the user\'s Next.js project.',
    '',
    'Hard requirements:',
    '- Use Next.js App Router conventions (app/ directory).',
    '- Use Tailwind for styling.',
    '- Prefer functional React components.',
    '- Output MUST be parseable by the app.',
    '',
    'Output format (VERY IMPORTANT):',
    '1) Start with a short plain-English summary (what you changed).',
    '2) Then, for every file you want to create or change, output:',
    '',
    'File: relative/path/from/project/root',
    '```tsx',
    '...full file content...',
    '```',
    '',
    '3) If you introduce new npm dependencies, add a line:',
    'Dependencies: ["package-a","package-b"]',
    '',
    'Rules:',
    '- Always provide FULL file contents (not diffs).',
    '- Use relative paths only. Do NOT use absolute paths.',
    '- Do NOT include prose inside code fences.',
    '- If no files need changing, output only the summary and no File blocks.'
  ].join('\n')
}

async function buildFileTreeContext(projectPath: string): Promise<string> {
  // Provide a lightweight file list so the model can pick correct paths.
  const maxFiles = 250
  const out: string[] = []

  async function walk(dir: string, prefix: string) {
    const entries = await fs.readdir(dir, { withFileTypes: true })
    for (const e of entries) {
      if (SKIP_TREE_NAMES.has(e.name)) continue
      const abs = path.join(dir, e.name)
      const rel = path.posix.join(prefix, e.name)
      if (out.length >= maxFiles) return
      if (e.isDirectory()) {
        out.push(rel + '/')
        await walk(abs, rel)
      } else {
        out.push(rel)
      }
      if (out.length >= maxFiles) return
    }
  }

  await walk(projectPath, '')
  return `Project file tree (partial):\n${out.map((p) => `- ${p}`).join('\n')}`
}

function parseLocalModel(raw: string | undefined): { provider: 'ollama'; model: string } {
  const fallback = { provider: 'ollama' as const, model: 'llama3.1' }
  if (!raw) return fallback
  const v = raw.trim()
  if (!v) return fallback
  const parts = v.split(':')
  if (parts.length >= 2) {
    const provider = parts[0].trim().toLowerCase()
    const model = parts.slice(1).join(':').trim()
    if (provider === 'ollama' && model) return { provider: 'ollama', model }
  }
  // If no provider prefix, assume ollama model name
  return { provider: 'ollama', model: v }
}

async function runAiAndApply(req: AiRunRequest): Promise<AiRunResult> {
  const settings = await loadSettings()
  const projectPath = req.projectPath

  // Basic existence check
  if (!fssync.existsSync(projectPath)) {
    throw new Error(`Project path not found: ${projectPath}`)
  }

  const metaPath = path.join(projectPath, PROJECT_META_PATH)
  const meta = (await readJson<any>(metaPath)) ?? {}

  const aiMode: 'local' | 'cloud' = meta?.ai?.aiMode ?? settings.aiMode ?? 'local'
  const cloudModel = meta?.ai?.cloudModel ?? settings.cloudModel ?? 'gpt-4o-mini'
  const localModelRaw = meta?.ai?.localModel ?? settings.localModelPath ?? 'ollama:llama3.1'

  const requestId = req.requestId || crypto.randomUUID()
  const ac = new AbortController()
  aiRuns.set(requestId, ac)

  // Basic timeout guard (prevents hung requests)
  const timeoutMs = 3 * 60 * 1000
  const timeout = setTimeout(() => ac.abort(), timeoutMs)

  try {
    const systemPrompt = buildSystemPrompt()
    const treeContext = await buildFileTreeContext(projectPath)

    const chat = await loadChat(projectPath)
    const userMsg: ChatMessage = {
      id: crypto.randomUUID(),
      role: 'user',
      content: req.prompt,
      createdAt: new Date().toISOString()
    }

    const nextChat = [...chat, userMsg]

    // Build provider engine
    const engine =
      aiMode === 'cloud'
        ? (() => {
            const baseUrl = firstEnv(['VORBYTE_OPENAI_BASE_URL', 'vorbyte_OPENAI_BASE_URL'])
            const apiKey = settings.openaiApiKey?.trim() ?? ''
            const isLocalBaseUrl = !!baseUrl && /(localhost|127\.0\.0\.1)/.test(baseUrl)
            if (!apiKey && !isLocalBaseUrl) {
              throw new Error('OpenAI API key is missing. Set it in Settings (Cloud mode).')
            }
            return createAIEngine({
              provider: 'openai',
              openai: { apiKey: apiKey || 'local', model: cloudModel, baseUrl, temperature: 0.2 }
            })
          })()
        : (() => {
            const { model } = parseLocalModel(localModelRaw)
            const baseUrl = firstEnv(['VORBYTE_OLLAMA_BASE_URL', 'vorbyte_OLLAMA_BASE_URL']) ?? 'http://localhost:11434'
            return createAIEngine({
              provider: 'ollama',
              ollama: { baseUrl, model, temperature: 0.2 }
            })
          })()

    const messages: EngineChatMessage[] = [
      { role: 'system', content: systemPrompt },
      { role: 'system', content: treeContext },
      ...toEngineMessages(nextChat)
    ]

    const { text } = await engine.chat({ messages, signal: ac.signal, stream: false })

    // Parse code blocks + deps
    const parsed = parseAiResponse(text)

    // Apply changes to filesystem
    const applyRes = await applyChanges({
      projectDir: projectPath,
      files: parsed.files,
      dependencies: parsed.dependencies
    })

    const summary = parsed.summary || 'Done.'
    const parts: string[] = [summary]

    if (applyRes.writtenFiles.length > 0) {
      parts.push('', '✅ Updated files:', ...applyRes.writtenFiles.map((f) => `- ${f}`))
    }
    if (applyRes.installedDependencies.length > 0) {
      parts.push('', '📦 Installed dependencies:', ...applyRes.installedDependencies.map((d) => `- ${d}`))
    }
    if (parsed.files.length === 0) {
      parts.push('', '_No file blocks were returned by the model._')
    }

    const assistantMsg: ChatMessage = {
      id: crypto.randomUUID(),
      role: 'assistant',
      content: parts.join('\n'),
      createdAt: new Date().toISOString()
    }

    const finalChat = [...nextChat, assistantMsg]
    await saveChat(projectPath, finalChat)

    return {
      chat: finalChat,
      appliedFiles: applyRes.writtenFiles,
      installedDependencies: applyRes.installedDependencies
    }
  } finally {
    clearTimeout(timeout)
    aiRuns.delete(requestId)
  }
}

let mainWindow: BrowserWindow | null = null

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 800,
    show: false,
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, '../preload/index.js'),
      sandbox: true
    }
  })

  mainWindow.on('ready-to-show', () => {
    mainWindow?.show()
  })

  mainWindow.webContents.setWindowOpenHandler((details) => {
    require('electron').shell.openExternal(details.url)
    return { action: 'deny' }
  })

  if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
    mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    mainWindow.loadFile(path.join(__dirname, '../renderer/index.html'))
  }
}

app.whenReady().then(() => {
  electronApp.setAppUserModelId('com.vorbyte')

  app.on('browser-window-created', (_, window) => {
    optimizer.watchWindowShortcuts(window)
  })

  createWindow()

  app.on('activate', function () {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})

/**
 * IPC handlers
 */
ipcMain.handle('settings:get', async () => loadSettings())
ipcMain.handle('settings:save', async (_evt, next: AppSettings) => saveSettings(next))

ipcMain.handle('templates:list', async () => loadTemplatesIndex())
ipcMain.handle('templates:thumbnailData', async (_evt, templateId: string) => templateThumbnailData(templateId))

ipcMain.handle('projects:list', async () => listProjects())
ipcMain.handle('projects:create', async (_evt, req: CreateProjectRequest) => createProject(req))

ipcMain.handle('fs:tree', async (_evt, rootPath: string, opts?: { maxDepth?: number }) => {
  const maxDepth = opts?.maxDepth ?? 5
  return buildTree(rootPath, maxDepth)
})

ipcMain.handle('chat:load', async (_evt, projectPath: string) => loadChat(projectPath))
ipcMain.handle('chat:clear', async (_evt, projectPath: string) => {
  await saveChat(projectPath, [])
  return true
})

ipcMain.handle('ai:run', async (_evt, req: AiRunRequest) => {
  return runAiAndApply(req)
})

ipcMain.handle('ai:cancel', async (_evt, requestId: string) => {
  const ac = aiRuns.get(requestId)
  if (ac) ac.abort()
  return true
})

ipcMain.handle('dialog:selectDirectory', async (_evt, opts?: { defaultPath?: string }) => {
  const result = await dialog.showOpenDialog(mainWindow!, {
    title: 'Select a folder',
    properties: ['openDirectory'],
    defaultPath: opts?.defaultPath
  })
  if (result.canceled) return null
  return result.filePaths[0] ?? null
})