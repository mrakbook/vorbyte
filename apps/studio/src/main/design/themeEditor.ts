import fs from "node:fs/promises";
import path from "node:path";

export type ThemeVars = Record<string, string>;

export type ThemeState = {
  light: ThemeVars;
  dark: ThemeVars;
};

const DEFAULT_LIGHT: ThemeVars = {
  "--background": "0 0% 100%",
  "--foreground": "240 10% 3.9%",
  "--primary": "240 5.9% 10%",
  "--primary-foreground": "0 0% 98%",
  "--muted": "240 4.8% 95.9%",
  "--muted-foreground": "240 3.8% 46.1%",
  "--border": "240 5.9% 90%",
  "--radius": "0.5rem",
};

const DEFAULT_DARK: ThemeVars = {
  "--background": "240 10% 3.9%",
  "--foreground": "0 0% 98%",
  "--primary": "0 0% 98%",
  "--primary-foreground": "240 5.9% 10%",
  "--muted": "240 3.7% 15.9%",
  "--muted-foreground": "240 5% 64.9%",
  "--border": "240 3.7% 15.9%",
  "--radius": "0.5rem",
};

function normalizeFileCandidates(projectPath: string): string[] {
  const root = path.resolve(projectPath);
  return [
    path.join(root, "src/app/globals.css"),
    path.join(root, "app/globals.css"),
    path.join(root, "src/styles/globals.css"),
    path.join(root, "styles/globals.css"),
  ];
}

async function readFileIfExists(p: string): Promise<string | null> {
  try {
    return await fs.readFile(p, "utf-8");
  } catch {
    return null;
  }
}

function parseVars(block: string): ThemeVars {
  const vars: ThemeVars = {};
  const re = /(--[a-zA-Z0-9-]+)\s*:\s*([^;]+);/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(block))) {
    vars[m[1]] = m[2].trim();
  }
  return vars;
}

function renderVars(vars: ThemeVars): string {
  const keys = Object.keys(vars).sort();
  return keys.map((k) => `  ${k}: ${vars[k]};`).join("\n");
}

function upsertBlock(css: string, selector: string, vars: ThemeVars): string {
  const re = new RegExp(`${selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*\\{([\\s\\S]*?)\\}`, "m");
  const match = css.match(re);
  const content = renderVars(vars);

  if (match) {
    return css.replace(re, `${selector} {\n${content}\n}`);
  }

  // Insert near top after @tailwind directives if present
  const tailwindIdx = css.lastIndexOf("@tailwind");
  if (tailwindIdx >= 0) {
    const insertAt = css.indexOf("\n", tailwindIdx);
    const head = css.slice(0, insertAt + 1);
    const rest = css.slice(insertAt + 1);
    return `${head}\n${selector} {\n${content}\n}\n\n${rest}`;
  }

  return `${selector} {\n${content}\n}\n\n${css}`;
}

export async function getTheme(projectPath: string): Promise<{ filePathAbs: string; theme: ThemeState }> {
  const candidates = normalizeFileCandidates(projectPath);
  for (const p of candidates) {
    const css = await readFileIfExists(p);
    if (css == null) continue;

    const rootMatch = css.match(/:root\s*\{([\s\S]*?)\}/m);
    const darkMatch = css.match(/\.dark\s*\{([\s\S]*?)\}/m);

    const light = { ...DEFAULT_LIGHT, ...(rootMatch ? parseVars(rootMatch[1]) : {}) };
    const dark = { ...DEFAULT_DARK, ...(darkMatch ? parseVars(darkMatch[1]) : {}) };

    return { filePathAbs: p, theme: { light, dark } };
  }

  // If no globals.css exists, create src/app/globals.css
  const fallback = candidates[0];
  return { filePathAbs: fallback, theme: { light: { ...DEFAULT_LIGHT }, dark: { ...DEFAULT_DARK } } };
}

export async function setTheme(projectPath: string, next: Partial<ThemeState>): Promise<{ filePathAbs: string; before: string; after: string }> {
  const { filePathAbs, theme } = await getTheme(projectPath);
  const before = (await readFileIfExists(filePathAbs)) ?? "";

  const merged: ThemeState = {
    light: { ...theme.light, ...(next.light ?? {}) },
    dark: { ...theme.dark, ...(next.dark ?? {}) },
  };

  let after = before;
  after = upsertBlock(after, ":root", merged.light);
  after = upsertBlock(after, ".dark", merged.dark);

  await fs.mkdir(path.dirname(filePathAbs), { recursive: true });
  await fs.writeFile(filePathAbs, after.endsWith("\n") ? after : after + "\n", "utf-8");

  return { filePathAbs, before, after };
}
