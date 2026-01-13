import fs from "node:fs/promises";
import path from "node:path";

export type HistoryEntry = {
  id: string;
  label: string;
  filePathAbs: string;
  before: string;
  after: string;
  createdAt: string;
};

export type HistoryState = {
  undo: HistoryEntry[];
  redo: HistoryEntry[];
};

function nowIso() {
  return new Date().toISOString();
}

function makeId() {
  return Math.random().toString(16).slice(2) + Date.now().toString(16);
}

export class DesignHistory {
  private states = new Map<string, HistoryState>();

  private getState(projectPath: string): HistoryState {
    const key = path.resolve(projectPath);
    let st = this.states.get(key);
    if (!st) {
      st = { undo: [], redo: [] };
      this.states.set(key, st);
    }
    return st;
  }

  push(projectPath: string, entry: Omit<HistoryEntry, "id" | "createdAt">) {
    const st = this.getState(projectPath);
    st.undo.push({ ...entry, id: makeId(), createdAt: nowIso() });
    st.redo.length = 0;
    // cap
    if (st.undo.length > 100) st.undo.splice(0, st.undo.length - 100);
  }

  list(projectPath: string) {
    const st = this.getState(projectPath);
    return {
      undo: st.undo.slice().reverse(),
      redo: st.redo.slice().reverse(),
    };
  }

  async undo(projectPath: string): Promise<HistoryEntry | null> {
    const st = this.getState(projectPath);
    const last = st.undo.pop();
    if (!last) return null;

    await fs.writeFile(last.filePathAbs, last.before, "utf-8");
    st.redo.push(last);
    return last;
  }

  async redo(projectPath: string): Promise<HistoryEntry | null> {
    const st = this.getState(projectPath);
    const last = st.redo.pop();
    if (!last) return null;

    await fs.writeFile(last.filePathAbs, last.after, "utf-8");
    st.undo.push(last);
    return last;
  }
}
