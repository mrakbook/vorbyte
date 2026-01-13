/* VorByteDesignBridge v2 */
/**
 * Runs inside the previewed Next.js app (in an iframe).
 *
 * Responsibilities:
 * - Tell the parent (VorByte Studio) when the bridge is ready
 * - Report the current route so the Studio can show a browser-like address bar
 * - (Optional) Inspect mode: hover outline + click-to-select element metadata
 * - Apply quick DOM edits for a smoother UX while source files are being rewritten
 */
"use client";

import { useEffect, useRef, useState } from "react";

type DesignSelection = {
  selector: string;
  tag: string;
  text?: string;
  className?: string;
};

type ParentMessage =
  | { kind: "vorbyte:design"; type: "ping" }
  | { kind: "vorbyte:design"; type: "enable"; enabled: boolean }
  | { kind: "vorbyte:design"; type: "apply"; selector: string; newText?: string; newClassName?: string }
  | { kind: "vorbyte:design"; type: "navigate"; route: string }
  | { kind: "vorbyte:design"; type: "nav"; action: "back" | "forward" | "reload" };

function cssEscape(value: string): string {
  // Prefer the platform escape (widely supported in modern browsers).
  const css = (globalThis as any).CSS;
  if (css && typeof css.escape === "function") return css.escape(value);
  // Fallback: escape quotes + backslashes (enough for our data-vb-id usage).
  return value.replace(/["\\]/g, "\\$&");
}

function ensureVbId(el: HTMLElement): string {
  if (!el.dataset.vbId) {
    el.dataset.vbId = "vb_" + Math.random().toString(16).slice(2) + Date.now().toString(16);
  }
  return el.dataset.vbId;
}

function selectionFromElement(el: HTMLElement): DesignSelection {
  const id = ensureVbId(el);
  const selector = `[data-vb-id="${cssEscape(id)}"]`;
  const text = (el.innerText || el.textContent || "").trim();
  const className = (el.getAttribute("class") || "").trim();
  return {
    selector,
    tag: el.tagName.toLowerCase(),
    text: text.length > 400 ? text.slice(0, 399) + "…" : text,
    className,
  };
}

function postToParent(msg: any) {
  try {
    window.parent?.postMessage(msg, "*");
  } catch {
    // ignore
  }
}

function currentRoute(): string {
  return window.location.pathname + window.location.search + window.location.hash;
}

export default function VorByteDesignBridge() {
  const [enabled, setEnabled] = useState(false);

  const hoverBoxRef = useRef<HTMLDivElement | null>(null);
  const selectBoxRef = useRef<HTMLDivElement | null>(null);

  function updateBox(box: HTMLDivElement, el: HTMLElement) {
    const r = el.getBoundingClientRect();
    box.style.display = "block";
    box.style.left = r.left + "px";
    box.style.top = r.top + "px";
    box.style.width = r.width + "px";
    box.style.height = r.height + "px";
  }

  function notifyRoute() {
    postToParent({ kind: "vorbyte:design", type: "route", route: currentRoute() });
  }

  // Boot + keep the parent informed of route changes.
  useEffect(() => {
    postToParent({ kind: "vorbyte:design", type: "ready" });
    notifyRoute();

    // Monkey-patch history so SPA navigations still report routes.
    const origPush = history.pushState;
    const origReplace = history.replaceState;

    function wrap(fn: typeof history.pushState) {
      return function (this: any, ...args: any[]) {
        const res = fn.apply(this, args as any);
        // defer to let router finish updating location
        setTimeout(notifyRoute, 0);
        return res;
      } as any;
    }

    try {
      history.pushState = wrap(origPush);
      history.replaceState = wrap(origReplace);
    } catch {
      // ignore if read-only
    }

    window.addEventListener("popstate", notifyRoute);
    window.addEventListener("hashchange", notifyRoute);

    return () => {
      try {
        history.pushState = origPush;
        history.replaceState = origReplace;
      } catch {
        // ignore
      }
      window.removeEventListener("popstate", notifyRoute);
      window.removeEventListener("hashchange", notifyRoute);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Message handling from Studio.
  useEffect(() => {
    function onMessage(e: MessageEvent) {
      const data = e.data as ParentMessage | any;
      if (!data || typeof data !== "object") return;
      if (data.kind !== "vorbyte:design") return;

      if (data.type === "ping") {
        postToParent({ kind: "vorbyte:design", type: "pong" });
        notifyRoute();
        return;
      }

      if (data.type === "enable") {
        setEnabled(!!data.enabled);
        return;
      }

      if (data.type === "apply") {
        const selector = typeof data.selector === "string" ? data.selector : null;
        if (!selector) return;
        const el = document.querySelector(selector) as HTMLElement | null;
        if (!el) return;

        if (typeof data.newText === "string") {
          el.innerText = data.newText;
        }
        if (typeof data.newClassName === "string") {
          el.setAttribute("class", data.newClassName);
        }
        return;
      }

      if (data.type === "navigate") {
        const route = typeof data.route === "string" ? data.route : "/";
        try {
          // Allow either a path (/about) or a full URL.
          if (route.startsWith("http://") || route.startsWith("https://") || route.startsWith("//")) {
            window.location.assign(route);
          } else {
            const raw = route.trim() || "/";
            const next = raw.startsWith("/") ? raw : `/${raw}`;
            window.location.assign(next);
          }
        } catch {
          // ignore
        }
        return;
      }

      if (data.type === "nav") {
        const action = data.action;
        try {
          if (action === "back") history.back();
          if (action === "forward") history.forward();
          if (action === "reload") window.location.reload();
        } catch {
          // ignore
        }
        return;
      }
    }

    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Create overlays once.
  useEffect(() => {
    if (!hoverBoxRef.current) {
      const d = document.createElement("div");
      d.style.position = "fixed";
      d.style.zIndex = "2147483647";
      d.style.pointerEvents = "none";
      d.style.border = "2px solid rgba(59,130,246,0.9)";
      d.style.background = "rgba(59,130,246,0.08)";
      d.style.display = "none";
      document.body.appendChild(d);
      hoverBoxRef.current = d;
    }
    if (!selectBoxRef.current) {
      const d = document.createElement("div");
      d.style.position = "fixed";
      d.style.zIndex = "2147483647";
      d.style.pointerEvents = "none";
      d.style.border = "2px solid rgba(34,197,94,0.95)";
      d.style.background = "rgba(34,197,94,0.06)";
      d.style.display = "none";
      document.body.appendChild(d);
      selectBoxRef.current = d;
    }
  }, []);

  // Inspect mode listeners.
  useEffect(() => {
    if (!enabled) {
      if (hoverBoxRef.current) hoverBoxRef.current.style.display = "none";
      return;
    }

    function onMove(e: MouseEvent) {
      if (!enabled) return;
      const target = e.target as HTMLElement | null;
      if (!target) return;

      if (target === hoverBoxRef.current || target === selectBoxRef.current) return;
      if (target.closest("[data-vb-ignore]")) return;

      const box = hoverBoxRef.current;
      if (!box) return;
      updateBox(box, target);
    }

    function onClick(e: MouseEvent) {
      if (!enabled) return;

      // While inspect is enabled, prevent navigation and let the user select.
      e.preventDefault();
      e.stopPropagation();

      const target = e.target as HTMLElement | null;
      if (!target) return;
      if (target === hoverBoxRef.current || target === selectBoxRef.current) return;
      if (target.closest("[data-vb-ignore]")) return;

      const selection = selectionFromElement(target);

      // lock selection outline
      if (selectBoxRef.current) updateBox(selectBoxRef.current, target);

      postToParent({ kind: "vorbyte:design", type: "selected", selection });
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
