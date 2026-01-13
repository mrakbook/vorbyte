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
  AiRunResult,
  DesignApplyRequest,
  DesignApplyResult
} from '../shared/types'

// Milestone 2 modules (kept in packages/, imported as source to avoid build-order friction in dev)
import { createAIEngine, type ChatMessage as EngineChatMessage } from '../../../../packages/engine/src/index'
import { parseAiResponse, applyChanges } from '../../../../packages/codegen/src/index'
import { createPreviewManager } from '../../../../packages/preview/src/index'
import { ensureDesignBridge } from './design/ensureBridge'

/**
 * Load .env (in dev, this will pick up apps/studio/.env).
 */
dotenv.config()

// Milestone 3: Preview server manager (Next.js dev server runner)
const previewManager = createPreviewManager()

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

function sanitizeFolderName(name: string): string {
  const trimmed = (name ?? '').trim()
  const base = trimmed.length ? trimmed : 'Untitled'
  // Prevent path traversal / separators & keep it reasonably filesystem-friendly
  return base
    .replace(/[\\\/\0]/g, '-') // path separators and NUL
    .replace(/[:*?"<>|]/g, '-') // Windows-illegal chars (also safe on macOS)
    .trim()
    .slice(0, 80)
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

  const displayName = (req.name || 'Untitled').trim() || 'Untitled'
  const folderBase = sanitizeFolderName(displayName)
  const templateId = (req.templateId ?? 'scratch').trim() || 'scratch'

  const kitPath = templateKitRoot()
  if (!fssync.existsSync(kitPath)) {
    throw new Error(
      `Template kit not found at: ${kitPath}. Ensure packages/template-kit exists, or set VORBYTE_TEMPLATE_KIT_PATH.`
    )
  }

  const applyTemplateOverlay = async (projectPath: string) => {
    if (templateId === 'scratch') return
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

  const writeMetaAndChatIfMissing = async (projectPath: string, createdAt: string) => {
    const metaPath = path.join(projectPath, PROJECT_META_PATH)
    const chatPath = path.join(projectPath, CHAT_HISTORY_PATH)

    const existingMeta = await readJson<any>(metaPath)
    if (!existingMeta) {
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
      await writeJsonAtomic(metaPath, meta)
    }

    if (!fssync.existsSync(chatPath)) {
      await writeJsonAtomic(chatPath, [])
    }
  }

  const openOrAdoptExistingProject = async (projectPath: string): Promise<ProjectSummary> => {
    const metaPath = path.join(projectPath, PROJECT_META_PATH)
    const stat = await fs.stat(projectPath)
    const createdAt = stat.birthtime?.toISOString?.() ?? new Date().toISOString()

    // If it already has meta, just return it
    const meta = await readJson<any>(metaPath)
    if (meta) {
      await writeMetaAndChatIfMissing(projectPath, meta.createdAt ?? createdAt)
      return {
        name: meta.name ?? displayName,
        path: projectPath,
        createdAt: meta.createdAt ?? createdAt,
        templateId: meta.templateId ?? templateId
      }
    }

    // If the folder exists but doesn't look like a Next.js project yet, we can "repair" it
    // ONLY when it's empty-ish (so we don't overwrite user data).
    const pkgPath = path.join(projectPath, 'package.json')
    const hasPkg = fssync.existsSync(pkgPath)

    if (!hasPkg) {
      const entries = await fs.readdir(projectPath).catch(() => [])
      const nonMetaEntries = entries.filter((e) => e !== '.vorbyte' && e !== '.git')
      const safeToScaffold = nonMetaEntries.length === 0

      if (safeToScaffold) {
        await copyDir(kitPath, projectPath)
        await applyTemplateOverlay(projectPath)

        const repairedAt = new Date().toISOString()
        await writeMetaAndChatIfMissing(projectPath, repairedAt)
        return { name: displayName, path: projectPath, createdAt: repairedAt, templateId }
      }
    }

    // Otherwise: adopt the folder as a VorByte project by writing meta (without touching files)
    await writeMetaAndChatIfMissing(projectPath, createdAt)
    const adoptedMeta = await readJson<any>(metaPath)

    return {
      name: adoptedMeta?.name ?? displayName,
      path: projectPath,
      createdAt: adoptedMeta?.createdAt ?? createdAt,
      templateId: adoptedMeta?.templateId ?? templateId
    }
  }

  // Target folder path (default behavior is "open existing" rather than error)
  let projectPath = path.join(projectsRoot, folderBase)

  if (fssync.existsSync(projectPath)) {
    const stat = await fs.stat(projectPath).catch(() => null)
    if (stat?.isDirectory()) {
      return await openOrAdoptExistingProject(projectPath)
    }

    // It's a file (or something odd) -> create a unique folder name
    let n = 2
    while (fssync.existsSync(projectPath)) {
      projectPath = path.join(projectsRoot, `${folderBase}-${n}`)
      n += 1
    }
  }

  // 1) Copy template kit scaffold
  await copyDir(kitPath, projectPath)

  // 2) Apply template overlay (optional)
  await applyTemplateOverlay(projectPath)

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
    "Your job is to generate or modify code in the user's Next.js project.",
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

app.on('before-quit', () => {
  previewManager.stopAll().catch(() => {})
})

app.on('window-all-closed', () => {
  // On macOS, the app stays alive after closing windows. Ensure we don't leave orphan preview servers.
  void previewManager.stopAll().catch(() => {})
  if (process.platform !== 'darwin') app.quit()
})

/**
 * IPC handlers
 */
/**
 * Milestone 4 (WYSIWYG): Apply a visual edit by doing a best-effort find/replace in the user's code.
 *
 * NOTE: This is intentionally conservative and heuristic-based (no AST yet). It works best for:
 * - App Router pages (e.g., src/app/.../page.tsx)
 * - Unique text edits
 * - Simple className strings (no heavy conditional concatenation)
 */
function normalizeRoute(route: string): string {
  const raw = (route ?? '').toString().trim()
  if (!raw) return '/'
  const noHash = raw.split('#')[0] ?? raw
  const noQuery = noHash.split('?')[0] ?? noHash
  const withLeading = noQuery.startsWith('/') ? noQuery : `/${noQuery}`
  return withLeading === '' ? '/' : withLeading
}

function candidatePageRelPaths(route: string): string[] {
  const r = normalizeRoute(route)
  const segs = r.split('/').filter(Boolean)

  // Next.js App Router
  const appSubPath = segs.length ? `${segs.join('/')}/page.tsx` : 'page.tsx'
  const appSubPathJsx = segs.length ? `${segs.join('/')}/page.jsx` : 'page.jsx'
  const appSubPathTs = segs.length ? `${segs.join('/')}/page.ts` : 'page.ts'
  const appSubPathJs = segs.length ? `${segs.join('/')}/page.js` : 'page.js'

  // Next.js Pages Router fallbacks
  const pagesPath = segs.length ? `${segs.join('/')}.tsx` : 'index.tsx'
  const pagesPathJsx = segs.length ? `${segs.join('/')}.jsx` : 'index.jsx'

  const candidates = [
    // App Router (common)
    `src/app/${appSubPath}`,
    `app/${appSubPath}`,
    `src/app/${appSubPathJsx}`,
    `app/${appSubPathJsx}`,
    `src/app/${appSubPathTs}`,
    `app/${appSubPathTs}`,
    `src/app/${appSubPathJs}`,
    `app/${appSubPathJs}`,

    // Pages Router
    `src/pages/${pagesPath}`,
    `pages/${pagesPath}`,
    `src/pages/${pagesPathJsx}`,
    `pages/${pagesPathJsx}`
  ]

  // De-dupe
  return Array.from(new Set(candidates))
}

async function firstExistingRelPath(projectDir: string, relPaths: string[]): Promise<string | null> {
  for (const rel of relPaths) {
    const abs = path.join(projectDir, rel)
    try {
      const st = await fsp.stat(abs)
      if (st.isFile()) return rel
    } catch {
      // ignore
    }
  }
  return null
}

const DESIGN_SCAN_SKIP_DIRS = new Set([
  'node_modules',
  '.next',
  '.git',
  'dist',
  'out',
  'build',
  '.turbo',
  '.cache'
])

async function listCodeFiles(root: string, exts: Set<string>, limit: number): Promise<string[]> {
  const results: string[] = []

  async function walk(dir: string) {
    if (results.length >= limit) return

    let entries: fs.Dirent[]
    try {
      entries = await fsp.readdir(dir, { withFileTypes: true })
    } catch {
      return
    }

    for (const ent of entries) {
      if (results.length >= limit) return
      const name = ent.name
      if (ent.isDirectory()) {
        if (DESIGN_SCAN_SKIP_DIRS.has(name)) continue
        await walk(path.join(dir, name))
        continue
      }
      if (!ent.isFile()) continue

      const ext = path.extname(name).toLowerCase()
      if (!exts.has(ext)) continue
      results.push(path.join(dir, name))
    }
  }

  await walk(root)
  return results
}

function replaceOnce(haystack: string, needle: string, replacement: string): string | null {
  const idx = haystack.indexOf(needle)
  if (idx === -1) return null
  return haystack.slice(0, idx) + replacement + haystack.slice(idx + needle.length)
}

async function applyDesignEdit(req: DesignApplyRequest): Promise<DesignApplyResult> {
  const projectDir = req.projectPath
  if (!projectDir) return { ok: false, message: 'Missing projectPath' }

  const wantText =
    typeof req.originalText === 'string' &&
    typeof req.newText === 'string' &&
    req.originalText !== req.newText &&
    req.originalText.trim().length > 0

  const wantClass =
    typeof req.originalClassName === 'string' &&
    typeof req.newClassName === 'string' &&
    req.originalClassName !== req.newClassName &&
    req.originalClassName.trim().length > 0

  if (!wantText && !wantClass) {
    return { ok: false, message: 'Nothing to apply (no changes detected).' }
  }

  const route = normalizeRoute(req.route)
  const candidatesAbs: string[] = []
  const seen = new Set<string>()

  // 1) Prefer the route's page file if it exists.
  const primaryRel = await firstExistingRelPath(projectDir, candidatePageRelPaths(route))
  if (primaryRel) {
    const abs = path.join(projectDir, primaryRel)
    candidatesAbs.push(abs)
    seen.add(abs)
  }

  // 2) Fallback: scan likely source roots for any file that contains the original text/class.
  const scanRoots = [
    path.join(projectDir, 'src'),
    path.join(projectDir, 'app'),
    path.join(projectDir, 'components'),
    path.join(projectDir, 'src', 'components'),
    path.join(projectDir, 'src', 'app')
  ]

  const exts = new Set(['.tsx', '.ts', '.jsx', '.js'])
  const scanLimit = 500

  for (const root of scanRoots) {
    try {
      const st = await fsp.stat(root)
      if (!st.isDirectory()) continue
    } catch {
      continue
    }

    const files = await listCodeFiles(root, exts, scanLimit)
    for (const f of files) {
      if (seen.has(f)) continue
      candidatesAbs.push(f)
      seen.add(f)
    }
  }

  let lastMissReason = 'No matching file found.'
  for (const absPath of candidatesAbs) {
    let src: string
    try {
      src = await fsp.readFile(absPath, 'utf8')
    } catch {
      continue
    }

    let next = src
    let changed = false

    if (wantText) {
      const patched = replaceOnce(next, req.originalText!, req.newText!)
      if (patched) {
        next = patched
        changed = true
      } else {
        lastMissReason = `Could not find original text in ${path.relative(projectDir, absPath)}`
      }
    }

    if (wantClass) {
      const patched = replaceOnce(next, req.originalClassName!, req.newClassName!)
      if (patched) {
        next = patched
        changed = true
      } else {
        lastMissReason = `Could not find original className in ${path.relative(projectDir, absPath)}`
      }
    }

    if (!changed) continue

    const rel = path.relative(projectDir, absPath).replace(/\\/g, '/')
    await applyChanges({
      projectDir,
      files: [{ path: rel, content: next }],
      dependencies: []
    })

    return { ok: true, updatedFile: rel }
  }

  return {
    ok: false,
    message:
      lastMissReason +
      ' This WYSIWYG editor is best-effort right now. If it cannot locate the right source, switch to Chat mode and ask the AI to make the change.'
  }
}

ipcMain.handle('settings:get', async () => loadSettings())
ipcMain.handle('settings:save', async (_evt, next: AppSettings) => saveSettings(next))

ipcMain.handle('templates:list', async () => loadTemplatesIndex())
ipcMain.handle('templates:thumbnailData', async (_evt, templateId: string) => templateThumbnailData(templateId))

ipcMain.handle('projects:list', async () => listProjects())
ipcMain.handle('projects:create', async (_evt, req: CreateProjectRequest) => createProject(req))

ipcMain.handle('projects:tree', async (_evt, projectPath: string, opts?: { maxDepth?: number }) => {
  const maxDepth = opts?.maxDepth ?? 5
  return buildTree(projectPath, maxDepth)
})

ipcMain.handle('fs:tree', async (_evt, rootPath: string, opts?: { maxDepth?: number }) => {
  const maxDepth = opts?.maxDepth ?? 5
  return buildTree(rootPath, maxDepth)
})

ipcMain.handle('chat:read', async (_evt, projectPath: string) => loadChat(projectPath))

ipcMain.handle('chat:write', async (_evt, projectPath: string, chat: ChatMessage[]) => {
  if (!Array.isArray(chat)) {
    throw new Error('chat:write expected an array of messages')
  }
  await saveChat(projectPath, chat)
  return true
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

// Milestone 3: Live Preview (Next.js dev server) IPC
ipcMain.handle('preview:start', async (_evt, projectPath: string, opts?: { port?: number; autoInstallDeps?: boolean }) => {
  // Ensure the project has the in-preview design bridge (route tracking, inspect mode, etc.)
  // Best-effort: preview should still start even if bridge injection fails.
  try {
    await ensureDesignBridge(projectPath)
  } catch {
    // ignore
  }

  return previewManager.start({
    projectPath,
    port: opts?.port,
    autoInstallDeps: opts?.autoInstallDeps
  })
})

ipcMain.handle('preview:stop', async (_evt, projectPath: string) => {
  return previewManager.stop(projectPath)
})

ipcMain.handle('preview:status', async (_evt, projectPath: string) => {
  return previewManager.status(projectPath)
})

ipcMain.handle('preview:logs', async (_evt, projectPath: string, opts?: { tail?: number }) => {
  return previewManager.logs(projectPath, opts)
})


ipcMain.handle('design:apply', async (_evt, req: DesignApplyRequest): Promise<DesignApplyResult> => {
  return applyDesignEdit(req)
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

