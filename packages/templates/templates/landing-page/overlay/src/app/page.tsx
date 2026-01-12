export default function Page() {
  return (
    <div className="min-h-screen bg-zinc-50 text-zinc-900">
      <header className="sticky top-0 z-10 border-b bg-white/80 backdrop-blur">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-6 py-3">
          <div className="text-sm font-semibold tracking-tight">Acme</div>
          <nav className="hidden gap-6 text-sm text-zinc-600 md:flex">
            <a className="hover:text-zinc-900" href="#features">
              Features
            </a>
            <a className="hover:text-zinc-900" href="#pricing">
              Pricing
            </a>
            <a className="hover:text-zinc-900" href="#faq">
              FAQ
            </a>
          </nav>
          <div className="flex gap-2">
            <a className="rounded border px-3 py-1.5 text-sm hover:bg-zinc-50" href="#pricing">
              View pricing
            </a>
            <a className="rounded bg-black px-3 py-1.5 text-sm text-white hover:bg-zinc-800" href="#cta">
              Get started
            </a>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-6xl px-6 py-14">
        <section className="grid gap-10 md:grid-cols-2 md:items-center">
          <div>
            <div className="inline-flex items-center rounded-full border bg-white px-3 py-1 text-xs text-zinc-700">
              New • Ship beautiful pages faster
            </div>
            <h1 className="mt-4 text-4xl font-semibold leading-tight tracking-tight md:text-5xl">
              A clean landing page template for your next product.
            </h1>
            <p className="mt-4 text-lg leading-8 text-zinc-600">
              This is a starter design. You can ask the AI to change layout, add sections, or match a brand style.
            </p>
            <div className="mt-6 flex flex-col gap-3 sm:flex-row">
              <a className="rounded bg-black px-4 py-2 text-center text-sm text-white hover:bg-zinc-800" href="#cta">
                Start building
              </a>
              <a className="rounded border px-4 py-2 text-center text-sm hover:bg-zinc-50" href="#features">
                See features
              </a>
            </div>
            <p className="mt-3 text-xs text-zinc-500">
              Tip: In the desktop app, describe what you want to build in Chat.
            </p>
          </div>

          <div className="rounded-2xl border bg-white p-6 shadow-sm">
            <div className="rounded-xl bg-zinc-100 p-6">
              <div className="text-sm font-semibold">Preview card</div>
              <p className="mt-2 text-sm text-zinc-600">
                Replace this with product screenshots, a video, or a feature animation.
              </p>
              <div className="mt-4 grid grid-cols-3 gap-3">
                <div className="h-16 rounded-lg bg-white" />
                <div className="h-16 rounded-lg bg-white" />
                <div className="h-16 rounded-lg bg-white" />
              </div>
            </div>
          </div>
        </section>

        <section id="features" className="mt-16">
          <h2 className="text-2xl font-semibold tracking-tight">Features</h2>
          <p className="mt-2 max-w-2xl text-sm text-zinc-600">
            A simple, readable layout that’s easy to extend.
          </p>

          <div className="mt-6 grid gap-4 md:grid-cols-3">
            {[
              { title: 'Fast start', body: 'Begin from a working Next.js scaffold.' },
              { title: 'Template overlays', body: 'Apply a style baseline in one click.' },
              { title: 'AI-ready', body: 'Chat UI is wired for future model integration.' }
            ].map((f) => (
              <div key={f.title} className="rounded-xl border bg-white p-5">
                <div className="text-sm font-semibold">{f.title}</div>
                <div className="mt-2 text-sm text-zinc-600">{f.body}</div>
              </div>
            ))}
          </div>
        </section>

        <section id="pricing" className="mt-16">
          <h2 className="text-2xl font-semibold tracking-tight">Pricing</h2>
          <div className="mt-6 grid gap-4 md:grid-cols-3">
            {[
              { tier: 'Starter', price: '$0', perks: ['Basic layout', 'Template support', 'Local projects'] },
              { tier: 'Pro', price: '$19', perks: ['More templates', 'AI integration', 'Preview mode'] },
              { tier: 'Team', price: '$49', perks: ['Shared workflows', 'Git integration', 'Deploy tools'] }
            ].map((p) => (
              <div key={p.tier} className="rounded-xl border bg-white p-5">
                <div className="text-sm font-semibold">{p.tier}</div>
                <div className="mt-2 text-3xl font-semibold">{p.price}</div>
                <ul className="mt-4 list-disc space-y-1 pl-5 text-sm text-zinc-600">
                  {p.perks.map((x) => (
                    <li key={x}>{x}</li>
                  ))}
                </ul>
                <button className="mt-5 w-full rounded bg-black px-4 py-2 text-sm text-white hover:bg-zinc-800">
                  Choose {p.tier}
                </button>
              </div>
            ))}
          </div>
        </section>

        <section id="faq" className="mt-16">
          <h2 className="text-2xl font-semibold tracking-tight">FAQ</h2>
          <div className="mt-6 grid gap-3 md:grid-cols-2">
            {[
              {
                q: 'Is this the final design?',
                a: 'No—this is a starting point. Use chat to add sections, components, and styling.'
              },
              { q: 'Can I start from scratch?', a: 'Yes. Select “Start from scratch” in the template picker.' },
              { q: 'Do I need Git?', a: 'Not for Milestone 1. It’s optional.' },
              { q: 'Where is the live preview?', a: 'Planned for later milestones.' }
            ].map((i) => (
              <div key={i.q} className="rounded-xl border bg-white p-5">
                <div className="text-sm font-semibold">{i.q}</div>
                <div className="mt-2 text-sm text-zinc-600">{i.a}</div>
              </div>
            ))}
          </div>
        </section>

        <section id="cta" className="mt-16 rounded-2xl border bg-white p-8">
          <div className="text-2xl font-semibold tracking-tight">Ready to build?</div>
          <div className="mt-2 text-sm text-zinc-600">
            Open the desktop app and tell the AI what you want: pages, components, and layout changes.
          </div>
          <div className="mt-5 flex gap-2">
            <button className="rounded bg-black px-4 py-2 text-sm text-white hover:bg-zinc-800">
              Start building
            </button>
            <button className="rounded border px-4 py-2 text-sm hover:bg-zinc-50">Contact sales</button>
          </div>
        </section>
      </main>

      <footer className="border-t bg-white">
        <div className="mx-auto max-w-6xl px-6 py-6 text-xs text-zinc-500">
          © {new Date().getFullYear()} Acme. Built with Next.js + Tailwind.
        </div>
      </footer>
    </div>
  )
}
