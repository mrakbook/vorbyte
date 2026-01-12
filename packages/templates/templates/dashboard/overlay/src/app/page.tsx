export default function Page() {
  return (
    <div className="min-h-screen bg-zinc-50 text-zinc-900">
      <div className="flex min-h-screen">
        <aside className="hidden w-64 border-r bg-white p-4 md:block">
          <div className="text-sm font-semibold tracking-tight">Acme Dashboard</div>
          <nav className="mt-6 space-y-1 text-sm">
            <a className="block rounded bg-zinc-100 px-3 py-2 text-zinc-900" href="#">
              Overview
            </a>
            <a className="block rounded px-3 py-2 text-zinc-600 hover:bg-zinc-50 hover:text-zinc-900" href="#">
              Projects
            </a>
            <a className="block rounded px-3 py-2 text-zinc-600 hover:bg-zinc-50 hover:text-zinc-900" href="#">
              Team
            </a>
            <a className="block rounded px-3 py-2 text-zinc-600 hover:bg-zinc-50 hover:text-zinc-900" href="#">
              Settings
            </a>
          </nav>
        </aside>

        <div className="flex-1">
          <header className="sticky top-0 z-10 border-b bg-white/80 backdrop-blur">
            <div className="mx-auto flex max-w-6xl items-center justify-between px-6 py-3">
              <div className="flex items-center gap-2">
                <div className="md:hidden rounded border px-2 py-1 text-xs text-zinc-700">Menu</div>
                <div className="text-sm font-semibold tracking-tight">Overview</div>
              </div>
              <div className="flex items-center gap-2">
                <input
                  className="hidden w-64 rounded border bg-white px-3 py-1.5 text-sm outline-none focus:ring-2 focus:ring-zinc-400 md:block"
                  placeholder="Search…"
                />
                <div className="h-8 w-8 rounded-full bg-zinc-200" aria-label="Avatar" />
              </div>
            </div>
          </header>

          <main className="mx-auto max-w-6xl px-6 py-8">
            <div className="grid gap-4 md:grid-cols-3">
              <div className="rounded border bg-white p-4">
                <div className="text-xs font-medium text-zinc-500">Active users</div>
                <div className="mt-2 text-2xl font-semibold">1,284</div>
                <div className="mt-1 text-sm text-zinc-600">+12% from last week</div>
              </div>

              <div className="rounded border bg-white p-4">
                <div className="text-xs font-medium text-zinc-500">Revenue</div>
                <div className="mt-2 text-2xl font-semibold">$32,410</div>
                <div className="mt-1 text-sm text-zinc-600">+8% from last month</div>
              </div>

              <div className="rounded border bg-white p-4">
                <div className="text-xs font-medium text-zinc-500">Errors</div>
                <div className="mt-2 text-2xl font-semibold">23</div>
                <div className="mt-1 text-sm text-zinc-600">Down from 41</div>
              </div>
            </div>

            <section className="mt-8 rounded border bg-white">
              <div className="flex items-center justify-between border-b px-4 py-3">
                <h2 className="text-sm font-semibold">Recent activity</h2>
                <button className="rounded bg-black px-3 py-1.5 text-sm text-white hover:bg-zinc-800">New report</button>
              </div>

              <div className="divide-y">
                {[
                  ["Project created", "Marketing Site", "2 hours ago"],
                  ["Deployment", "Dashboard App", "Yesterday"],
                  ["Invite sent", "sarah@acme.com", "2 days ago"]
                ].map(([event, detail, when]) => (
                  <div key={`${event}-${detail}`} className="flex items-center justify-between px-4 py-3 text-sm">
                    <div>
                      <div className="font-medium">{event}</div>
                      <div className="text-zinc-600">{detail}</div>
                    </div>
                    <div className="text-zinc-500">{when}</div>
                  </div>
                ))}
              </div>
            </section>
          </main>
        </div>
      </div>
    </div>
  )
}
