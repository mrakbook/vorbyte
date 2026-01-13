import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import net from 'node:net'
import http from 'node:http'
import https from 'node:https'
import { URL } from 'node:url'

import type { PreviewLogsOptions, PreviewManager, PreviewStartOptions, PreviewStatus } from './types'

type PackageManager = 'pnpm' | 'npm' | 'yarn'

type InstanceState = PreviewStatus['state']

interface Instance {
  projectPath: string
  state: InstanceState
  host: string
  port?: number
  url?: string
  pid?: number
  startedAt?: string
  error?: string
  proc?: ChildProcessWithoutNullStreams
  logs: string[]
}

const MAX_LOG_LINES = 400

function nowIso() {
  return new Date().toISOString()
}

function fileExists(p: string) {
  try {
    fs.accessSync(p)
    return true
  } catch {
    return false
  }
}

function pushLogLine(inst: Instance, line: string) {
  inst.logs.push(line)
  if (inst.logs.length > MAX_LOG_LINES) inst.logs.splice(0, inst.logs.length - MAX_LOG_LINES)
}

function pushLogChunk(inst: Instance, chunk: Buffer) {
  const text = chunk.toString('utf-8')
  const lines = text.split(/\r?\n/).filter(Boolean)
  for (const line of lines) pushLogLine(inst, line)
}

async function isCommandAvailable(cmd: string): Promise<boolean> {
  return await new Promise<boolean>((resolve) => {
    const p = spawn(cmd, ['--version'], {
      stdio: 'ignore',
      shell: process.platform === 'win32'
    })
    p.once('error', () => resolve(false))
    p.once('exit', (code) => resolve(code === 0))
  })
}

async function detectPackageManager(projectPath: string): Promise<PackageManager> {
  const hasPnpm = await isCommandAvailable('pnpm')
  const hasNpm = await isCommandAvailable('npm')
  const hasYarn = await isCommandAvailable('yarn')

  const preferred: PackageManager[] = []
  if (fileExists(path.join(projectPath, 'pnpm-lock.yaml'))) preferred.push('pnpm')
  if (fileExists(path.join(projectPath, 'package-lock.json'))) preferred.push('npm')
  if (fileExists(path.join(projectPath, 'yarn.lock'))) preferred.push('yarn')

  // If no lockfile yet (common for freshly-copied template kits), prefer pnpm if available.
  if (preferred.length === 0) {
    if (hasPnpm) return 'pnpm'
    if (hasNpm) return 'npm'
    if (hasYarn) return 'yarn'
    throw new Error(
      'No package manager found. Install pnpm (recommended) or Node.js (npm) so VorByte can run the preview server.'
    )
  }

  for (const pm of preferred) {
    if (pm === 'pnpm' && hasPnpm) return 'pnpm'
    if (pm === 'npm' && hasNpm) return 'npm'
    if (pm === 'yarn' && hasYarn) return 'yarn'
  }

  // Lockfile exists, but that PM isn't available. Fall back to any available one.
  if (hasPnpm) return 'pnpm'
  if (hasNpm) return 'npm'
  if (hasYarn) return 'yarn'

  throw new Error(
    'No package manager found. Install pnpm (recommended) or Node.js (npm) so VorByte can run the preview server.'
  )
}

async function isPortFree(host: string, port: number): Promise<boolean> {
  return await new Promise<boolean>((resolve) => {
    const server = net.createServer()
    server.unref()
    server.once('error', () => resolve(false))
    server.listen(port, host, () => {
      server.close(() => resolve(true))
    })
  })
}

async function findFreePort(host: string, preferred = 3000): Promise<number> {
  // Try preferred first, then scan a small range.
  for (let p = preferred; p < preferred + 50; p++) {
    // eslint-disable-next-line no-await-in-loop
    if (await isPortFree(host, p)) return p
  }
  // As a fallback, let the OS pick a port.
  return await new Promise<number>((resolve, reject) => {
    const server = net.createServer()
    server.unref()
    server.once('error', (err) => reject(err))
    server.listen(0, host, () => {
      const addr = server.address()
      if (typeof addr === 'object' && addr?.port) {
        const port = addr.port
        server.close(() => resolve(port))
        return
      }
      server.close(() => reject(new Error('Could not allocate a free port')))
    })
  })
}

function httpProbe(urlString: string): Promise<boolean> {
  return new Promise<boolean>((resolve) => {
    try {
      const url = new URL(urlString)
      const client = url.protocol === 'https:' ? https : http
      const req = client.request(
        {
          method: 'GET',
          hostname: url.hostname,
          port: url.port,
          path: url.pathname || '/',
          timeout: 2000
        },
        (res) => {
          // Any HTTP response means the server is up.
          res.resume()
          resolve(true)
        }
      )
      req.on('timeout', () => {
        req.destroy()
        resolve(false)
      })
      req.on('error', () => resolve(false))
      req.end()
    } catch {
      resolve(false)
    }
  })
}

async function waitForServerReady(urlBase: string, timeoutMs = 60_000): Promise<boolean> {
  const start = Date.now()
  while (Date.now() - start < timeoutMs) {
    // eslint-disable-next-line no-await-in-loop
    const ok = await httpProbe(urlBase)
    if (ok) return true
    // eslint-disable-next-line no-await-in-loop
    await new Promise((r) => setTimeout(r, 500))
  }
  return false
}

async function runCommandCapture(inst: Instance, cmd: string, args: string[], cwd: string) {
  return await new Promise<void>((resolve, reject) => {
    pushLogLine(inst, `▶ ${cmd} ${args.join(' ')}`)
    const p = spawn(cmd, args, {
      cwd,
      shell: process.platform === 'win32',
      env: {
        ...process.env
      }
    })

    p.stdout?.on('data', (d: Buffer) => pushLogChunk(inst, d))
    p.stderr?.on('data', (d: Buffer) => pushLogChunk(inst, d))

    p.once('error', (err) => {
      pushLogLine(inst, `✖ ${err.message}`)
      reject(err)
    })
    p.once('exit', (code) => {
      if (code === 0) {
        resolve()
      } else {
        const err = new Error(`${cmd} ${args.join(' ')} exited with code ${code}`)
        pushLogLine(inst, `✖ ${err.message}`)
        reject(err)
      }
    })
  })
}

async function ensureDeps(inst: Instance, pm: PackageManager, projectPath: string) {
  const nm = path.join(projectPath, 'node_modules')
  if (fileExists(nm)) return

  pushLogLine(inst, '📦 Installing dependencies (first run)…')
  if (pm === 'pnpm') {
    await runCommandCapture(inst, 'pnpm', ['install'], projectPath)
    return
  }
  if (pm === 'yarn') {
    await runCommandCapture(inst, 'yarn', ['install'], projectPath)
    return
  }
  await runCommandCapture(inst, 'npm', ['install'], projectPath)
}

function toStatus(inst: Instance): PreviewStatus {
  return {
    projectPath: inst.projectPath,
    state: inst.state,
    host: inst.host,
    port: inst.port,
    url: inst.url,
    pid: inst.pid,
    startedAt: inst.startedAt,
    error: inst.error,
    lastLog: inst.logs.length ? inst.logs[inst.logs.length - 1] : undefined
  }
}

async function killProcessTree(proc: ChildProcessWithoutNullStreams) {
  if (proc.killed) return
  // Best-effort: SIGTERM then SIGKILL.
  try {
    proc.kill('SIGTERM')
  } catch {
    // ignore
  }
  await new Promise((r) => setTimeout(r, 1500))
  if (!proc.killed) {
    try {
      proc.kill('SIGKILL')
    } catch {
      // ignore
    }
  }
}

class PreviewManagerImpl implements PreviewManager {
  private instances = new Map<string, Instance>()

  status(projectPath: string): PreviewStatus {
    const key = path.resolve(projectPath)
    const inst = this.instances.get(key)
    if (!inst) {
      return { projectPath: key, state: 'stopped' }
    }
    return toStatus(inst)
  }

  logs(projectPath: string, opts?: PreviewLogsOptions): string[] {
    const key = path.resolve(projectPath)
    const inst = this.instances.get(key)
    if (!inst) return []
    const tail = opts?.tail ?? 200
    if (tail <= 0) return []
    return inst.logs.slice(-tail)
  }

  async start(opts: PreviewStartOptions): Promise<PreviewStatus> {
    const projectPath = path.resolve(opts.projectPath)
    const host = opts.host ?? '127.0.0.1'

    let inst = this.instances.get(projectPath)
    if (inst?.state === 'running' && inst.proc && !inst.proc.killed) return toStatus(inst)
    if (!inst) {
      inst = {
        projectPath,
        state: 'stopped',
        host,
        logs: []
      }
      this.instances.set(projectPath, inst)
    }

    // Reset / starting
    inst.state = 'starting'
    inst.host = host
    inst.error = undefined
    inst.startedAt = nowIso()
    pushLogLine(inst, `▶ Starting preview for ${projectPath}`)

    const pkgJson = path.join(projectPath, 'package.json')
    if (!fileExists(pkgJson)) {
      inst.state = 'error'
      inst.error = 'No package.json found in the project folder. Is this a valid template-kit copy?'
      pushLogLine(inst, `✖ ${inst.error}`)
      return toStatus(inst)
    }

    // If an old process exists, stop it.
    if (inst.proc && !inst.proc.killed) {
      await killProcessTree(inst.proc)
      inst.proc = undefined
      inst.pid = undefined
    }

    const preferredPort = opts.port ?? inst.port ?? 3000
    inst.port = await findFreePort(host, preferredPort)
    inst.url = `http://${host}:${inst.port}`

    const pm = await detectPackageManager(projectPath)
    pushLogLine(inst, `ℹ Using package manager: ${pm}`)

    const autoInstall = opts.autoInstallDeps !== false
    if (autoInstall) {
      try {
        await ensureDeps(inst, pm, projectPath)
      } catch (err) {
        inst.state = 'error'
        inst.error = err instanceof Error ? err.message : String(err)
        pushLogLine(inst, `✖ Failed to install dependencies: ${inst.error}`)
        return toStatus(inst)
      }
    }

    // Start Next dev server via package manager script `dev`
    let cmd = pm
    let args: string[] = []
    const portStr = String(inst.port)

    if (pm === 'pnpm') {
      args = ['dev', '--', '--port', portStr, '--hostname', host]
    } else if (pm === 'yarn') {
      args = ['dev', '--port', portStr, '--hostname', host]
    } else {
      args = ['run', 'dev', '--', '--port', portStr, '--hostname', host]
      cmd = 'npm'
    }

    pushLogLine(inst, `▶ ${cmd} ${args.join(' ')}`)

    try {
      const proc = spawn(cmd, args, {
        cwd: projectPath,
        shell: process.platform === 'win32',
        env: {
          ...process.env,
          PORT: portStr
        }
      })
      inst.proc = proc
      inst.pid = proc.pid

      proc.stdout.on('data', (d: Buffer) => pushLogChunk(inst!, d))
      proc.stderr.on('data', (d: Buffer) => pushLogChunk(inst!, d))

      proc.once('error', (err) => {
        inst!.state = 'error'
        inst!.error = err.message
        pushLogLine(inst!, `✖ ${err.message}`)
      })

      proc.once('exit', (code, signal) => {
        // If it exits while starting/running, surface it.
        if (inst!.state === 'running' || inst!.state === 'starting') {
          inst!.state = 'stopped'
          pushLogLine(inst!, `■ Preview server exited (code=${code ?? 'n/a'} signal=${signal ?? 'n/a'})`)
        }
      })
    } catch (err) {
      inst.state = 'error'
      inst.error = err instanceof Error ? err.message : String(err)
      pushLogLine(inst, `✖ ${inst.error}`)
      return toStatus(inst)
    }

    const ready = await waitForServerReady(`${inst.url}/`, 60_000)
    if (!ready) {
      inst.state = 'error'
      inst.error = `Preview did not become ready at ${inst.url} within 60 seconds.`
      pushLogLine(inst, `✖ ${inst.error}`)
      return toStatus(inst)
    }

    inst.state = 'running'
    pushLogLine(inst, `✅ Preview ready: ${inst.url}`)
    return toStatus(inst)
  }

  async stop(projectPath: string): Promise<boolean> {
    const key = path.resolve(projectPath)
    const inst = this.instances.get(key)
    if (!inst) return false

    if (inst.proc && !inst.proc.killed) {
      await killProcessTree(inst.proc)
      inst.proc = undefined
      inst.pid = undefined
    }

    inst.state = 'stopped'
    inst.error = undefined
    pushLogLine(inst, '■ Preview stopped')
    return true
  }

  async stopAll(): Promise<void> {
    const keys = [...this.instances.keys()]
    for (const key of keys) {
      // eslint-disable-next-line no-await-in-loop
      await this.stop(key)
    }
  }
}

export function createPreviewManager(): PreviewManager {
  return new PreviewManagerImpl()
}
