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

// Tailwind v4 stack (required by template-kit globals.css which uses `@import "tailwindcss";`)
const TAILWIND_V4 = "^4.1.18";
const TAILWIND_POSTCSS_V4 = "^4.1.18";
const TW_ANIMATE_CSS = "^1.4.0";

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

function resolveNextBin(projectPath: string): string | null {
  const bin = path.join(projectPath, "node_modules", ".bin", process.platform === "win32" ? "next.cmd" : "next");
  return fileExists(bin) ? bin : null;
}

async function ensureDeps(inst: Instance, pm: PackageManager, projectPath: string) {
  const nm = path.join(projectPath, "node_modules");
  const nextBin = resolveNextBin(projectPath);

  // If node_modules exists but Next isn't runnable, we still need an install.
  if (fileExists(nm) && nextBin) return;

  pushLogLine(inst, "📦 Installing dependencies…");
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

  const pid = proc.pid;

  // Best-effort: if the child was spawned as a detached process (or it spawned a new
  // process group), try to terminate its process group first (POSIX only).
  const killGroup = (signal: NodeJS.Signals): boolean => {
    if (!pid) return false;
    if (process.platform === "win32") return false;
    try {
      process.kill(-pid, signal);
      return true;
    } catch {
      return false;
    }
  };

  try {
    if (!killGroup("SIGTERM")) proc.kill("SIGTERM");
  } catch {}
  await new Promise((r) => setTimeout(r, 1600));
  if (!proc.killed) {
    try {
      if (!killGroup("SIGKILL")) proc.kill("SIGKILL");
    } catch {}
  }
}

async function readText(p: string): Promise<string | null> {
  try {
    return await fs.promises.readFile(p, "utf-8");
  } catch {
    return null;
  }
}

async function writeText(p: string, s: string): Promise<void> {
  await fs.promises.mkdir(path.dirname(p), { recursive: true });
  await fs.promises.writeFile(p, s.endsWith("\n") ? s : s + "\n", "utf-8");
}

async function readJson<T>(p: string): Promise<T | null> {
  try {
    const raw = await fs.promises.readFile(p, "utf-8");
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

async function writeJson(p: string, v: unknown): Promise<void> {
  await fs.promises.mkdir(path.dirname(p), { recursive: true });
  await fs.promises.writeFile(p, JSON.stringify(v, null, 2) + "\n", "utf-8");
}

async function renameToBak(p: string): Promise<void> {
  try {
    const bak = `${p}.bak`;
    if (fileExists(bak)) await fs.promises.rm(bak, { force: true });
    await fs.promises.rename(p, bak);
  } catch {
    // ignore
  }
}

/**
 * Best-effort TS → ESM conversion for common Next config patterns.
 * We only need this because Next 14 does not support `next.config.ts`.
 */
function convertNextConfigTsToMjs(ts: string): string {
  let s = ts.replace(/\r\n/g, "\n");

  // Remove type-only import for NextConfig.
  s = s.replace(/import\s+type\s*\{\s*NextConfig\s*\}\s*from\s*['"]next['"]\s*;?\s*/g, "");
  s = s.replace(/import\s*\{\s*NextConfig\s*\}\s*from\s*['"]next['"]\s*;?\s*/g, "");

  // Remove type annotations and `satisfies NextConfig`.
  s = s.replace(/:\s*NextConfig\b/g, "");
  s = s.replace(/\s+satisfies\s+NextConfig\b/g, "");

  // If it's using `module.exports =`, convert to `export default`.
  if (/module\.exports\s*=/.test(s)) {
    s = s.replace(/module\.exports\s*=\s*/g, "export default ");
  }

  // Ensure it has an `export default` somewhere.
  if (!/export\s+default\b/.test(s)) {
    // If it declares `const nextConfig = { ... }`, export it.
    if (/const\s+nextConfig\s*=/.test(s)) {
      s += "\n\nexport default nextConfig;\n";
    }
  }

  // Normalize trailing newline
  return s.endsWith("\n") ? s : s + "\n";
}

function rewriteGeistFontsToInter(src: string): string {
  let s = src;
  s = s.replace(
    /import\s*\{\s*Geist\s*,\s*Geist_Mono\s*\}\s*from\s*['"]next\/font\/google['"];?/g,
    'import { Inter, Roboto_Mono } from "next/font/google";'
  );
  s = s.replace(/\bGeist_Mono\b/g, "Roboto_Mono");
  s = s.replace(/\bGeist\b/g, "Inter");
  // Add display swap if missing
  s = s.replace(/subsets:\s*\[([^\]]+)\],\s*\}\);/g, 'subsets: [$1],\n  display: "swap",\n});');
  return s;
}

function projectUsesTailwindV4(globalsCss: string | null, postcssCfg: string | null): boolean {
  const css = globalsCss ?? "";
  const pc = postcssCfg ?? "";
  return (
    /@import\s+["']tailwindcss["']/.test(css) ||
    /@theme\s+inline\b/.test(css) ||
    /@custom-variant\s+dark\b/.test(css) ||
    /@tailwindcss\/postcss/.test(pc)
  );
}

/**
 * Repair common AI-generated / template-kit stack mismatch issues that cause `next dev` to error.
 * Returns true if we modified package.json / PostCSS config and should re-install.
 */
async function repairProjectForPreview(inst: Instance, projectPath: string): Promise<{ reinstallDeps: boolean }> {
  let reinstallDeps = false;

  // 0) Next.js 14 cannot load next.config.ts — convert or remove it.
  const nextConfigTs = path.join(projectPath, "next.config.ts");
  const nextConfigMjs = path.join(projectPath, "next.config.mjs");
  const nextConfigJs = path.join(projectPath, "next.config.js");

  if (fileExists(nextConfigTs)) {
    if (!fileExists(nextConfigMjs) && !fileExists(nextConfigJs)) {
      pushLogLine(inst, "🛠 Repair: Migrating unsupported next.config.ts → next.config.mjs");
      const ts = await readText(nextConfigTs);
      if (ts) {
        await writeText(nextConfigMjs, convertNextConfigTsToMjs(ts));
      }
    } else {
      pushLogLine(inst, "🛠 Repair: Removing unsupported next.config.ts (keeping existing JS/MJS config)");
    }
    await renameToBak(nextConfigTs);
  }

  const globalsCandidates = [
    path.join(projectPath, "src/app/globals.css"),
    path.join(projectPath, "app/globals.css"),
    path.join(projectPath, "src/styles/globals.css"),
    path.join(projectPath, "styles/globals.css"),
  ];
  const postcssCandidates = [
    path.join(projectPath, "postcss.config.mjs"),
    path.join(projectPath, "postcss.config.js"),
    path.join(projectPath, "postcss.config.cjs"),
  ];

  const globalsPath = globalsCandidates.find((p) => fileExists(p)) ?? null;
  const postcssPath = postcssCandidates.find((p) => fileExists(p)) ?? null;

  const globalsCss = globalsPath ? await readText(globalsPath) : null;
  const postcssCfg = postcssPath ? await readText(postcssPath) : null;

  // 1) If the project looks like Tailwind v4 (template-kit), ensure the matching deps + PostCSS plugin.
  if (projectUsesTailwindV4(globalsCss, postcssCfg)) {
    const pkgPath = path.join(projectPath, "package.json");
    const pkg = await readJson<any>(pkgPath);

    if (pkg) {
      let changed = false;

      // Ensure PostCSS plugin config exists and is v4 style.
      const expected = `const config = {\n  plugins: {\n    "@tailwindcss/postcss": {},\n  },\n};\n\nexport default config;\n`;
      if (postcssPath) {
        if (!/@tailwindcss\/postcss/.test(postcssCfg ?? "")) {
          pushLogLine(inst, `🛠 Repair: Updating PostCSS config to Tailwind v4 (@tailwindcss/postcss): ${path.relative(projectPath, postcssPath)}`);
          await renameToBak(postcssPath);
          await writeText(path.join(projectPath, "postcss.config.mjs"), expected);
          reinstallDeps = true;
        }
      } else {
        pushLogLine(inst, "🛠 Repair: Adding missing PostCSS config for Tailwind v4 (postcss.config.mjs)");
        await writeText(path.join(projectPath, "postcss.config.mjs"), expected);
        reinstallDeps = true;
      }

      // Ensure required deps exist (and are v4 compatible).
      pkg.dependencies = pkg.dependencies ?? {};
      pkg.devDependencies = pkg.devDependencies ?? {};

      if (pkg.dependencies["tw-animate-css"] == null && pkg.devDependencies["tw-animate-css"] == null) {
        pkg.dependencies["tw-animate-css"] = TW_ANIMATE_CSS;
        changed = true;
      }

      if (pkg.devDependencies.tailwindcss == null && pkg.dependencies.tailwindcss == null) {
        pkg.devDependencies.tailwindcss = TAILWIND_V4;
        changed = true;
      } else if (typeof pkg.devDependencies.tailwindcss === "string" && pkg.devDependencies.tailwindcss.startsWith("^3")) {
        pkg.devDependencies.tailwindcss = TAILWIND_V4;
        changed = true;
      }

      if (pkg.devDependencies["@tailwindcss/postcss"] == null && pkg.dependencies["@tailwindcss/postcss"] == null) {
        pkg.devDependencies["@tailwindcss/postcss"] = TAILWIND_POSTCSS_V4;
        changed = true;
      } else if (
        typeof pkg.devDependencies["@tailwindcss/postcss"] === "string" &&
        pkg.devDependencies["@tailwindcss/postcss"].startsWith("^3")
      ) {
        pkg.devDependencies["@tailwindcss/postcss"] = TAILWIND_POSTCSS_V4;
        changed = true;
      }

      if (changed) {
        pushLogLine(inst, "🛠 Repair: Ensuring Tailwind v4 dependencies are present in package.json");
        await writeJson(pkgPath, pkg);
        reinstallDeps = true;
      }
    }
  }

  const layoutCandidates = [path.join(projectPath, "src/app/layout.tsx"), path.join(projectPath, "app/layout.tsx")];
  const pageCandidates = [path.join(projectPath, "src/app/page.tsx"), path.join(projectPath, "app/page.tsx")];

  // 2) Fix invalid App Router layout created from next/app (Pages Router API).
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
      continue;
    }

    // 3) Fix next/font Geist errors by switching to Inter/Roboto Mono while keeping the same CSS vars.
    if (src.includes("next/font/google") && (src.includes("Geist") || src.includes("Geist_Mono"))) {
      pushLogLine(inst, `🛠 Repair: Rewriting Geist font import to Inter/Roboto_Mono: ${path.relative(projectPath, layoutPath)}`);
      await writeText(layoutPath, rewriteGeistFontsToInter(src));
    }
  }

  // 4) Ensure a minimal Button component exists if the project uses shadcn-style imports.
  const buttonRel = "src/components/ui/button.tsx";
  const buttonAbs = path.join(projectPath, buttonRel);
  if (!fileExists(buttonAbs)) {
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

  // 5) Rewrite bad imports like `import { Button } from '@shadcn/ui'` to local components.
  for (const pagePath of pageCandidates) {
    const src = await readText(pagePath);
    if (!src) continue;

    let next = src;

    next = next.replace(/from\s+['"]@shadcn\/ui['"]/g, 'from "@/components/ui/button"');
    next = next.replace(/from\s+['"]shadcn\/ui['"]/g, 'from "@/components/ui/button"');
    next = next.replace(/import\s*\{\s*Button\s*\}\s*from\s*['"][^'"]*['"]\s*;?/g, 'import { Button } from "@/components/ui/button";');

    if (next !== src) {
      pushLogLine(inst, `🛠 Repair: Fixing bad Button import in ${path.relative(projectPath, pagePath)}`);
      await writeText(pagePath, next);
    }
  }

  return { reinstallDeps };
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
      const prev = inst.proc;
      // Clear first so any late "exit" events from the previous process can't
      // clobber the current instance state.
      inst.proc = undefined;
      inst.pid = undefined;
      await killProcessTree(prev);
    }

    inst.port = await findFreePort(host, opts.port ?? inst.port ?? 3000);
    inst.url = `http://${host}:${inst.port}`;

    const pm = await detectPackageManager(projectPath);
    pushLogLine(inst, `ℹ Using package manager: ${pm}`);

    // Repair project structure/config first (may update package.json / postcss config)
    let repairReinstall = false;
    try {
      const repairRes = await repairProjectForPreview(inst, projectPath);
      repairReinstall = repairRes.reinstallDeps;
    } catch (e: any) {
      pushLogLine(inst, `⚠ Repair step failed: ${e?.message ?? String(e)}`);
    }

    if (opts.autoInstallDeps !== false) {
      try {
        await ensureDeps(inst, pm, projectPath);
        if (repairReinstall) {
          pushLogLine(inst, "📦 Re-installing dependencies after repair…");
          if (pm === "pnpm") await runCommandCapture(inst, "pnpm", ["install"], projectPath);
          else if (pm === "yarn") await runCommandCapture(inst, "yarn", ["install"], projectPath);
          else await runCommandCapture(inst, "npm", ["install"], projectPath);
        }
      } catch (e: any) {
        inst.state = "error";
        inst.error = e?.message ?? String(e);
        pushLogLine(inst, `✖ Failed to install dependencies: ${inst.error}`);
        return toStatus(inst);
      }
    }

    const portStr = String(inst.port);

    // Prefer running Next directly to avoid package-manager argument quirks (esp. pnpm + "--").
    const nextBin = resolveNextBin(projectPath);
    let cmd: string;
    let args: string[];

    if (nextBin) {
      cmd = nextBin;
      args = ["dev", "-p", portStr, "-H", host];
    } else if (pm === "pnpm") {
      cmd = "pnpm";
      args = ["exec", "next", "dev", "-p", portStr, "-H", host];
    } else if (pm === "yarn") {
      cmd = "yarn";
      args = ["exec", "next", "dev", "-p", portStr, "-H", host];
    } else {
      cmd = "npm";
      args = ["exec", "next", "--", "dev", "-p", portStr, "-H", host];
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

            const currentProc = proc;

      proc.once("error", (err) => {
        // Ignore late events from an older process that has already been replaced.
        if (inst!.proc !== currentProc) return;
        inst!.exited = true;
        inst!.proc = undefined;
        inst!.pid = undefined;
        inst!.state = "error";
        inst!.error = err.message;
        pushLogLine(inst!, `✖ ${err.message}`);
      });

      proc.once("exit", (code, signal) => {
        // Ignore late events from an older process that has already been replaced.
        if (inst!.proc !== currentProc) return;
        inst!.exited = true;
        inst!.proc = undefined;
        inst!.pid = undefined;

        // If we haven't reached "running" yet, this is an early exit.
        if (inst!.state === "starting") {
          const tail = inst!.logs.slice(-120).join("\n");
          inst!.state = "error";
          inst!.error = `Preview server exited before it became ready (code=${code ?? "n/a"} signal=${signal ?? "n/a"}).\n\nLast logs:\n${tail}`;
          pushLogLine(inst!, "✖ Preview server exited before it became ready.");
          return;
        }

        // If it was running, treat a clean/expected exit as "stopped".
        if (code === 0 || signal === "SIGTERM" || signal === "SIGINT") {
          inst!.state = "stopped";
          inst!.error = undefined;
          pushLogLine(inst!, "■ Preview server exited.");
          return;
        }

        const tail = inst!.logs.slice(-120).join("\n");
        inst!.state = "error";
        inst!.error = `Preview server crashed (code=${code ?? "n/a"} signal=${signal ?? "n/a"}).\n\nLast logs:\n${tail}`;
        pushLogLine(inst!, "✖ Preview server crashed.");
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

    const proc = inst.proc;
    // Clear first so any late "exit" events can't mutate state after we've decided to stop.
    inst.proc = undefined;
    inst.pid = undefined;

    if (proc && !proc.killed) {
      await killProcessTree(proc);
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

