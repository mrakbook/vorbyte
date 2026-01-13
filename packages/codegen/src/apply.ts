import fs from "node:fs/promises";
import path from "node:path";
import { spawn } from "node:child_process";

export type FileChange = { path: string; content: string };

export type ApplyResult = {
  writtenFiles: string[];
  installedDependencies: string[];
};

function sanitizeRelative(p: string): string {
  const cleaned = p.replace(/\\/g, "/").trim();
  if (!cleaned) throw new Error("Empty file path from AI");
  if (cleaned.startsWith("/") || /^[A-Za-z]:\//.test(cleaned)) throw new Error(`Absolute path not allowed: ${cleaned}`);

  const norm = path.posix.normalize(cleaned);
  if (norm.startsWith("..") || norm.includes("/../")) throw new Error(`Path traversal not allowed: ${cleaned}`);
  return norm;
}

async function writeFile(projectDir: string, ch: FileChange): Promise<string> {
  const rel = sanitizeRelative(ch.path);
  const dest = path.join(projectDir, ...rel.split("/"));
  await fs.mkdir(path.dirname(dest), { recursive: true });
  await fs.writeFile(dest, ch.content, "utf-8");
  return rel;
}

function run(cmd: string, args: string[], cwd: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const p = spawn(cmd, args, { cwd, stdio: "inherit", shell: process.platform === "win32" });
    p.on("error", reject);
    p.on("exit", (code) =>
      code === 0 ? resolve() : reject(new Error(`${cmd} ${args.join(" ")} failed with code ${code}`))
    );
  });
}

async function cmdOk(cmd: string): Promise<boolean> {
  return new Promise((resolve) => {
    const p = spawn(cmd, ["--version"], { stdio: "ignore", shell: process.platform === "win32" });
    p.on("error", () => resolve(false));
    p.on("exit", (code) => resolve(code === 0));
  });
}

function splitDevDeps(deps: string[]): { prod: string[]; dev: string[] } {
  const prod: string[] = [];
  const dev: string[] = [];
  for (const d of deps) {
    const name = d.trim();
    if (!name) continue;
    if (name.startsWith("@types/")) dev.push(name);
    else prod.push(name);
  }
  return { prod, dev };
}

async function installBestEffort(opts: {
  cmd: string;
  argsForPkgs: (pkgs: string[]) => string[];
  cwd: string;
  pkgs: string[];
  label?: string;
}): Promise<{ installed: string[]; skipped: string[] }> {
  const pkgs = opts.pkgs.filter(Boolean);
  if (pkgs.length === 0) return { installed: [], skipped: [] };

  try {
    await run(opts.cmd, opts.argsForPkgs(pkgs), opts.cwd);
    return { installed: pkgs, skipped: [] };
  } catch (bulkErr) {
    // If a batch install fails (often due to one invalid package), try each package individually.
    const installed: string[] = [];
    const skipped: string[] = [];

    for (const pkg of pkgs) {
      try {
        // eslint-disable-next-line no-await-in-loop
        await run(opts.cmd, opts.argsForPkgs([pkg]), opts.cwd);
        installed.push(pkg);
      } catch {
        skipped.push(pkg);
      }
    }

    // If nothing installed, rethrow the original error (likely network / auth / registry issues).
    if (installed.length === 0) throw bulkErr;

    if (skipped.length) {
      // Best-effort: keep going, but make the failure visible in logs.
      // (This is common when the AI suggests a non-existent package.)
      // eslint-disable-next-line no-console
      console.warn(
        `[vorbyte/codegen] Skipped failed dependencies (${opts.label ?? "deps"}): ${skipped.join(", ")}`
      );
    }

    return { installed, skipped };
  }
}

/**
 * Filter invalid / harmful dependencies before running installs.
 * This prevents:
 * - Tailwind directive tokens mistaken as packages (404)
 * - next/* import paths mistaken as packages (git ls-remote failures)
 * - shadcn generator mistaken as packages (shadcn/ui, ui, @shadcn/ui)
 * - URL/git dependencies (unreliable in this tool)
 */
function filterInvalidDeps(deps: string[]): string[] {
  const denyExact = new Set<string>([
    // Tailwind directives (not packages)
    "@tailwindcss/base",
    "@tailwindcss/components",
    "@tailwindcss/utilities",
    "tailwindcss/base",
    "tailwindcss/components",
    "tailwindcss/utilities",
    "@tailwind/base",
    "@tailwind/components",
    "@tailwind/utilities",

    // shadcn generator hallucinations / wrong meta package
    "shadcn/ui",
    "shadcn-ui",
    "shadcn",
    "ui",
    "@shadcn/ui",

    // Known non-existent / hallucinated packages
    "@vercel/preact",

    // Next import paths commonly mistaken as deps
    "next/link",
    "next/image",
    "next/navigation",
    "next/router",
    "next/head",
    "next/server",
  ]);

  const out: string[] = [];
  for (const raw of deps) {
    const name = raw.trim();
    if (!name) continue;

    // Reject whitespace tokens
    if (/\s/.test(name)) continue;

    // Reject URL / git style deps
    const lower = name.toLowerCase();
    if (
      lower.startsWith("git+") ||
      lower.startsWith("git://") ||
      lower.startsWith("ssh://") ||
      lower.startsWith("github:") ||
      lower.includes("github.com/") ||
      lower.endsWith(".git")
    ) {
      continue;
    }

    if (denyExact.has(name)) continue;

    // Non-existent package sometimes suggested by the AI. Skip it (including versioned forms).
    if (name === "@vercel/preact" || name.startsWith("@vercel/preact@")) continue;

    // If it looks like an import path (has "/") and it's not a scoped package (@scope/pkg),
    // treat it as invalid for installation.
    if (name.includes("/") && !name.startsWith("@")) {
      continue;
    }

    // Block most @tailwindcss/* except known real packages.
    if (name.startsWith("@tailwindcss/")) {
      const allow = new Set<string>(["@tailwindcss/postcss", "@tailwindcss/node", "@tailwindcss/oxide"]);
      if (!allow.has(name)) continue;
    }

    out.push(name);
  }

  return out;
}

async function installDeps(projectDir: string, deps: string[]): Promise<string[]> {
  const cleaned = filterInvalidDeps(deps);
  const needed = Array.from(new Set(cleaned.map((d) => d.trim()).filter(Boolean)));
  if (needed.length === 0) return [];

  const { prod, dev } = splitDevDeps(needed);

  const hasPnpm = await cmdOk("pnpm");
  const hasNpm = await cmdOk("npm");
  const hasYarn = await cmdOk("yarn");

  const installedAll: string[] = [];

  if (hasPnpm) {
    // Always install into project dir explicitly, bypass workspace root check.
    // Best-effort: if one package fails (e.g. 404), install the rest and skip the bad one.
    const flags = ["--dir", projectDir, "--ignore-workspace-root-check"];

    const prodRes = await installBestEffort({
      cmd: "pnpm",
      cwd: projectDir,
      pkgs: prod,
      label: "prod",
      argsForPkgs: (pkgs) => ["add", ...pkgs, ...flags],
    });

    const devRes = await installBestEffort({
      cmd: "pnpm",
      cwd: projectDir,
      pkgs: dev,
      label: "dev",
      argsForPkgs: (pkgs) => ["add", "-D", ...pkgs, ...flags],
    });

    installedAll.push(...prodRes.installed, ...devRes.installed);
    return installedAll;
  }

  if (hasYarn) {
    const prodRes = await installBestEffort({
      cmd: "yarn",
      cwd: projectDir,
      pkgs: prod,
      label: "prod",
      argsForPkgs: (pkgs) => ["add", ...pkgs],
    });

    const devRes = await installBestEffort({
      cmd: "yarn",
      cwd: projectDir,
      pkgs: dev,
      label: "dev",
      argsForPkgs: (pkgs) => ["add", "-D", ...pkgs],
    });

    installedAll.push(...prodRes.installed, ...devRes.installed);
    return installedAll;
  }

  if (!hasNpm) {
    throw new Error("No package manager found (need pnpm, yarn, or npm).");
  }

  const prodRes = await installBestEffort({
    cmd: "npm",
    cwd: projectDir,
    pkgs: prod,
    label: "prod",
    argsForPkgs: (pkgs) => ["install", ...pkgs],
  });

  const devRes = await installBestEffort({
    cmd: "npm",
    cwd: projectDir,
    pkgs: dev,
    label: "dev",
    argsForPkgs: (pkgs) => ["install", "-D", ...pkgs],
  });

  installedAll.push(...prodRes.installed, ...devRes.installed);
  return installedAll;
}


export async function applyChanges(opts: { projectDir: string; files: FileChange[]; dependencies?: string[] }): Promise<ApplyResult> {
  const writtenFiles: string[] = [];
  for (const ch of opts.files) {
    const rel = await writeFile(opts.projectDir, ch);
    writtenFiles.push(rel);
  }

  const installedDependencies = await installDeps(opts.projectDir, opts.dependencies ?? []);
  return { writtenFiles, installedDependencies };
}
