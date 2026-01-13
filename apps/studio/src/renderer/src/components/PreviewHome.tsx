import React from 'react';

export type PreviewHomeItem = {
  route: string;
  label?: string;
  description?: string;
};

export type PreviewHomeProps = {
  title?: string;
  subtitle?: string;
  items: PreviewHomeItem[];
  onOpen: (route: string) => void;
};

function defaultLabel(route: string): string {
  if (route === '/' || route === '') return 'Home';
  const clean = route.replace(/^\/+/, '');
  if (!clean) return 'Home';
  return clean
    .split('/')
    .filter(Boolean)
    .map((seg) =>
      seg
        .replace(/\[(\.\.\.)?(.+?)\]/g, '$2')
        .replace(/[-_]/g, ' ')
        .replace(/^./, (c) => c.toUpperCase())
    )
    .join(' / ');
}

export function PreviewHome(props: PreviewHomeProps) {
  const { title = 'Pages', subtitle, items, onOpen } = props;

  return (
    <div className="h-full w-full overflow-auto bg-zinc-50">
      <div className="mx-auto w-full max-w-5xl px-6 py-6">
        <div className="mb-4">
          <div className="text-lg font-semibold text-zinc-900">{title}</div>
          {subtitle ? <div className="text-sm text-zinc-600">{subtitle}</div> : null}
        </div>

        {items.length === 0 ? (
          <div className="rounded-lg border border-dashed border-zinc-200 bg-white p-6 text-sm text-zinc-600">
            No pages were detected. If this project uses Next.js, make sure you have an <code>app/</code> or{' '}
            <code>pages/</code> directory. If it uses React Router, you can still type a path in the address bar.
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2 lg:grid-cols-3">
            {items.map((it) => {
              const label = it.label ?? defaultLabel(it.route);
              return (
                <button
                  key={it.route}
                  type="button"
                  onClick={() => onOpen(it.route)}
                  className="group rounded-lg border border-zinc-200 bg-white p-4 text-left shadow-sm transition hover:border-zinc-300 hover:bg-zinc-50"
                >
                  <div className="flex items-center justify-between gap-3">
                    <div className="min-w-0">
                      <div className="truncate text-sm font-semibold text-zinc-900">{label}</div>
                      <div className="truncate text-xs text-zinc-500">{it.route}</div>
                    </div>
                    <div className="text-xs text-zinc-400 group-hover:text-zinc-600">Open →</div>
                  </div>
                  {it.description ? (
                    <div className="mt-2 line-clamp-2 text-xs text-zinc-600">{it.description}</div>
                  ) : null}
                </button>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
