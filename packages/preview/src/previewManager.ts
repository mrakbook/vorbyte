import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import net from "node:net";
import http from "node:http";
import https from "node:https";
import { URL } from "node:url";

import type { PreviewLogsOptions, PreviewManager, PreviewStartOptions, PreviewStatus } from "./types";

type PackageManager = "pnpm" | "npm" | "yarn";
type InstanceState = PreviewStatus["state"];

interface Instance {
  projectPath: string;
  state: InstanceState;
  host: string;
  port?: number;
  url?: string;
  pid?: number;
  startedAt?: string;
  error?: string;
  proc?: ChildProcessWithoutNullStreams;
  logs: string[];
  readyByLog?: Promise<void>;
  readyByLogResolve?: (() => void) | null;
  exited?: boolean;
}

const MAX_LOG_LINES = 800;
const DEFAULT_HOST = "127.0.0.1";
const DEFAULT_READY_TIMEOUT_MS = 180_000; // 3 minutes
const NODE_REQ_FOR_NEXT16 = { major: 20, minor: 9, patch: 0 };

function nowIso() {
  return new Date().toISOString();
}

function fileExists(p: string) {
  try {
    fs.accessSync(p);
    return true;
  } catch {
    return false;
  }
}

function pushLogLine(inst: Instance, line: string) {
  inst.logs.push(line);
  if (inst.logs.length > MAX_LOG_LINES) inst.logs.splice(0, inst.logs.length - MAX_LOG_LINES);

  const lower = line.toLowerCase();
  if (
    lower.includes("ready") ||
    lower.includes("started server") ||
    lower.includes("listening on") ||
    lower.includes("http://") ||
    lower.includes("localhost")
  ) {
    if (inst.readyByLogResolve) {
      inst.readyByLogResolve();
      inst.readyByLogResolve = null;
    }
  }
}

function pushLogChunk(inst: Instance, chunk: Buffer) {
  const text = chunk.toString("utf-8");
  const lines = text.split(/\r?\n/).filter(Boolean);
  for (const line of lines) pushLogLine(inst, line);
}

async function isCommandAvailable(cmd: string): Promise<boolean> {
  return await new Promise<boolean>((resolve) => {
    const p = spawn(cmd, ["--version"], {
      stdio: "ignore",
      shell: process.platform === "win32",
    });
    p.once("error", () => resolve(false));
    p.once("exit", (code) => resolve(code === 0));
  });
}

async function detectPackageManager(projectPath: string): Promise<PackageManager> {
  const hasPnpm = await isCommandAvailable("pnpm");
  const hasNpm = await isCommandAvailable("npm");
  const hasYarn = await isCommandAvailable("yarn");

  const preferred: PackageManager[] = [];
  if (fileExists(path.join(projectPath, "pnpm-lock.yaml"))) preferred.push("pnpm");
  if (fileExists(path.join(projectPath, "package-lock.json"))) preferred.push("npm");
  if (fileExists(path.join(projectPath, "yarn.lock"))) preferred.push("yarn");

  if (preferred.length === 0) {
    if (hasPnpm) return "pnpm";
    if (hasNpm) return "npm";
    if (hasYarn) return "yarn";
    throw new Error("No package manager found. Install pnpm or Node.js (npm) to run preview.");
  }

  for (const pm of preferred) {
    if (pm === "pnpm" && hasPnpm) return "pnpm";
    if (pm === "npm" && hasNpm) return "npm";
    if (pm === "yarn" && hasYarn) return "yarn";
  }

  if (hasPnpm) return "pnpm";
  if (hasNpm) return "npm";
  if (hasYarn) return "yarn";

  throw new Error("No package manager found. Install pnpm or Node.js (npm) to run preview.");
}

async function isPortFree(host: string, port: number): Promise<boolean> {
  return await new Promise<boolean>((resolve) => {
    const server = net.createServer();
    server.unref();
    server.once("error", () => resolve(false));
    server.listen(port, host, () => {
      server.close(() => resolve(true));
    });
  });
}

async function findFreePort(host: string, preferred = 3000): Promise<number> {
  for (let p = preferred; p < preferred + 50; p++) {
    // eslint-disable-next-line no-await-in-loop
    if (await isPortFree(host, p)) return p;
  }
  return await new Promise<number>((resolve, reject) => {
    const server = net.createServer();
    server.unref();
    server.once("error", (err) => reject(err));
    server.listen(0, host, () => {
      const addr = server.address();
      if (typeof addr === "object" && addr?.port) {
        const port = addr.port;
        server.close(() => resolve(port));
        return;
      }
      server.close(() => reject(new Error("Could not allocate a free port")));
    });
  });
}

function httpProbe(urlString: string): Promise<boolean> {
  return new Promise<boolean>((resolve) => {
    try {
      const url = new URL(urlString);
      const client = url.protocol === "https:" ? https : http;
      const req = client.request(
        {
          method: "GET",
          hostname: url.hostname,
          port: url.port,
          path: url.pathname || "/",
          timeout: 2500,
        },
        (res) => {
          res.resume();
          resolve(true);
        }
      );
      req.on("timeout", () => {
        req.destroy();
        resolve(false);
      });
      req.on("error", () => resolve(false));
      req.end();
    } catch {
      resolve(false);
    }
  });
}

async function waitForServerReady(inst: Instance, urlBase: string, timeoutMs = DEFAULT_READY_TIMEOUT_MS): Promise<boolean> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (inst.exited) return false;
    // eslint-disable-next-line no-await-in-loop
    const ok = await httpProbe(urlBase);
    if (ok) return true;
    // eslint-disable-next-line no-await-in-loop
    await new Promise((r) => setTimeout(r, 650));
  }
  return false;
}

async function runCommandCapture(inst: Instance, cmd: string, args: string[], cwd: string) {
  return await new Promise<void>((resolve, reject) => {
    pushLogLine(inst, `▶ ${cmd} ${args.join(" ")}`);
    const p = spawn(cmd, args, {
      cwd,
      shell: process.platform === "win32",
      env: { ...process.env },
    });

    p.stdout?.on("data", (d: Buffer) => pushLogChunk(inst, d));
    p.stderr?.on("data", (d: Buffer) => pushLogChunk(inst, d));

    p.once("error", (err) => {
      pushLogLine(inst, `✖ ${err.message}`);
      reject(err);
    });
    p.once("exit", (code) => {
      if (code === 0) resolve();
      else {
        const err = new Error(`${cmd} ${args.join(" ")} exited with code ${code}`);
        pushLogLine(inst, `✖ ${err.message}`);
        reject(err);
      }
    });
  });
}

async function ensureDeps(inst: Instance, pm: PackageManager, projectPath: string) {
  const nm = path.join(projectPath, "node_modules");
  if (fileExists(nm)) return;

  pushLogLine(inst, "📦 Installing dependencies (first run)…");
  if (pm === "pnpm") {
    await runCommandCapture(inst, "pnpm", ["install"], projectPath);
    return;
  }
  if (pm === "yarn") {
    await runCommandCapture(inst, "yarn", ["install"], projectPath);
    return;
  }
  await runCommandCapture(inst, "npm", ["install"], projectPath);
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
    lastLog: inst.logs.length ? inst.logs[inst.logs.length - 1] : undefined,
  };
}

async function killProcessTree(proc: ChildProcessWithoutNullStreams) {
  if (proc.killed) return;
  try {
    proc.kill("SIGTERM");
  } catch {}
  await new Promise((r) => setTimeout(r, 1600));
  if (!proc.killed) {
    try {
      proc.kill("SIGKILL");
    } catch {}
  }
}

function parseSemver(v: string): { major: number; minor: number; patch: number } | null {
  const m = v.trim().match(/^v?(\d+)\.(\d+)\.(\d+)/);
  if (!m) return null;
  return { major: Number(m[1]), minor: Number(m[2]), patch: Number(m[3]) };
}

function gte(a: { major: number; minor: number; patch: number }, b: { major: number; minor: number; patch: number }) {
  if (a.major !== b.major) return a.major > b.major;
  if (a.minor !== b.minor) return a.minor > b.minor;
  return a.patch >= b.patch;
}

async function nodeVersionInPath(): Promise<{ raw: string; sem: { major: number; minor: number; patch: number } | null }> {
  return await new Promise((resolve) => {
    const p = spawn("node", ["-v"], { stdio: ["ignore", "pipe", "ignore"], shell: process.platform === "win32" });
    let out = "";
    p.stdout.on("data", (d) => (out += String(d)));
    p.on("error", () => resolve({ raw: "", sem: null }));
    p.on("exit", () => {
      const raw = out.trim();
      resolve({ raw, sem: parseSemver(raw) });
    });
  });
}

async function readPackageJson(projectPath: string): Promise<any | null> {
  try {
    const raw = await fs.promises.readFile(path.join(projectPath, "package.json"), "utf-8");
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function getNextMajor(pkg: any): number | null {
  const v = pkg?.dependencies?.next ?? pkg?.devDependencies?.next;
  if (!v || typeof v !== "string") return null;
  const m = v.match(/(\d+)\./);
  if (!m) return null;
  return Number(m[1]);
}

async function maybeAutoFixNextNodeMismatch(inst: Instance, pm: PackageManager, projectPath: string) {
  const pkg = await readPackageJson(projectPath);
  if (!pkg) return;

  const nextMajor = getNextMajor(pkg);
  if (nextMajor == null) return;

  // If next is 16+ we know (from Next engines) it requires Node >= 20.9.0.
  if (nextMajor < 16) return;

  const nv = await nodeVersionInPath();
  if (!nv.sem) return;

  if (gte(nv.sem, NODE_REQ_FOR_NEXT16)) return;

  pushLogLine(
    inst,
    `⚠ Detected Next.js ${nextMajor}.x which typically requires Node >= ${NODE_REQ_FOR_NEXT16.major}.${NODE_REQ_FOR_NEXT16.minor}.0, but PATH node is ${nv.raw}.`
  );
  pushLogLine(inst, `↪ Auto-fix: downgrading project to Next.js 14.x + React 18 for compatibility (preview only).`);

  // Downgrade to a widely compatible set:
  // - next@14.2.23
  // - react@18.3.1
  // - react-dom@18.3.1
  if (pm === "pnpm") {
    await runCommandCapture(inst, "pnpm", ["add", "next@14.2.23", "react@18.3.1", "react-dom@18.3.1"], projectPath);
    await runCommandCapture(inst, "pnpm", ["install"], projectPath);
    return;
  }
  if (pm === "yarn") {
    await runCommandCapture(inst, "yarn", ["add", "next@14.2.23", "react@18.3.1", "react-dom@18.3.1"], projectPath);
    await runCommandCapture(inst, "yarn", ["install"], projectPath);
    return;
  }
  await runCommandCapture(inst, "npm", ["install", "next@14.2.23", "react@18.3.1", "react-dom@18.3.1"], projectPath);
}

class PreviewManagerImpl implements PreviewManager {
  private instances = new Map<string, Instance>();

  status(projectPath: string): PreviewStatus {
    const key = path.resolve(projectPath);
    const inst = this.instances.get(key);
    if (!inst) return { projectPath: key, state: "stopped" };
    return toStatus(inst);
  }

  logs(projectPath: string, opts?: PreviewLogsOptions): string[] {
    const key = path.resolve(projectPath);
    const inst = this.instances.get(key);
    if (!inst) return [];
    const tail = opts?.tail ?? 250;
    if (tail <= 0) return [];
    return inst.logs.slice(-tail);
  }

  async start(opts: PreviewStartOptions): Promise<PreviewStatus> {
    const projectPath = path.resolve(opts.projectPath);
    const host = opts.host ?? DEFAULT_HOST;

    let inst = this.instances.get(projectPath);
    if (inst?.state === "running" && inst.proc && !inst.proc.killed) return toStatus(inst);

    if (!inst) {
      inst = { projectPath, state: "stopped", host, logs: [] };
      this.instances.set(projectPath, inst);
    }

    inst.state = "starting";
    inst.host = host;
    inst.error = undefined;
    inst.startedAt = nowIso();
    inst.exited = false;

    inst.readyByLog = new Promise<void>((resolve) => {
      inst!.readyByLogResolve = resolve;
    });

    pushLogLine(inst, `▶ Starting preview for ${projectPath}`);

    const pkgJson = path.join(projectPath, "package.json");
    if (!fileExists(pkgJson)) {
      inst.state = "error";
      inst.error = "No package.json found in the project folder. Is this a valid project?";
      pushLogLine(inst, `✖ ${inst.error}`);
      return toStatus(inst);
    }

    // Stop old process if exists.
    if (inst.proc && !inst.proc.killed) {
      await killProcessTree(inst.proc);
      inst.proc = undefined;
      inst.pid = undefined;
    }

    const preferredPort = opts.port ?? inst.port ?? 3000;
    inst.port = await findFreePort(host, preferredPort);
    inst.url = `http://${host}:${inst.port}`;

    const pm = await detectPackageManager(projectPath);
    pushLogLine(inst, `ℹ Using package manager: ${pm}`);

    const autoInstall = opts.autoInstallDeps !== false;
    if (autoInstall) {
      try {
        await ensureDeps(inst, pm, projectPath);
      } catch (err: any) {
        inst.state = "error";
        inst.error = err?.message ?? String(err);
        pushLogLine(inst, `✖ Failed to install dependencies: ${inst.error}`);
        return toStatus(inst);
      }
    }

    // Auto-fix common Next/Node mismatch that causes instant exit.
    try {
      await maybeAutoFixNextNodeMismatch(inst, pm, projectPath);
    } catch (e: any) {
      inst.state = "error";
      inst.error = e?.message ?? String(e);
      pushLogLine(inst, `✖ ${inst.error}`);
      return toStatus(inst);
    }

    // Start Next dev server via `dev` script. Use -p / -H flags for widest compatibility.
    let cmd = pm;
    let args: string[] = [];
    const portStr = String(inst.port);

    if (pm === "pnpm") {
      args = ["dev", "--", "-p", portStr, "-H", host];
    } else if (pm === "yarn") {
      args = ["dev", "-p", portStr, "-H", host];
    } else {
      cmd = "npm";
      args = ["run", "dev", "--", "-p", portStr, "-H", host];
    }

    pushLogLine(inst, `▶ ${cmd} ${args.join(" ")}`);

    try {
      const proc = spawn(cmd, args, {
        cwd: projectPath,
        shell: process.platform === "win32",
        env: { ...process.env, PORT: portStr, HOSTNAME: host },
      });
      inst.proc = proc;
      inst.pid = proc.pid;

      proc.stdout.on("data", (d: Buffer) => pushLogChunk(inst!, d));
      proc.stderr.on("data", (d: Buffer) => pushLogChunk(inst!, d));

      proc.once("error", (err) => {
        inst!.state = "error";
        inst!.error = err.message;
        pushLogLine(inst!, `✖ ${err.message}`);
      });

      proc.once("exit", (code, signal) => {
        inst!.exited = true;
        if (inst!.state === "running" || inst!.state === "starting") {
          inst!.state = "error";
          inst!.error = `Preview server exited early (code=${code ?? "n/a"} signal=${signal ?? "n/a"}).`;
          pushLogLine(inst!, `✖ ${inst!.error}`);
        } else {
          pushLogLine(inst!, `■ Preview server exited (code=${code ?? "n/a"} signal=${signal ?? "n/a"})`);
        }
      });
    } catch (err: any) {
      inst.state = "error";
      inst.error = err?.message ?? String(err);
      pushLogLine(inst, `✖ ${inst.error}`);
      return toStatus(inst);
    }

    // Give logs a little time to populate
    try {
      await Promise.race([inst.readyByLog ?? Promise.resolve(), new Promise((r) => setTimeout(r, 20_000))]);
    } catch {}

    const ready = await waitForServerReady(inst, `${inst.url}/`, DEFAULT_READY_TIMEOUT_MS);
    if (!ready) {
      if (!inst.error) {
        inst.state = "error";
        inst.error = `Preview did not become ready at ${inst.url} within ${Math.floor(DEFAULT_READY_TIMEOUT_MS / 1000)} seconds.`;
        pushLogLine(inst, `✖ ${inst.error}`);
      }
      return toStatus(inst);
    }

    inst.state = "running";
    pushLogLine(inst, `✅ Preview ready: ${inst.url}`);
    return toStatus(inst);
  }

  async stop(projectPath: string): Promise<boolean> {
    const key = path.resolve(projectPath);
    const inst = this.instances.get(key);
    if (!inst) return false;

    if (inst.proc && !inst.proc.killed) {
      await killProcessTree(inst.proc);
      inst.proc = undefined;
      inst.pid = undefined;
    }

    inst.state = "stopped";
    inst.error = undefined;
    pushLogLine(inst, "■ Preview stopped");
    return true;
  }

  async stopAll(): Promise<void> {
    const keys = [...this.instances.keys()];
    for (const key of keys) {
      // eslint-disable-next-line no-await-in-loop
      await this.stop(key);
    }
  }
}

export function createPreviewManager(): PreviewManager {
  return new PreviewManagerImpl();
}
