import React, { useEffect, useMemo, useState } from 'react';
import { PreviewHome, type PreviewHomeItem } from './PreviewHome';

export type PreviewBrowserProps = {
  /** When true, show the "Pages" home listing instead of the iframe */
  isHome: boolean;

  /** Full iframe src (including origin). Required when isHome=false */
  iframeSrc?: string | null;

  /** Force iframe reload by changing the key */
  iframeKey?: number | string;

  /** Current pathname (e.g. "/", "/about") */
  address: string;

  /** Routes used for the home listing */
  routes?: string[];

  /** Browser navigation state */
  canBack: boolean;
  canForward: boolean;

  /** Browser actions */
  onHome: () => void;
  onBack: () => void;
  onForward: () => void;
  onNavigate: (route: string) => void;
  onReload: () => void;

  /** Optional right-side controls from the host app (Restart, Inspect, Stop, etc.) */
  rightActions?: React.ReactNode;

  /** Optional home listing content */
  homeTitle?: string;
  homeSubtitle?: string;
};

function normalizeRoute(input: string): string {
  const trimmed = input.trim();
  if (!trimmed) return '/';

  // Allow pasting a full URL (we'll extract just the pathname + search + hash).
  if (/^https?:\/\//i.test(trimmed)) {
    try {
      const url = new URL(trimmed);
      return `${url.pathname || '/'}${url.search || ''}${url.hash || ''}`;
    } catch {
      // Fall through
    }
  }

  // If user enters something like "about", normalize to "/about".
  if (!trimmed.startsWith('/')) return `/${trimmed}`;
  return trimmed;
}

export function PreviewBrowser(props: PreviewBrowserProps) {
  const {
    isHome,
    iframeSrc,
    iframeKey,
    address,
    routes = [],
    canBack,
    canForward,
    onHome,
    onBack,
    onForward,
    onNavigate,
    onReload,
    rightActions,
    homeTitle,
    homeSubtitle,
  } = props;

  const [input, setInput] = useState(isHome ? '' : address);

  useEffect(() => {
    setInput(isHome ? '' : address);
  }, [isHome, address]);

  const homeItems: PreviewHomeItem[] = useMemo(() => {
    const unique = Array.from(new Set(routes));
    unique.sort((a, b) => {
      if (a === '/') return -1;
      if (b === '/') return 1;
      return a.localeCompare(b);
    });
    return unique.map((route) => ({ route }));
  }, [routes]);

  return (
    <div className="flex h-full w-full flex-col overflow-hidden">
      {/* Top "browser" bar */}
      <div className="flex items-center gap-2 border-b border-zinc-200 bg-white px-2 py-2">
        <button
          type="button"
          className="rounded border border-zinc-200 bg-white px-2 py-1 text-xs hover:bg-zinc-50 disabled:opacity-50"
          onClick={onHome}
          title="Home"
          disabled={routes.length < 2}
        >
          Home
        </button>
        <button
          type="button"
          className="rounded border border-zinc-200 bg-white px-2 py-1 text-xs hover:bg-zinc-50 disabled:opacity-50"
          onClick={onBack}
          title="Back"
          disabled={!canBack}
        >
          Back
        </button>
        <button
          type="button"
          className="rounded border border-zinc-200 bg-white px-2 py-1 text-xs hover:bg-zinc-50 disabled:opacity-50"
          onClick={onForward}
          title="Forward"
          disabled={!canForward}
        >
          Forward
        </button>

        <input
          value={isHome ? '' : input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault();
              const route = normalizeRoute(input);
              onNavigate(route);
            }
          }}
          className="ml-1 w-full min-w-[220px] max-w-[720px] flex-1 rounded border border-zinc-200 bg-white px-2 py-1 text-xs"
          placeholder={isHome ? 'Home' : '/'}
          disabled={isHome}
        />

        <button
          type="button"
          className="rounded border border-zinc-200 bg-white px-2 py-1 text-xs hover:bg-zinc-50 disabled:opacity-50"
          onClick={onReload}
          title="Reload"
          disabled={!iframeSrc && !isHome}
        >
          Reload
        </button>

        {rightActions ? <div className="ml-auto flex items-center gap-2">{rightActions}</div> : null}
      </div>

      {/* Content */}
      <div className="min-h-0 flex-1 overflow-hidden">
        {isHome ? (
          <PreviewHome
            title={homeTitle}
            subtitle={homeSubtitle}
            items={homeItems}
            onOpen={(route) => onNavigate(route)}
          />
        ) : iframeSrc ? (
          <iframe
            key={String(iframeKey ?? 0)}
            src={iframeSrc}
            className="h-full w-full bg-white"
            sandbox="allow-same-origin allow-scripts allow-forms allow-popups allow-modals allow-downloads"
          />
        ) : (
          <div className="flex h-full w-full items-center justify-center bg-zinc-50 p-6 text-sm text-zinc-600">
            Preview is not running.
          </div>
        )}
      </div>

      {/* Tiny footer with current address */}
      <div className="border-t border-zinc-200 bg-white px-3 py-1 text-[11px] text-zinc-500">
        {isHome ? 'Home' : address}
      </div>
    </div>
  );
}
