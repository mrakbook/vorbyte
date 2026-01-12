import fs from 'node:fs/promises'
import fssync from 'node:fs'
import path from 'node:path'
import { builtinModules } from 'node:module'
import type { FileChange } from './types'

export async function readProjectDeps(projectDir: string): Promise<Set<string>> {
  const pkgPath = path.join(projectDir, 'package.json')
  const s = new Set<string>()
  try {
    const raw = await fs.readFile(pkgPath, 'utf-8')
    const json = JSON.parse(raw) as any
    const deps = { ...(json.dependencies ?? {}), ...(json.devDependencies ?? {}) }
    for (const k of Object.keys(deps)) s.add(k)
  } catch {
    // ignore
  }
  return s
}

export function choosePackageManager(projectDir: string): 'pnpm' | 'yarn' | 'npm' {
  // If lockfile exists, match it. Otherwise default to npm.
  const has = (f: string) => {
    try {
      fssync.accessSync(path.join(projectDir, f))
      return true
    } catch {
      return false
    }
  }

  if (has('pnpm-lock.yaml')) return 'pnpm'
  if (has('yarn.lock')) return 'yarn'
  if (has('package-lock.json')) return 'npm'
  return 'npm'
}

const BUILTINS = new Set(
  builtinModules.map((m) => (m.startsWith('node:') ? m.slice('node:'.length) : m))
)

function normalizePackageName(spec: string): string | null {
  // ignore relative & absolute paths
  if (!spec) return null
  if (spec.startsWith('.') || spec.startsWith('/') || spec.startsWith('file:')) return null
  if (spec.startsWith('node:')) return null

  // common TS path aliases (project-specific)
  if (spec.startsWith('@/') || spec.startsWith('~') || spec.startsWith('#')) return null

  // strip query/hash (rare)
  const clean = spec.split('?')[0].split('#')[0]

  // builtins
  const firstSeg = clean.split('/')[0]
  if (BUILTINS.has(firstSeg)) return null

  // scoped packages: @scope/name/...
  if (clean.startsWith('@')) {
    const parts = clean.split('/')
    if (parts.length >= 2) return parts.slice(0, 2).join('/')
    return null
  }

  // normal: lodash/xyz -> lodash
  return firstSeg
}

export function inferDependenciesFromFiles(files: FileChange[]): string[] {
  const out = new Set<string>()

  for (const f of files) {
    const ext = path.extname(f.path).toLowerCase()
    if (!['.ts', '.tsx', '.js', '.jsx'].includes(ext)) continue

    const src = f.content

    // import ... from 'pkg'
    for (const m of src.matchAll(/from\s+['"]([^'"]+)['"]/g)) {
      const spec = m[1]
      const pkg = normalizePackageName(spec)
      if (pkg) out.add(pkg)
    }

    // require('pkg')
    for (const m of src.matchAll(/require\(\s*['"]([^'"]+)['"]\s*\)/g)) {
      const spec = m[1]
      const pkg = normalizePackageName(spec)
      if (pkg) out.add(pkg)
    }

    // dynamic import('pkg')
    for (const m of src.matchAll(/import\(\s*['"]([^'"]+)['"]\s*\)/g)) {
      const spec = m[1]
      const pkg = normalizePackageName(spec)
      if (pkg) out.add(pkg)
    }
  }

  return Array.from(out)
}
