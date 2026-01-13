/**
 * Route detection helpers used for the "v0-style" preview browser.
 *
 * These are intentionally heuristic-based because VorByte can preview many different
 * project types (Next app router, Next pages router, Vite pages conventions, etc.).
 */

export type RouteGuess = {
  route: string;
  kind: 'next-app' | 'next-pages' | 'vite-pages' | 'unknown';
  sourcePath: string;
};

const EXT_RE = /\.(tsx|ts|jsx|js|mdx)$/i;

function normalizePath(p: string): string {
  return p.replace(/\\/g, '/');
}

function stripExt(p: string): string {
  return p.replace(EXT_RE, '');
}

function isPageExt(p: string): boolean {
  return EXT_RE.test(p);
}

function joinRoute(segments: string[]): string {
  const cleaned = segments.filter(Boolean);
  if (cleaned.length === 0) return '/';
  return `/${cleaned.join('/')}`;
}

function sanitizeNextAppSegment(seg: string): string | null {
  // Next.js "route groups" and parallel segments shouldn't affect the URL.
  if (!seg) return null;
  if (seg.startsWith('(') && seg.endsWith(')')) return null;
  if (seg.startsWith('@')) return null;

  // Ignore private folders used by some setups.
  if (seg.startsWith('_')) return null;

  return seg;
}

function guessNextAppRoute(filePath: string): RouteGuess | null {
  const p = normalizePath(filePath);
  if (!p.includes('/app/')) return null;
  if (!isPageExt(p)) return null;
  if (!/\/page\.(tsx|ts|jsx|js|mdx)$/i.test(p)) return null;

  // Split on `/app/` then drop the trailing `/page`.
  const afterApp = p.split('/app/')[1];
  if (!afterApp) return null;

  const withoutPage = afterApp.replace(/\/page\.(tsx|ts|jsx|js|mdx)$/i, '');
  const segments = withoutPage
    .split('/')
    .map((s) => s.trim())
    .map(sanitizeNextAppSegment)
    .filter((s): s is string => !!s);

  return {
    route: joinRoute(segments),
    kind: 'next-app',
    sourcePath: filePath,
  };
}

function guessNextPagesRoute(filePath: string): RouteGuess | null {
  const p = normalizePath(filePath);
  if (!p.includes('/pages/')) return null;
  if (!isPageExt(p)) return null;

  // Ignore Next internal pages and API routes
  const rel = p.split('/pages/')[1];
  if (!rel) return null;
  if (rel.startsWith('api/')) return null;

  const noExt = stripExt(rel);

  // Ignore special Next pages
  const base = noExt.split('/').pop() || '';
  if (['__app', '_app', '_document', '_error', '404', '500'].includes(base)) {
    return null;
  }

  // Normalize "index" routes
  const normalized = noExt.replace(/(^|\/)index$/i, '$1');
  const segments = normalized
    .split('/')
    .map((s) => s.trim())
    .filter(Boolean);

  return {
    route: joinRoute(segments),
    kind: 'next-pages',
    sourcePath: filePath,
  };
}

function guessVitePagesRoute(filePath: string): RouteGuess | null {
  const p = normalizePath(filePath);
  if (!p.includes('/src/pages/')) return null;
  if (!isPageExt(p)) return null;

  const rel = p.split('/src/pages/')[1];
  if (!rel) return null;

  const noExt = stripExt(rel);
  const normalized = noExt.replace(/(^|\/)index$/i, '$1');
  const segments = normalized
    .split('/')
    .map((s) => s.trim())
    .filter(Boolean);

  return {
    route: joinRoute(segments),
    kind: 'vite-pages',
    sourcePath: filePath,
  };
}

/**
 * Best-effort conversion from a file path to a previewable route.
 */
export function guessRouteFromFilePath(filePath: string): string | null {
  const nextApp = guessNextAppRoute(filePath);
  if (nextApp) return nextApp.route;

  const nextPages = guessNextPagesRoute(filePath);
  if (nextPages) return nextPages.route;

  const vitePages = guessVitePagesRoute(filePath);
  if (vitePages) return vitePages.route;

  return null;
}

/**
 * Convert a list of file paths to a unique, sorted route list.
 */
export function collectRoutesFromFilePaths(filePaths: string[]): string[] {
  const routes: string[] = [];
  for (const p of filePaths) {
    const r = guessRouteFromFilePath(p);
    if (r) routes.push(r);
  }

  const unique = Array.from(new Set(routes));
  unique.sort((a, b) => {
    if (a === '/') return -1;
    if (b === '/') return 1;
    return a.localeCompare(b);
  });

  return unique;
}
