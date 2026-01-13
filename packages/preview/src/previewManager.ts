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
  exited?: boolean;
}

const MAX_LOG_LINES = 900;
const DEFAULT_HOST = "127.0.0.1";
const DEFAULT_READY_TIMEOUT_MS = 180_000;

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
}

function pushLogChunk(inst: Instance, chunk: Buffer) {
  const text = chunk.toString("utf-8");
  const lines = text.split(/\r?\n/).filter(Boolean);
  for (const line of lines) pushLogLine(inst, line);
}

async function isCommandAvailable(cmd: string): Promise<boolean> {
  return await new Promise<boolean>((resolve) => {
    const p = spawn(cmd, ["--version"], { stdio: "ignore", shell: process.platform === "win32" });
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
    server.listen(port, host, () => server.close(() => resolve(true)));
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
        { method: "GET", hostname: url.hostname, port: url.port, path: url.pathname || "/", timeout: 2500 },
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
    const p = spawn(cmd, args, { cwd, shell: process.platform === "win32", env: { ...process.env } });
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
  try { proc.kill("SIGTERM"); } catch {}
  await new Promise((r) => setTimeout(r, 1600));
  if (!proc.killed) {
    try { proc.kill("SIGKILL"); } catch {}
  }
}

async function readText(p: string): Promise<string | null> {
  try { return await fs.promises.readFile(p, "utf-8"); } catch { return null; }
}

async function writeText(p: string, s: string): Promise<void> {
  await fs.promises.mkdir(path.dirname(p), { recursive: true });
  await fs.promises.writeFile(p, s.endsWith("\n") ? s : s + "\n", "utf-8");
}

/**
 * Repair common AI-generated Next.js App Router breakages that cause `next dev` to exit instantly.
 * This does NOT try to be perfect; it only fixes very specific, clearly-wrong patterns.
 */
async function repairProjectForPreview(inst: Instance, projectPath: string): Promise<void> {
  const layoutCandidates = [
    path.join(projectPath, "src/app/layout.tsx"),
    path.join(projectPath, "app/layout.tsx"),
  ];
  const pageCandidates = [
    path.join(projectPath, "src/app/page.tsx"),
    path.join(projectPath, "app/page.tsx"),
  ];

  // 1) Fix invalid App Router layout created from next/app (Pages Router API).
  for (const layoutPath of layoutCandidates) {
    const src = await readText(layoutPath);
    if (!src) continue;

    const looksWrong =
      src.includes("from 'next/app'") ||
      src.includes('from "next/app"') ||
      src.includes("AppProps") ||
      src.includes("AppRouter") ||
      src.includes("function MyApp");

    if (looksWrong) {
      pushLogLine(inst, `🛠 Repair: Rewriting invalid App Router layout: ${path.relative(projectPath, layoutPath)}`);
      const fixed = `import "./globals.css";
import type { Metadata } from "next";
import React from "react";

export const metadata: Metadata = {
  title: "VorByte App",
  description: "Generated by VorByte",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-screen">{children}</body>
    </html>
  );
}
`;
      await writeText(layoutPath, fixed);
    }
  }

  // 2) Ensure a minimal Button component exists if the project uses shadcn-style imports.
  const buttonRel = "src/components/ui/button.tsx";
  const buttonAbs = path.join(projectPath, buttonRel);
  if (!fileExists(buttonAbs)) {
    // only add if we detect usage of Button in pages
    let usesButton = false;
    for (const pagePath of pageCandidates) {
      const src = await readText(pagePath);
      if (src && src.includes("Button")) {
        usesButton = true;
        break;
      }
    }
    if (usesButton) {
      pushLogLine(inst, `🛠 Repair: Adding missing UI button component (${buttonRel})`);
      const btn = `import * as React from "react";

function cn(...classes: Array<string | undefined | null | false>) {
  return classes.filter(Boolean).join(" ");
}

export type ButtonProps = React.ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: "default" | "secondary" | "outline";
};

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant = "default", ...props }, ref) => {
    return (
      <button
        ref={ref}
        className={cn(
          "inline-flex items-center justify-center rounded-md px-4 py-2 text-sm font-medium transition-colors",
          variant === "default" && "bg-black text-white hover:bg-black/90",
          variant === "secondary" && "bg-zinc-100 text-zinc-900 hover:bg-zinc-200",
          variant === "outline" && "border border-zinc-200 bg-white hover:bg-zinc-50",
          className
        )}
        {...props}
      />
    );
  }
);

Button.displayName = "Button";
`;
      await writeText(buttonAbs, btn);
    }
  }

  // 3) Rewrite bad imports like `import { Button } from '@shadcn/ui'` to local components.
  for (const pagePath of pageCandidates) {
    const src = await readText(pagePath);
    if (!src) continue;

    let next = src;

    next = next.replace(/from\s+['"]@shadcn\/ui['"]/g, "from \"@/components/ui/button\"");
    next = next.replace(/from\s+['"]shadcn\/ui['"]/g, "from \"@/components/ui/button\"");
    next = next.replace(/import\s*\{\s*Button\s*\}\s*from\s*['"][^'"]*['"]\s*;?/g, 'import { Button } from "@/components/ui/button";');

    // Also fix react 19 type errors in some templates by ensuring React import if JSX requires it (safe no-op in Next).
    if (!next.includes("import React") && next.includes("function HomePage")) {
      // Not necessary, but harmless.
    }

    if (next !== src) {
      pushLogLine(inst, `🛠 Repair: Fixing bad Button import in ${path.relative(projectPath, pagePath)}`);
      await writeText(pagePath, next);
    }
  }

  // 4) Ensure tsconfig path alias for @/ exists? Too invasive; skip.
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

    pushLogLine(inst, `▶ Starting preview for ${projectPath}`);

    if (!fileExists(path.join(projectPath, "package.json"))) {
      inst.state = "error";
      inst.error = "No package.json found in the project folder.";
      pushLogLine(inst, `✖ ${inst.error}`);
      return toStatus(inst);
    }

    if (inst.proc && !inst.proc.killed) {
      await killProcessTree(inst.proc);
      inst.proc = undefined;
      inst.pid = undefined;
    }

    inst.port = await findFreePort(host, opts.port ?? inst.port ?? 3000);
    inst.url = `http://${host}:${inst.port}`;

    const pm = await detectPackageManager(projectPath);
    pushLogLine(inst, `ℹ Using package manager: ${pm}`);

    if (opts.autoInstallDeps !== false) {
      try {
        await ensureDeps(inst, pm, projectPath);
      } catch (e: any) {
        inst.state = "error";
        inst.error = e?.message ?? String(e);
        pushLogLine(inst, `✖ Failed to install dependencies: ${inst.error}`);
        return toStatus(inst);
      }
    }

    // Repair common AI breakages before starting next dev.
    try {
      await repairProjectForPreview(inst, projectPath);
    } catch (e: any) {
      pushLogLine(inst, `⚠ Repair step failed: ${e?.message ?? String(e)}`);
    }

    const portStr = String(inst.port);
    let cmd = pm;
    let args: string[] = [];

    if (pm === "pnpm") args = ["dev", "--", "-p", portStr, "-H", host];
    else if (pm === "yarn") args = ["dev", "-p", portStr, "-H", host];
    else {
      cmd = "npm";
      args = ["run", "dev", "--", "-p", portStr, "-H", host];
    }

    pushLogLine(inst, `▶ ${cmd} ${args.join(" ")}`);

    try {
      const proc = spawn(cmd, args, { cwd: projectPath, shell: process.platform === "win32", env: { ...process.env, PORT: portStr, HOSTNAME: host } });
      inst.proc = proc;
      inst.pid = proc.pid;

      proc.stdout.on("data", (d: Buffer) => pushLogChunk(inst!, d));
      proc.stderr.on("data", (d: Buffer) => pushLogChunk(inst!, d));

      proc.once("error", (err) => {
        inst!.exited = true;
        inst!.state = "error";
        inst!.error = err.message;
        pushLogLine(inst!, `✖ ${err.message}`);
      });

      proc.once("exit", (code, signal) => {
        inst!.exited = true;
        inst!.state = "error";
        const tail = inst!.logs.slice(-120).join("\n");
        inst!.error =
          `Preview server exited early (code=${code ?? "n/a"} signal=${signal ?? "n/a"}).\n\nLast logs:\n${tail}`;
        pushLogLine(inst!, `✖ Preview server exited early.`);
      });
    } catch (e: any) {
      inst.state = "error";
      inst.error = e?.message ?? String(e);
      pushLogLine(inst, `✖ ${inst.error}`);
      return toStatus(inst);
    }

    const ready = await waitForServerReady(inst, `${inst.url}/`, DEFAULT_READY_TIMEOUT_MS);
    if (!ready) {
      const tail = inst.logs.slice(-120).join("\n");
      inst.state = "error";
      inst.error = `Preview did not become ready at ${inst.url}.\n\nLast logs:\n${tail}`;
      pushLogLine(inst, `✖ ${inst.error}`);
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
    for (const key of [...this.instances.keys()]) {
      // eslint-disable-next-line no-await-in-loop
      await this.stop(key);
    }
  }
}

export function createPreviewManager(): PreviewManager {
  return new PreviewManagerImpl();
}
