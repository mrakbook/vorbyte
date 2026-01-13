import fs from "node:fs/promises";
import path from "node:path";

/**
 * Ensures the preview project includes the VorByte design bridge so that:
 * - hover highlight works
 * - click selection works (postMessage to parent)
 *
 * This is applied at runtime (when starting Design mode) so older projects work too.
 */

const BRIDGE_REL = "src/components/vorbyte-design-bridge.tsx";

const BRIDGE_SOURCE = `\"use client\";
import React, { useEffect, useMemo, useRef, useState } from "react";

type DomPathStep = { tag: string; nth: number };

function computeDomPath(el: Element): DomPathStep[] {
  const steps: DomPathStep[] = [];
  let cur: Element | null = el;
  while (cur && cur.nodeType === 1 && steps.length < 30) {
    const tag = cur.tagName.toLowerCase();
    let nth = 1;
    const parent = cur.parentElement;
    if (parent) {
      const siblings = Array.from(parent.children).filter((c) => c.tagName.toLowerCase() === tag);
      nth = siblings.indexOf(cur) + 1;
    }
    steps.push({ tag, nth });
    cur = cur.parentElement;
  }
  return steps.reverse();
}

function ensureVbId(el: HTMLElement): string {
  if (!el.dataset.vbId) {
    el.dataset.vbId = "vb_" + Math.random().toString(16).slice(2) + Date.now().toString(16);
  }
  return el.dataset.vbId;
}

function getText(el: HTMLElement): string {
  // Prefer direct textContent but keep it small
  const txt = (el.innerText || el.textContent || "").trim();
  return txt.length > 200 ? txt.slice(0, 200) : txt;
}

function getClassName(el: HTMLElement): string {
  return (el.getAttribute("class") || "").trim();
}

type SelectionPayload = {
  type: "VORBYTE_DESIGN_SELECTION";
  payload: {
    vbId: string;
    tag: string;
    domPath: DomPathStep[];
    text: string;
    className: string;
  };
};

type ApplyPayload = {
  type: "VORBYTE_DESIGN_APPLY_DOM";
  payload: {
    vbId: string;
    newText?: string;
    className?: string;
  };
};

export default function VorByteDesignBridge() {
  const [enabled, setEnabled] = useState(false);
  const hoverRef = useRef<HTMLDivElement | null>(null);
  const selectRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    function onMessage(e: MessageEvent) {
      if (!e.data) return;
      if (e.data.type === "VORBYTE_DESIGN_TOGGLE") {
        setEnabled(!!e.data.enabled);
        return;
      }
      const msg = e.data as ApplyPayload;
      if (msg.type === "VORBYTE_DESIGN_APPLY_DOM") {
        const vbId = msg.payload?.vbId;
        if (!vbId) return;
        const el = document.querySelector('[data-vb-id=\"' + vbId + '\"]') as HTMLElement | null;
        if (!el) return;
        if (typeof msg.payload.newText === "string") {
          el.innerText = msg.payload.newText;
        }
        if (typeof msg.payload.className === "string") {
          el.setAttribute("class", msg.payload.className);
        }
      }
    }
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, []);

  useEffect(() => {
    // Create overlays
    if (!hoverRef.current) {
      const d = document.createElement("div");
      d.style.position = "fixed";
      d.style.zIndex = "2147483647";
      d.style.pointerEvents = "none";
      d.style.border = "2px solid rgba(59,130,246,0.9)";
      d.style.background = "rgba(59,130,246,0.08)";
      d.style.display = "none";
      document.body.appendChild(d);
      hoverRef.current = d;
    }
    if (!selectRef.current) {
      const d = document.createElement("div");
      d.style.position = "fixed";
      d.style.zIndex = "2147483647";
      d.style.pointerEvents = "none";
      d.style.border = "2px solid rgba(34,197,94,0.95)";
      d.style.background = "rgba(34,197,94,0.06)";
      d.style.display = "none";
      document.body.appendChild(d);
      selectRef.current = d;
    }
  }, []);

  useEffect(() => {
    if (!enabled) {
      if (hoverRef.current) hoverRef.current.style.display = "none";
      return;
    }

    function updateBox(box: HTMLDivElement, el: HTMLElement) {
      const r = el.getBoundingClientRect();
      box.style.display = "block";
      box.style.left = r.left + "px";
      box.style.top = r.top + "px";
      box.style.width = r.width + "px";
      box.style.height = r.height + "px";
    }

    function onMove(e: MouseEvent) {
      if (!enabled) return;
      const target = e.target as HTMLElement | null;
      if (!target) return;
      if (target === hoverRef.current || target === selectRef.current) return;
      if (target.closest("[data-vb-ignore]")) return;

      updateBox(hoverRef.current!, target);
    }

    function onClick(e: MouseEvent) {
      if (!enabled) return;
      e.preventDefault();
      e.stopPropagation();

      const target = e.target as HTMLElement | null;
      if (!target) return;

      const vbId = ensureVbId(target);
      const payload: SelectionPayload = {
        type: "VORBYTE_DESIGN_SELECTION",
        payload: {
          vbId,
          tag: target.tagName.toLowerCase(),
          domPath: computeDomPath(target),
          text: getText(target),
          className: getClassName(target),
        },
      };

      // lock selection outline
      if (selectRef.current) {
        const r = target.getBoundingClientRect();
        selectRef.current.style.display = "block";
        selectRef.current.style.left = r.left + "px";
        selectRef.current.style.top = r.top + "px";
        selectRef.current.style.width = r.width + "px";
        selectRef.current.style.height = r.height + "px";
      }

      window.parent.postMessage(payload, "*");
    }

    window.addEventListener("mousemove", onMove, true);
    window.addEventListener("click", onClick, true);

    return () => {
      window.removeEventListener("mousemove", onMove, true);
      window.removeEventListener("click", onClick, true);
    };
  }, [enabled]);

  return null;
}
`;

async function fileExists(p: string) {
  try {
    await fs.access(p);
    return true;
  } catch {
    return false;
  }
}

function candidateLayoutFiles(projectPath: string): string[] {
  const root = path.resolve(projectPath);
  return [
    path.join(root, "src/app/layout.tsx"),
    path.join(root, "app/layout.tsx"),
    path.join(root, "src/app/layout.jsx"),
    path.join(root, "app/layout.jsx"),
  ];
}

export async function ensureDesignBridge(projectPath: string): Promise<void> {
  const absBridge = path.join(path.resolve(projectPath), BRIDGE_REL);
  if (!(await fileExists(absBridge))) {
    await fs.mkdir(path.dirname(absBridge), { recursive: true });
    await fs.writeFile(absBridge, BRIDGE_SOURCE, "utf-8");
  }

  // Ensure layout imports + renders <VorByteDesignBridge />
  const layouts = candidateLayoutFiles(projectPath);
  for (const layout of layouts) {
    const src = await fs.readFile(layout, "utf-8").catch(() => null);
    if (src == null) continue;

    let next = src;

    if (!next.includes("VorByteDesignBridge")) {
      // add import near top
      const importLine = `import VorByteDesignBridge from "../components/vorbyte-design-bridge";\n`;
      // If layout is in src/app, ../components is correct. If app/layout, it might be ../components too (common).
      // Use a cautious insertion after first import.
      const m = next.match(/import[^\n]*\n/);
      if (m) {
        next = next.replace(m[0], m[0] + importLine);
      } else {
        next = importLine + next;
      }
    }

    if (!next.includes("<VorByteDesignBridge")) {
      // insert inside body of RootLayout
      // try just before closing body tag
      next = next.replace(/<\/body>/i, `  <VorByteDesignBridge />\n</body>`);
    }

    if (next !== src) {
      await fs.writeFile(layout, next, "utf-8");
    }

    return;
  }

  // If no layout found, do nothing (project may be pages-router only)
}
