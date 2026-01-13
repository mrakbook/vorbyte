import fs from "node:fs/promises";
import path from "node:path";

export type ActivityMessage = {
  id?: string;
  role: "system" | "assistant" | "user";
  content: string;
  createdAt?: string;
  ts?: number;
};

function nowIso() {
  return new Date().toISOString();
}

function makeId() {
  return Math.random().toString(16).slice(2) + Date.now().toString(16);
}

async function readJson<T>(p: string, fallback: T): Promise<T> {
  try {
    const raw = await fs.readFile(p, "utf-8");
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

async function writeJson(p: string, data: unknown) {
  await fs.mkdir(path.dirname(p), { recursive: true });
  await fs.writeFile(p, JSON.stringify(data, null, 2), "utf-8");
}

/**
 * Append a design activity message to the project's chat history.
 * Supports both:
 * - .vorbyte/chat.json   (array)
 * - .vorbyte/chat.jsonl  (JSON lines)
 */
export async function appendDesignActivity(projectPath: string, content: string): Promise<void> {
  const msg: ActivityMessage = {
    id: makeId(),
    role: "system",
    content,
    createdAt: nowIso(),
    ts: Date.now(),
  };

  const dir = path.join(projectPath, ".vorbyte");
  const jsonPath = path.join(dir, "chat.json");
  const jsonlPath = path.join(dir, "chat.jsonl");

  // Prefer chat.json if present
  try {
    const st = await fs.stat(jsonPath);
    if (st.isFile()) {
      const arr = await readJson<any[]>(jsonPath, []);
      arr.push(msg);
      await writeJson(jsonPath, arr);
      return;
    }
  } catch {
    // ignore
  }

  // Else write jsonl
  await fs.mkdir(dir, { recursive: true });
  await fs.appendFile(jsonlPath, JSON.stringify(msg) + "\n", "utf-8");
}
