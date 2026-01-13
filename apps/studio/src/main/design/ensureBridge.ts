import fs from "node:fs/promises";
import path from "node:path";

/**
 * Ensures the preview project includes the VorByte design bridge so that the Studio can:
 * - show a browser-like live preview (route tracking + back/forward)
 * - optionally enable Inspect mode (hover highlight + click selection)
 *
 * This is applied at runtime (when starting Design mode) so older projects work too.
 */

const BRIDGE_VERSION_MARKER = "VorByteDesignBridge v2";
const BRIDGE_FILE_NAME = "vorbyte-design-bridge.tsx";

const BRIDGE_SOURCE = "/* VorByteDesignBridge v2 */\n/**\n * Runs inside the previewed Next.js app (in an iframe).\n *\n * Responsibilities:\n * - Tell the parent (VorByte Studio) when the bridge is ready\n * - Report the current route so the Studio can show a browser-like address bar\n * - (Optional) Inspect mode: hover outline + click-to-select element metadata\n * - Apply quick DOM edits for a smoother UX while source files are being rewritten\n */\n\"use client\";\n\nimport { useEffect, useRef, useState } from \"react\";\n\ntype DesignSelection = {\n  selector: string;\n  tag: string;\n  text?: string;\n  className?: string;\n};\n\ntype ParentMessage =\n  | { kind: \"vorbyte:design\"; type: \"ping\" }\n  | { kind: \"vorbyte:design\"; type: \"enable\"; enabled: boolean }\n  | { kind: \"vorbyte:design\"; type: \"apply\"; selector: string; newText?: string; newClassName?: string }\n  | { kind: \"vorbyte:design\"; type: \"navigate\"; route: string }\n  | { kind: \"vorbyte:design\"; type: \"nav\"; action: \"back\" | \"forward\" | \"reload\" };\n\nfunction cssEscape(value: string): string {\n  // Prefer the platform escape (widely supported in modern browsers).\n  const css = (globalThis as any).CSS;\n  if (css && typeof css.escape === \"function\") return css.escape(value);\n  // Fallback: escape quotes + backslashes (enough for our data-vb-id usage).\n  return value.replace(/[\"\\\\]/g, \"\\\\$&\");\n}\n\nfunction ensureVbId(el: HTMLElement): string {\n  if (!el.dataset.vbId) {\n    el.dataset.vbId = \"vb_\" + Math.random().toString(16).slice(2) + Date.now().toString(16);\n  }\n  return el.dataset.vbId;\n}\n\nfunction selectionFromElement(el: HTMLElement): DesignSelection {\n  const id = ensureVbId(el);\n  const selector = `[data-vb-id=\"${cssEscape(id)}\"]`;\n  const text = (el.innerText || el.textContent || \"\").trim();\n  const className = (el.getAttribute(\"class\") || \"\").trim();\n  return {\n    selector,\n    tag: el.tagName.toLowerCase(),\n    text: text.length > 400 ? text.slice(0, 399) + \"\u2026\" : text,\n    className,\n  };\n}\n\nfunction postToParent(msg: any) {\n  try {\n    window.parent?.postMessage(msg, \"*\");\n  } catch {\n    // ignore\n  }\n}\n\nfunction currentRoute(): string {\n  return window.location.pathname + window.location.search + window.location.hash;\n}\n\nexport default function VorByteDesignBridge() {\n  const [enabled, setEnabled] = useState(false);\n\n  const hoverBoxRef = useRef<HTMLDivElement | null>(null);\n  const selectBoxRef = useRef<HTMLDivElement | null>(null);\n\n  function updateBox(box: HTMLDivElement, el: HTMLElement) {\n    const r = el.getBoundingClientRect();\n    box.style.display = \"block\";\n    box.style.left = r.left + \"px\";\n    box.style.top = r.top + \"px\";\n    box.style.width = r.width + \"px\";\n    box.style.height = r.height + \"px\";\n  }\n\n  function notifyRoute() {\n    postToParent({ kind: \"vorbyte:design\", type: \"route\", route: currentRoute() });\n  }\n\n  // Boot + keep the parent informed of route changes.\n  useEffect(() => {\n    postToParent({ kind: \"vorbyte:design\", type: \"ready\" });\n    notifyRoute();\n\n    // Monkey-patch history so SPA navigations still report routes.\n    const origPush = history.pushState;\n    const origReplace = history.replaceState;\n\n    function wrap(fn: typeof history.pushState) {\n      return function (this: any, ...args: any[]) {\n        const res = fn.apply(this, args as any);\n        // defer to let router finish updating location\n        setTimeout(notifyRoute, 0);\n        return res;\n      } as any;\n    }\n\n    try {\n      history.pushState = wrap(origPush);\n      history.replaceState = wrap(origReplace);\n    } catch {\n      // ignore if read-only\n    }\n\n    window.addEventListener(\"popstate\", notifyRoute);\n    window.addEventListener(\"hashchange\", notifyRoute);\n\n    return () => {\n      try {\n        history.pushState = origPush;\n        history.replaceState = origReplace;\n      } catch {\n        // ignore\n      }\n      window.removeEventListener(\"popstate\", notifyRoute);\n      window.removeEventListener(\"hashchange\", notifyRoute);\n    };\n    // eslint-disable-next-line react-hooks/exhaustive-deps\n  }, []);\n\n  // Message handling from Studio.\n  useEffect(() => {\n    function onMessage(e: MessageEvent) {\n      const data = e.data as ParentMessage | any;\n      if (!data || typeof data !== \"object\") return;\n      if (data.kind !== \"vorbyte:design\") return;\n\n      if (data.type === \"ping\") {\n        postToParent({ kind: \"vorbyte:design\", type: \"pong\" });\n        notifyRoute();\n        return;\n      }\n\n      if (data.type === \"enable\") {\n        setEnabled(!!data.enabled);\n        return;\n      }\n\n      if (data.type === \"apply\") {\n        const selector = typeof data.selector === \"string\" ? data.selector : null;\n        if (!selector) return;\n        const el = document.querySelector(selector) as HTMLElement | null;\n        if (!el) return;\n\n        if (typeof data.newText === \"string\") {\n          el.innerText = data.newText;\n        }\n        if (typeof data.newClassName === \"string\") {\n          el.setAttribute(\"class\", data.newClassName);\n        }\n        return;\n      }\n\n      if (data.type === \"navigate\") {\n        const route = typeof data.route === \"string\" ? data.route : \"/\";\n        try {\n          // Allow either a path (/about) or a full URL.\n          if (route.startsWith(\"http://\") || route.startsWith(\"https://\") || route.startsWith(\"//\")) {\n            window.location.assign(route);\n          } else {\n            const raw = route.trim() || \"/\";\n            const next = raw.startsWith(\"/\") ? raw : `/${raw}`;\n            window.location.assign(next);\n          }\n        } catch {\n          // ignore\n        }\n        return;\n      }\n\n      if (data.type === \"nav\") {\n        const action = data.action;\n        try {\n          if (action === \"back\") history.back();\n          if (action === \"forward\") history.forward();\n          if (action === \"reload\") window.location.reload();\n        } catch {\n          // ignore\n        }\n        return;\n      }\n    }\n\n    window.addEventListener(\"message\", onMessage);\n    return () => window.removeEventListener(\"message\", onMessage);\n    // eslint-disable-next-line react-hooks/exhaustive-deps\n  }, []);\n\n  // Create overlays once.\n  useEffect(() => {\n    if (!hoverBoxRef.current) {\n      const d = document.createElement(\"div\");\n      d.style.position = \"fixed\";\n      d.style.zIndex = \"2147483647\";\n      d.style.pointerEvents = \"none\";\n      d.style.border = \"2px solid rgba(59,130,246,0.9)\";\n      d.style.background = \"rgba(59,130,246,0.08)\";\n      d.style.display = \"none\";\n      document.body.appendChild(d);\n      hoverBoxRef.current = d;\n    }\n    if (!selectBoxRef.current) {\n      const d = document.createElement(\"div\");\n      d.style.position = \"fixed\";\n      d.style.zIndex = \"2147483647\";\n      d.style.pointerEvents = \"none\";\n      d.style.border = \"2px solid rgba(34,197,94,0.95)\";\n      d.style.background = \"rgba(34,197,94,0.06)\";\n      d.style.display = \"none\";\n      document.body.appendChild(d);\n      selectBoxRef.current = d;\n    }\n  }, []);\n\n  // Inspect mode listeners.\n  useEffect(() => {\n    if (!enabled) {\n      if (hoverBoxRef.current) hoverBoxRef.current.style.display = \"none\";\n      return;\n    }\n\n    function onMove(e: MouseEvent) {\n      if (!enabled) return;\n      const target = e.target as HTMLElement | null;\n      if (!target) return;\n\n      if (target === hoverBoxRef.current || target === selectBoxRef.current) return;\n      if (target.closest(\"[data-vb-ignore]\")) return;\n\n      const box = hoverBoxRef.current;\n      if (!box) return;\n      updateBox(box, target);\n    }\n\n    function onClick(e: MouseEvent) {\n      if (!enabled) return;\n\n      // While inspect is enabled, prevent navigation and let the user select.\n      e.preventDefault();\n      e.stopPropagation();\n\n      const target = e.target as HTMLElement | null;\n      if (!target) return;\n      if (target === hoverBoxRef.current || target === selectBoxRef.current) return;\n      if (target.closest(\"[data-vb-ignore]\")) return;\n\n      const selection = selectionFromElement(target);\n\n      // lock selection outline\n      if (selectBoxRef.current) updateBox(selectBoxRef.current, target);\n\n      postToParent({ kind: \"vorbyte:design\", type: \"selected\", selection });\n    }\n\n    window.addEventListener(\"mousemove\", onMove, true);\n    window.addEventListener(\"click\", onClick, true);\n\n    return () => {\n      window.removeEventListener(\"mousemove\", onMove, true);\n      window.removeEventListener(\"click\", onClick, true);\n    };\n  }, [enabled]);\n\n  return null;\n}\n";

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

function isSrcLayout(layoutAbs: string): boolean {
  const norm = layoutAbs.replace(/\\/g, "/");
  return norm.includes("/src/");
}

function computeBridgeAbs(projectPath: string, layoutAbs: string): string {
  const root = path.resolve(projectPath);
  const componentsDir = isSrcLayout(layoutAbs) ? "src/components" : "components";
  return path.join(root, componentsDir, BRIDGE_FILE_NAME);
}

function importSpecifier(fromFileAbs: string, toFileAbs: string): string {
  const rel = path.relative(path.dirname(fromFileAbs), toFileAbs).replace(/\\/g, "/");
  const noExt = rel.replace(/\.(tsx|ts|jsx|js)$/i, "");
  return noExt.startsWith(".") ? noExt : "./" + noExt;
}

function ensureImport(src: string, spec: string): string {
  if (src.includes("VorByteDesignBridge")) return src;

  const importLine = `import VorByteDesignBridge from "${spec}";\n`;

  // Insert after the initial import block (keeps prettier-ish structure).
  const m = src.match(/^(?:import[^\n]*\n)+/m);
  if (m && m.index === 0) {
    return src.replace(m[0], m[0] + importLine);
  }
  return importLine + src;
}

function ensureRender(src: string): string {
  if (src.includes("<VorByteDesignBridge")) return src;

  if (/<\/body>/i.test(src)) {
    return src.replace(/<\/body>/i, `  <VorByteDesignBridge />\n</body>`);
  }
  if (/<\/html>/i.test(src)) {
    return src.replace(/<\/html>/i, `  <VorByteDesignBridge />\n</html>`);
  }
  return src + `\n<VorByteDesignBridge />\n`;
}

export async function ensureDesignBridge(projectPath: string): Promise<void> {
  // Find a Next.js App Router layout file.
  const layouts = candidateLayoutFiles(projectPath);
  let layoutAbs: string | null = null;

  for (const candidate of layouts) {
    if (await fileExists(candidate)) {
      layoutAbs = candidate;
      break;
    }
  }

  if (!layoutAbs) {
    // If no layout found, do nothing (project may be pages-router only).
    return;
  }

  // Ensure bridge file exists (and is up to date).
  const bridgeAbs = computeBridgeAbs(projectPath, layoutAbs);
  const bridgeDir = path.dirname(bridgeAbs);
  await fs.mkdir(bridgeDir, { recursive: true });

  const existing = await fs.readFile(bridgeAbs, "utf-8").catch(() => null);
  if (!existing || !existing.includes(BRIDGE_VERSION_MARKER)) {
    await fs.writeFile(bridgeAbs, BRIDGE_SOURCE, "utf-8");
  }

  // Ensure layout imports + renders <VorByteDesignBridge />
  const src = await fs.readFile(layoutAbs, "utf-8").catch(() => null);
  if (src == null) return;

  const spec = importSpecifier(layoutAbs, bridgeAbs);
  let next = src;
  next = ensureImport(next, spec);
  next = ensureRender(next);

  if (next !== src) {
    await fs.writeFile(layoutAbs, next, "utf-8");
  }
}
