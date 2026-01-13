import fs from "node:fs/promises";
import path from "node:path";
import { parse } from "@babel/parser";
import traverse from "@babel/traverse";
import generate from "@babel/generator";
import * as t from "@babel/types";

/**
 * Milestone 4: Robust DOM -> JSX mapping + edit application.
 *
 * Strategy:
 * 1) Prefer stable `data-vb-id` (vbId) to locate the JSXOpeningElement attribute.
 * 2) Fallback: domPath suffix matching (tag + nth-of-type) as a heuristic.
 * 3) Only edit:
 *    - text content (JSXText / JSXExpressionContainer string literal)
 *    - className (string literal)
 *    - data-vb-id insertion (to stabilize future selections)
 *
 * NOTE: This is intentionally conservative. If we cannot find a safe edit target,
 * we return a structured error instead of guessing.
 */

export type DomPathStep = { tag: string; nth: number };

export type DesignSelection = {
  vbId?: string | null;
  tag?: string | null;
  domPath?: DomPathStep[] | null;
  text?: string | null;
  className?: string | null;
};

export type TailwindClassPatch = {
  // remove any classes with these prefixes (e.g. "text-", "bg-", "p-", "m-")
  removePrefixes?: string[];
  // remove exact classes
  removeExact?: string[];
  // add these classes (deduped)
  add?: string[];
};

export type DesignEdit =
  | { kind: "text"; newText: string }
  | { kind: "className"; patch: TailwindClassPatch }
  | { kind: "insert"; jsx: string }; // optional future extension

export type ApplyAstEditInput = {
  filePathAbs: string;
  selection: DesignSelection;
  edit: DesignEdit;
};

export type ApplyAstEditResult =
  | { ok: true; before: string; after: string; changed: boolean; matchedBy: "vbId" | "domPath" }
  | { ok: false; error: string };

function parseTsx(code: string) {
  return parse(code, {
    sourceType: "module",
    plugins: ["typescript", "jsx"],
  });
}

function getAttr(opening: t.JSXOpeningElement, name: string): t.JSXAttribute | null {
  for (const a of opening.attributes) {
    if (t.isJSXAttribute(a) && t.isJSXIdentifier(a.name) && a.name.name === name) return a;
  }
  return null;
}

function getStringAttrValue(attr: t.JSXAttribute | null): string | null {
  if (!attr) return null;
  const v = attr.value;
  if (!v) return null;
  if (t.isStringLiteral(v)) return v.value;
  if (t.isJSXExpressionContainer(v) && t.isStringLiteral(v.expression)) return v.expression.value;
  return null;
}

function setStringAttrValue(opening: t.JSXOpeningElement, name: string, value: string) {
  const existing = getAttr(opening, name);
  const literal = t.stringLiteral(value);
  if (existing) {
    existing.value = literal;
  } else {
    opening.attributes.push(t.jsxAttribute(t.jsxIdentifier(name), literal));
  }
}

function normalizeSteps(steps: DomPathStep[] | null | undefined): DomPathStep[] {
  if (!steps || !Array.isArray(steps)) return [];
  return steps
    .filter((s) => s && typeof s.tag === "string" && typeof s.nth === "number")
    .map((s) => ({ tag: s.tag.toLowerCase(), nth: Math.max(1, Math.floor(s.nth)) }));
}

function splitClasses(cls: string): string[] {
  return cls
    .split(/\s+/g)
    .map((x) => x.trim())
    .filter(Boolean);
}

function joinClasses(xs: string[]): string {
  return Array.from(new Set(xs)).join(" ");
}

function applyTailwindPatch(existing: string, patch: TailwindClassPatch): string {
  let classes = splitClasses(existing);

  if (patch.removeExact?.length) {
    const remove = new Set(patch.removeExact);
    classes = classes.filter((c) => !remove.has(c));
  }

  if (patch.removePrefixes?.length) {
    for (const prefix of patch.removePrefixes) {
      if (!prefix) continue;
      classes = classes.filter((c) => !c.startsWith(prefix));
    }
  }

  if (patch.add?.length) {
    classes = classes.concat(patch.add.filter(Boolean));
  }

  return joinClasses(classes);
}

type MatchCandidate = {
  opening: t.JSXOpeningElement;
  matchedBy: "vbId" | "domPath";
};

function matchByVbId(ast: t.File, vbId: string): MatchCandidate | null {
  let found: t.JSXOpeningElement | null = null;

  traverse(ast, {
    JSXOpeningElement(p) {
      if (found) return;
      const attr = getAttr(p.node, "data-vb-id");
      const v = getStringAttrValue(attr);
      if (v === vbId) {
        found = p.node;
        p.stop();
      }
    },
  });

  if (!found) return null;
  return { opening: found, matchedBy: "vbId" };
}

/**
 * Very conservative domPath matching:
 * We reconstruct a minimal path of JSX elements by walking parents.
 * We don't have actual DOM nth-of-type info in TSX, so we match by suffix
 * of tag names only, then use nth as a tie-breaker by counting siblings with same tag.
 */
function matchByDomPath(ast: t.File, domPath: DomPathStep[]): MatchCandidate | null {
  if (domPath.length === 0) return null;

  // Collect all candidate openings with matching tag for the last step.
  const last = domPath[domPath.length - 1];
  const candidates: t.JSXOpeningElement[] = [];

  traverse(ast, {
    JSXOpeningElement(p) {
      const n = p.node;
      const name = n.name;
      if (t.isJSXIdentifier(name) && name.name.toLowerCase() === last.tag) {
        candidates.push(n);
      }
    },
  });

  if (candidates.length === 0) return null;

  // Score candidates by how well their ancestor tag suffix matches.
  function getAncestorTags(opening: t.JSXOpeningElement): string[] {
    const tags: string[] = [];
    let cur: any = (opening as any);
    while (cur) {
      const parent = (cur as any)._parent;
      cur = parent;
      if (!cur) break;
      if (cur.type === "JSXElement") {
        const op = cur.openingElement;
        if (op && op.name && op.name.type === "JSXIdentifier") tags.push(op.name.name.toLowerCase());
      }
      if (tags.length > 20) break;
    }
    return tags.reverse();
  }

  // Attach parents to nodes by doing a traverse with manual parent links.
  traverse(ast, {
    enter(p) {
      const node: any = p.node;
      node._parent = p.parent;
    },
  });

  const desiredTags = domPath.map((s) => s.tag);
  const desiredSuffix = desiredTags.join(">");

  let best: { node: t.JSXOpeningElement; score: number } | null = null;

  for (const c of candidates) {
    const anc = getAncestorTags(c);
    const full = anc.concat([t.isJSXIdentifier(c.name) ? c.name.name.toLowerCase() : ""]);
    const fullStr = full.join(">");

    // Suffix match score
    let score = 0;
    if (fullStr.endsWith(desiredSuffix)) score += 1000;

    // partial suffix score
    for (let i = 1; i <= desiredTags.length; i++) {
      const suf = desiredTags.slice(desiredTags.length - i).join(">");
      if (fullStr.endsWith(suf)) score += i * 10;
    }

    if (!best || score > best.score) best = { node: c, score };
  }

  if (!best || best.score < 20) return null;
  return { opening: best.node, matchedBy: "domPath" };
}

function ensureVbId(opening: t.JSXOpeningElement, vbId: string) {
  const existing = getStringAttrValue(getAttr(opening, "data-vb-id"));
  if (existing === vbId) return;
  setStringAttrValue(opening, "data-vb-id", vbId);
}

function updateTextInElement(el: t.JSXElement, newText: string): boolean {
  // Prefer first JSXText node with non-whitespace, else first string literal expression.
  const children = el.children ?? [];
  for (const ch of children) {
    if (t.isJSXText(ch) && ch.value.trim().length > 0) {
      ch.value = newText;
      return true;
    }
    if (t.isJSXExpressionContainer(ch) && t.isStringLiteral(ch.expression)) {
      ch.expression.value = newText;
      return true;
    }
  }
  // If empty, insert a JSXText child.
  el.children = [t.jsxText(newText)];
  return true;
}

export async function applyAstEdit(input: ApplyAstEditInput): Promise<ApplyAstEditResult> {
  const { filePathAbs, selection, edit } = input;

  let before: string;
  try {
    before = await fs.readFile(filePathAbs, "utf-8");
  } catch (e) {
    return { ok: false, error: `Cannot read file: ${filePathAbs}` };
  }

  let ast: t.File;
  try {
    ast = parseTsx(before) as unknown as t.File;
  } catch (e: any) {
    return { ok: false, error: `TSX parse failed for ${path.basename(filePathAbs)}: ${e?.message ?? e}` };
  }

  const vbId = (selection.vbId ?? "").trim() || null;
  const domPath = normalizeSteps(selection.domPath);

  let match: MatchCandidate | null = null;

  if (vbId) match = matchByVbId(ast, vbId);
  if (!match && domPath.length) match = matchByDomPath(ast, domPath);

  if (!match) {
    return { ok: false, error: `Could not locate target element in ${path.basename(filePathAbs)} (no match).` };
  }

  // We need to find the JSXElement that owns this opening element for text edits.
  let ownerEl: t.JSXElement | null = null;

  traverse(ast, {
    JSXElement(p) {
      if (p.node.openingElement === match!.opening) {
        ownerEl = p.node;
        p.stop();
      }
    },
  });

  if (!ownerEl) {
    return { ok: false, error: "Internal error: matched opening element has no owner JSXElement." };
  }

  // Ensure stable id is present if provided.
  if (vbId) ensureVbId(match.opening, vbId);

  let changed = false;

  if (edit.kind === "text") {
    changed = updateTextInElement(ownerEl, edit.newText);
  } else if (edit.kind === "className") {
    const attr = getAttr(match.opening, "className");
    const current = getStringAttrValue(attr) ?? "";
    const next = applyTailwindPatch(current, edit.patch);
    if (next !== current) {
      setStringAttrValue(match.opening, "className", next);
      changed = true;
    }
  } else if (edit.kind === "insert") {
    // Future extension: not implemented in this patch.
    return { ok: false, error: "Insert edit not implemented yet." };
  }

  const after = generate(ast as any, { jsescOption: { minimal: true } }).code;

  return { ok: true, before, after, changed, matchedBy: match.matchedBy };
}
