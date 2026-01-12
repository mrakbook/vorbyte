import 'dotenv/config'

import { app, shell, BrowserWindow, ipcMain, dialog } from 'electron'
import { electronApp, optimizer, is } from '@electron-toolkit/utils'

import path from 'path'
import os from 'os'
import fs from 'fs/promises'
import { spawn } from 'child_process'

import type {
  AppSettings,
  CreateProjectRequest,
  EnvVarEntry,
  FileTreeNode,
  ProjectSummary,
  TemplateSummary
} from '../shared/types'

const SETTINGS_FILE = 'settings.json'
const PROJECT_META_PATH = path.join('.vorbyte', 'project.json')

// Hide internal folders from the file tree shown in the sidebar.
const SKIP_TREE_NAMES = new Set(['node_modules', '.git', '.next', 'dist', 'out', '.vorbyte'])
const SKIP_COPY_NAMES = new Set(['node_modules', '.git', '.next', 'dist', 'out'])

// Back-compat: accept both old LocalForge env vars and new VorByte env vars.
// Prefer VorByte first.
const ENV = {
  projectsRoot: ['vorbyte_PROJECTS_ROOT', 'VORBYTE_PROJECTS_ROOT', 'LOCALFORGE_PROJECTS_ROOT'],
  templatesPath: ['vorbyte_TEMPLATES_PATH', 'VORBYTE_TEMPLATES_PATH', 'LOCALFORGE_TEMPLATES_PATH'],
  templateKitPath: [
    'vorbyte_TEMPLATE_KIT_PATH',
    'VORBYTE_TEMPLATE_KIT_PATH',
    'LOCALFORGE_TEMPLATE_KIT_PATH'
  ]
}

function expandHome(p: string): string {
  if (p === '~') return os.homedir()
  if (p.startsWith('~/')) return path.join(os.homedir(), p.slice(2))
  return p
}

function resolveFromCwd(p: string): string {
  const expanded = expandHome(p)
  return path.isAbsolute(expanded) ? expanded : path.resolve(process.cwd(), expanded)
}

function firstEnv(names: string[]): string | null {
  for (const name of names) {
    const raw = process.env[name]
    if (raw && raw.trim()) return raw.trim()
  }
  return null
}

function envPathAny(names: string[]): string | null {
  const raw = firstEnv(names)
  if (!raw) return null
  return resolveFromCwd(raw)
}

async function pathExists(p: string): Promise<boolean> {
  try {
    await fs.access(p)
    return true
  } catch {
    return false
  }
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
  await fs.mkdir(path.dirname(filePath), { recursive: true })
  const tmp = `${filePath}.tmp`
  await fs.writeFile(tmp, JSON.stringify(data, null, 2), 'utf-8')
  await fs.rename(tmp, filePath)
}

function defaultProjectsRoot(): string {
  const envRoot = envPathAny(ENV.projectsRoot)
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

function normalizeEnvVars(raw: unknown): EnvVarEntry[] {
  if (Array.isArray(raw)) {
    return raw.map((kv: any) => ({
      key: String(kv?.key ?? ''),
      value: String(kv?.value ?? '')
    }))
  }

  // Back-compat: older settings might have stored envVars as an object map
  if (raw && typeof raw === 'object') {
    return Object.entries(raw as Record<string, unknown>).map(([k, v]) => ({
      key: String(k),
      value: String(v ?? '')
    }))
  }

  return []
}

function normalizeSettings(raw: unknown): AppSettings {
  const def = defaultSettings()
  const r: any = raw ?? {}

  return {
    projectsRoot:
      typeof r.projectsRoot === 'string' && r.projectsRoot.trim() ? r.projectsRoot.trim() : def.projectsRoot,
    openaiApiKey: typeof r.openaiApiKey === 'string' ? r.openaiApiKey : def.openaiApiKey,
    localModelPath: typeof r.localModelPath === 'string' ? r.localModelPath : def.localModelPath,
    envVars: normalizeEnvVars(r.envVars)
  }
}

async function loadSettings(): Promise<AppSettings> {
  const raw = await readJson<any | null>(settingsPath(), null)
  return normalizeSettings(raw)
}

async function saveSettings(next: AppSettings): Promise<AppSettings> {
  const normalized = normalizeSettings(next)
  await writeJsonAtomic(settingsPath(), normalized)
  return normalized
}

function getProjectsRoot(settings: AppSettings): string {
  const root = settings.projectsRoot?.trim() ? settings.projectsRoot.trim() : defaultProjectsRoot()
  return resolveFromCwd(root)
}

function safeFolderName(name: string): string {
  const raw = (name ?? '').trim()
  const base = raw.length ? raw : 'new-project'
  const slug = base
    .toLowerCase()
    .replace(/[^a-z0-9-_ ]/g, '')
    .trim()
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .slice(0, 64)
  return slug.length ? slug : 'project'
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

async function gitInit(projectDir: string): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const child = spawn('git', ['init'], { cwd: projectDir })
    child.on('error', reject)
    child.on('exit', (code) => {
      if (code === 0) resolve()
      else reject(new Error(`git init failed (exit code ${code ?? 'unknown'})`))
    })
  })
}

async function resolveTemplatesRoot(): Promise<string> {
  const fromEnv = envPathAny(ENV.templatesPath)
  const root = fromEnv ?? resolveFromCwd('../../packages/templates')

  if (!(await pathExists(root))) {
    throw new Error(
      [
        `Templates path not found: ${root}`,
        `Set vorbyte_TEMPLATES_PATH (or VORBYTE_TEMPLATES_PATH) in apps/studio/.env`,
        `Example: vorbyte_TEMPLATES_PATH=../../packages/templates`
      ].join('\n')
    )
  }

  return root
}

async function resolveTemplateKitRoot(): Promise<string> {
  const fromEnv = envPathAny(ENV.templateKitPath)
  const root = fromEnv ?? resolveFromCwd('../../packages/template-kit')

  if (!(await pathExists(root))) {
    throw new Error(
      [
        `Template kit path not found: ${root}`,
        `Set vorbyte_TEMPLATE_KIT_PATH (or VORBYTE_TEMPLATE_KIT_PATH) in apps/studio/.env`,
        `Example: vorbyte_TEMPLATE_KIT_PATH=../../packages/template-kit`
      ].join('\n')
    )
  }

  return root
}

function normalizeTemplatesIndex(raw: unknown): TemplateSummary[] {
  if (!Array.isArray(raw)) return []

  const out: TemplateSummary[] = []
  for (const t of raw) {
    if (!t || typeof t !== 'object') continue

    const id = String((t as any).id ?? '').trim()
    const name = String((t as any).name ?? '').trim()
    const description = String((t as any).description ?? '').trim()
    const overlayDir = String((t as any).overlayDir ?? '').trim()
    const thumbnailRaw = (t as any).thumbnail
    const tagsRaw = (t as any).tags

    if (!id || !name || !description || !overlayDir) continue

    out.push({
      id,
      name,
      description,
      overlayDir,
      thumbnail: thumbnailRaw ? String(thumbnailRaw) : undefined,
      tags: Array.isArray(tagsRaw) ? tagsRaw.map((x: any) => String(x)) : []
    })
  }

  return out
}

async function loadTemplatesIndex(): Promise<TemplateSummary[]> {
  const templatesRoot = await resolveTemplatesRoot()
  const indexPath = path.join(templatesRoot, 'templates.index.json')
  const raw = await readJson<any>(indexPath, [])
  return normalizeTemplatesIndex(raw)
}

async function listProjects(): Promise<ProjectSummary[]> {
  const settings = await loadSettings()
  const root = getProjectsRoot(settings)
  await fs.mkdir(root, { recursive: true })

  const entries = await fs.readdir(root, { withFileTypes: true })
  const dirs = entries.filter((e) => e.isDirectory()).map((e) => e.name)

  const results: ProjectSummary[] = []
  for (const dirName of dirs) {
    const projectPath = path.join(root, dirName)
    const metaPath = path.join(projectPath, PROJECT_META_PATH)
    const meta = await readJson<any | null>(metaPath, null)

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

async function tryUpdateProjectPackageJson(projectDir: string, projectName: string): Promise<void> {
  const pkgPath = path.join(projectDir, 'package.json')
  try {
    const txt = await fs.readFile(pkgPath, 'utf-8')
    const pkg = JSON.parse(txt) as any
    pkg.name = safeFolderName(projectName)
    pkg.private = true
    await writeJsonAtomic(pkgPath, pkg)
  } catch {
    // optional; ignore if missing/invalid
  }
}

async function createProject(req: CreateProjectRequest): Promise<ProjectSummary> {
  const settings = await loadSettings()
  const root = getProjectsRoot(settings)
  await fs.mkdir(root, { recursive: true })

  const baseFolder = safeFolderName(req.name)
  let projectDir = path.join(root, baseFolder)
  let n = 2
  while (await pathExists(projectDir)) {
    projectDir = path.join(root, `${baseFolder}-${n}`)
    n += 1
  }

  // 1) copy template kit
  const kitRoot = await resolveTemplateKitRoot()
  await copyDir(kitRoot, projectDir)

  // 2) apply template overlay (optional)
  const templateId = req.templateId ?? 'scratch'
  if (templateId !== 'scratch') {
    const templatesRoot = await resolveTemplatesRoot()
    const index = await loadTemplatesIndex()
    const tpl = index.find((t) => t.id === templateId)
    if (!tpl) throw new Error(`Unknown template: ${templateId}`)

    const overlayAbs = path.join(templatesRoot, tpl.overlayDir)
    await copyDir(overlayAbs, projectDir)
  }

  // 3) write meta
  const createdAt = new Date().toISOString()
  const meta = {
    name: (req.name ?? '').trim() || baseFolder,
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

  await writeJsonAtomic(path.join(projectDir, PROJECT_META_PATH), meta)

  // 3.5) make the generated project package.json a real project (not "template-kit")
  await tryUpdateProjectPackageJson(projectDir, meta.name)

  // 4) optional git init
  if (req.initGit) {
    try {
      await gitInit(projectDir)
    } catch (err) {
      console.warn('[gitInit] failed:', err)
    }
  }

  return {
    name: meta.name,
    path: projectDir,
    createdAt: meta.createdAt,
    templateId: meta.templateId
  }
}

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

function createWindow(): void {
  const mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    show: false,
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, '../preload/index.js'),
      sandbox: false
    }
  })

  mainWindow.on('ready-to-show', () => mainWindow.show())

  mainWindow.webContents.setWindowOpenHandler((details) => {
    shell.openExternal(details.url)
    return { action: 'deny' }
  })

  if (is.dev && process.env.ELECTRON_RENDERER_URL) {
    mainWindow.loadURL(process.env.ELECTRON_RENDERER_URL)
  } else {
    mainWindow.loadFile(path.join(__dirname, '../renderer/index.html'))
  }
}

app.whenReady().then(() => {
  electronApp.setAppUserModelId('com.vorbyte.studio')
  app.on('browser-window-created', (_, window) => optimizer.watchWindowShortcuts(window))

  ipcMain.handle('settings:get', async () => loadSettings())
  ipcMain.handle('settings:save', async (_evt, next: AppSettings) => saveSettings(next))

  ipcMain.handle('templates:list', async () => loadTemplatesIndex())

  ipcMain.handle('projects:list', async () => listProjects())
  ipcMain.handle('projects:create', async (_evt, req: CreateProjectRequest) => createProject(req))

  ipcMain.handle('fs:tree', async (_evt, rootPath: string, opts?: { maxDepth?: number }) => {
    const maxDepth = Math.max(1, Math.min(12, opts?.maxDepth ?? 5))
    return buildTree(rootPath, maxDepth)
  })

  ipcMain.handle('dialog:selectDirectory', async (_evt, opts?: { defaultPath?: string }) => {
    const res = await dialog.showOpenDialog({
      defaultPath: opts?.defaultPath ? resolveFromCwd(opts.defaultPath) : undefined,
      properties: ['openDirectory', 'createDirectory']
    })
    if (res.canceled || !res.filePaths?.length) return null
    return res.filePaths[0]
  })

  createWindow()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
