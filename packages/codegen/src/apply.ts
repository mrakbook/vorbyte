import fs from 'node:fs/promises'
import path from 'node:path'
import { spawn } from 'node:child_process'
import type { ApplyResult, FileChange } from './types'
import { formatTextIfSupported } from './format'
import { choosePackageManager, readProjectDeps, inferDependenciesFromFiles } from './deps'

const DEFAULT_IGNORES = new Set(['node_modules', '.next', '.git', '.vorbyte'])

function sanitizeRelativeFilePath(p: string): string {
  // normalize to POSIX-style, then convert to OS path later
  const cleaned = p.replace(/\\/g, '/').trim()
  if (!cleaned) throw new Error('Empty file path from AI')

  // Reject absolute paths
  if (cleaned.startsWith('/') || /^[A-Za-z]:\//.test(cleaned)) {
    throw new Error(`Unsafe absolute path from AI: ${cleaned}`)
  }

  const norm = path.posix.normalize(cleaned)

  if (norm.startsWith('..') || norm.includes('/../') || norm.includes('..\\')) {
    throw new Error(`Unsafe path traversal from AI: ${cleaned}`)
  }

  // Block writing into known ignore roots
  const first = norm.split('/')[0]
  if (DEFAULT_IGNORES.has(first)) {
    throw new Error(`Refusing to write into protected directory: ${first}`)
  }

  return norm
}

async function writeOne(projectDir: string, change: FileChange): Promise<string> {
  const rel = sanitizeRelativeFilePath(change.path)
  const dest = path.join(projectDir, ...rel.split('/'))
  await fs.mkdir(path.dirname(dest), { recursive: true })

  const formatted = await formatTextIfSupported({ filePath: dest, text: change.content, cwd: projectDir }).catch(
    () => change.content
  )

  await fs.writeFile(dest, formatted.endsWith('\n') ? formatted : formatted + '\n', 'utf-8')
  return rel
}

function runCmd(cmd: string, args: string[], cwd: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { cwd, stdio: 'inherit' })
    child.on('error', reject)
    child.on('exit', (code) => {
      if (code === 0) resolve()
      else reject(new Error(`${cmd} ${args.join(' ')} failed with code ${code}`))
    })
  })
}

async function isCommandAvailable(cmd: string): Promise<boolean> {
  return new Promise((resolve) => {
    const child = spawn(cmd, ['--version'], { stdio: 'ignore' })
    child.on('error', () => resolve(false))
    child.on('exit', (code) => resolve(code === 0))
  })
}

export async function applyChanges(opts: {
  projectDir: string
  files: FileChange[]
  dependencies?: string[]
}): Promise<ApplyResult> {
  const writtenFiles: string[] = []
  for (const change of opts.files) {
    const rel = await writeOne(opts.projectDir, change)
    writtenFiles.push(rel)
  }

  const depsFromAi = (opts.dependencies ?? []).map((d) => d.trim()).filter(Boolean)

  // If the model forgot to list deps, try to infer from import statements in generated files.
  const depsInferred = inferDependenciesFromFiles(opts.files)

  const depsToInstall = Array.from(new Set([...depsFromAi, ...depsInferred]))
  const installedDependencies: string[] = []

  if (depsToInstall.length > 0) {
    const existing = await readProjectDeps(opts.projectDir)
    const needed = depsToInstall.filter((d) => !existing.has(d))
    if (needed.length > 0) {
      // Choose package manager
      const preferred = choosePackageManager(opts.projectDir)
      let pm: 'pnpm' | 'yarn' | 'npm' = preferred

      // If pnpm/yarn chosen but not installed, fallback to npm
      if (pm === 'pnpm' && !(await isCommandAvailable('pnpm'))) pm = 'npm'
      if (pm === 'yarn' && !(await isCommandAvailable('yarn'))) pm = 'npm'

      if (pm === 'pnpm') {
        await runCmd('pnpm', ['add', ...needed], opts.projectDir)
      } else if (pm === 'yarn') {
        await runCmd('yarn', ['add', ...needed], opts.projectDir)
      } else {
        await runCmd('npm', ['install', ...needed], opts.projectDir)
      }

      installedDependencies.push(...needed)
    }
  }

  return { writtenFiles, installedDependencies }
}
