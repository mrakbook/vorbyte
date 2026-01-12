import React, { useEffect, useMemo, useRef, useState } from 'react'
import type {
  AppSettings,
  ChatMessage,
  CreateProjectRequest,
  FileTreeNode,
  ProjectSummary,
  TemplateSummary
} from '@shared/types'

const APP_TITLE = 'VorByte Studio'

function uid() {
  return Math.random().toString(16).slice(2) + Date.now().toString(16)
}

function clampText(s: string, max: number) {
  const trimmed = s.trim()
  return trimmed.length <= max ? trimmed : trimmed.slice(0, max - 1) + '…'
}

function Pill(props: { children: React.ReactNode }) {
  return (
    <span className="inline-flex items-center rounded-full border border-zinc-200 bg-white px-2 py-0.5 text-[11px] text-zinc-700">
      {props.children}
    </span>
  )
}

function Modal(props: {
  open: boolean
  title: string
  children: React.ReactNode
  onClose: () => void
  widthClassName?: string
}) {
  if (!props.open) return null
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className={`w-full rounded-lg bg-white shadow-lg ${props.widthClassName ?? 'max-w-xl'}`}>
        <div className="flex items-center justify-between border-b px-4 py-3">
          <div className="text-sm font-semibold">{props.title}</div>
          <button className="rounded border px-2 py-1 text-xs hover:bg-zinc-50" onClick={props.onClose}>
            Close
          </button>
        </div>
        <div className="p-4">{props.children}</div>
      </div>
    </div>
  )
}

function TreeView(props: { root: FileTreeNode | null; onOpenFile?: (path: string) => void }) {
  if (!props.root) {
    return <div className="text-xs text-zinc-600">No project loaded.</div>
  }

  function NodeView({ node, depth }: { node: FileTreeNode; depth: number }) {
    const pad = depth * 10
    if (node.type === 'dir') {
      return (
        <div>
          <div className="truncate text-xs text-zinc-700" style={{ paddingLeft: pad }}>
            📁 {node.name}
          </div>
          <div className="space-y-0.5">
            {(node.children ?? []).map((c) => (
              <NodeView key={c.path} node={c} depth={depth + 1} />
            ))}
          </div>
        </div>
      )
    }

    return (
      <button
        className="block w-full truncate text-left text-xs text-zinc-700 hover:bg-zinc-50"
        style={{ paddingLeft: pad }}
        onClick={() => props.onOpenFile?.(node.path)}
        title={node.path}
      >
        📄 {node.name}
      </button>
    )
  }

  return (
    <div className="space-y-0.5">
      <NodeView node={props.root} depth={0} />
    </div>
  )
}

function SettingsModal(props: {
  open: boolean
  onClose: () => void
  initial: AppSettings
  onSaved: (next: AppSettings) => void
}) {
  const [draft, setDraft] = useState<AppSettings>(props.initial)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (props.open) {
      setDraft(props.initial)
      setSaving(false)
      setError(null)
    }
  }, [props.open, props.initial])

  async function save() {
    setSaving(true)
    setError(null)
    try {
      const saved = await window.api.settings.save(draft)
      props.onSaved(saved)
      props.onClose()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setSaving(false)
    }
  }

  return (
    <Modal open={props.open} title="Settings" onClose={props.onClose} widthClassName="max-w-2xl">
      <div className="space-y-4">
        {error && <div className="rounded border border-red-200 bg-red-50 p-3 text-sm text-red-800">{error}</div>}

        <div className="space-y-2">
          <div className="text-sm font-semibold">Projects folder</div>
          <input
            className="w-full rounded border px-3 py-2 text-sm"
            value={draft.projectsRoot}
            onChange={(e) => setDraft((d) => ({ ...d, projectsRoot: e.target.value }))}
            placeholder="e.g., /Users/you/VorByteProjects"
          />
          <div className="text-xs text-zinc-600">
            Where VorByte stores generated projects on your machine.
          </div>
        </div>

        <div className="space-y-2">
          <div className="text-sm font-semibold">OpenAI API key</div>
          <input
            className="w-full rounded border px-3 py-2 text-sm"
            value={draft.openAiApiKey ?? ''}
            onChange={(e) => setDraft((d) => ({ ...d, openAiApiKey: e.target.value }))}
            placeholder="sk-..."
          />
          <div className="text-xs text-zinc-600">
            Only needed if you want to use cloud models. Leave blank for local-only use.
          </div>
        </div>

        <div className="space-y-2">
          <div className="text-sm font-semibold">Local model endpoint</div>
          <input
            className="w-full rounded border px-3 py-2 text-sm"
            value={draft.localModelEndpoint ?? ''}
            onChange={(e) => setDraft((d) => ({ ...d, localModelEndpoint: e.target.value }))}
            placeholder="http://localhost:11434"
          />
          <div className="text-xs text-zinc-600">Ollama default is http://localhost:11434</div>
        </div>

        <div className="flex justify-end gap-2 pt-2">
          <button className="rounded border px-4 py-2 text-sm hover:bg-zinc-50" onClick={props.onClose}>
            Cancel
          </button>
          <button
            className="rounded bg-black px-4 py-2 text-sm text-white hover:bg-zinc-800 disabled:opacity-50"
            onClick={save}
            disabled={saving}
          >
            {saving ? 'Saving…' : 'Save Settings'}
          </button>
        </div>
      </div>
    </Modal>
  )
}

function NewProjectModal(props: {
  open: boolean
  onClose: () => void
  templates: TemplateSummary[]
  onCreate: (req: CreateProjectRequest) => Promise<void>
  settingsOpen: () => void
}) {
  const [step, setStep] = useState(0)
  const [name, setName] = useState('')
  const [templateId, setTemplateId] = useState<'scratch' | string>('scratch')
  const [aiMode, setAiMode] = useState<'local' | 'cloud'>('cloud')
  const [cloudModel, setCloudModel] = useState('gpt-4')
  const [localModel, setLocalModel] = useState('ollama:llama3.1')
  const [enableImageGeneration, setEnableImageGeneration] = useState(false)
  const [initGit, setInitGit] = useState(false)
  const [creating, setCreating] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const allTemplates = useMemo(() => {
    return [{ id: 'scratch', name: 'Start from scratch', description: 'Base Next.js scaffold', tags: [] as string[] }].concat(
      props.templates.map((t) => ({ id: t.id, name: t.name, description: t.description, tags: t.tags }))
    )
  }, [props.templates])

  useEffect(() => {
    if (props.open) {
      setStep(0)
      setName('')
      setTemplateId('scratch')
      setAiMode('cloud')
      setCloudModel('gpt-4')
      setLocalModel('ollama:llama3.1')
      setEnableImageGeneration(false)
      setInitGit(false)
      setCreating(false)
      setError(null)
    }
  }, [props.open])

  async function next() {
    setError(null)
    if (step === 0 && !name.trim()) {
      setError('Please enter a project name.')
      return
    }
    setStep((s) => Math.min(3, s + 1))
  }

  function back() {
    setError(null)
    setStep((s) => Math.max(0, s - 1))
  }

  async function create() {
    setCreating(true)
    setError(null)
    try {
      const req: CreateProjectRequest = {
        name: name.trim(),
        templateId,
        aiMode,
        cloudModel: aiMode === 'cloud' ? cloudModel : undefined,
        localModel: aiMode === 'local' ? localModel : undefined,
        enableImageGeneration,
        initGit
      }
      await props.onCreate(req)
      props.onClose()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setCreating(false)
    }
  }

  return (
    <Modal open={props.open} title="New Project" onClose={props.onClose} widthClassName="max-w-3xl">
      <div className="space-y-4">
        <div className="flex items-center justify-between text-sm">
          <div className="text-zinc-700">
            Step <span className="font-semibold">{step + 1}</span> / 4
          </div>
          <div className="flex gap-2">
            <Pill>Simple mode</Pill>
            <Pill>Milestone 1</Pill>
          </div>
        </div>

        {error && <div className="rounded border border-red-200 bg-red-50 p-3 text-sm text-red-800">{error}</div>}

        {step === 0 && (
          <div className="space-y-2">
            <div className="text-sm font-semibold">Project name</div>
            <input
              className="w-full rounded border px-3 py-2 text-sm"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g., My SaaS Landing Page"
            />
            <div className="text-xs text-zinc-600">Used for display and the folder name.</div>
          </div>
        )}

        {step === 1 && (
          <div className="space-y-3">
            <div className="text-sm font-semibold">Choose a template</div>
            <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
              {allTemplates.map((t) => (
                <button
                  key={t.id}
                  className={`rounded border p-3 text-left hover:bg-zinc-50 ${
                    templateId === t.id ? 'border-black' : 'border-zinc-200'
                  }`}
                  onClick={() => setTemplateId(t.id)}
                >
                  <div className="text-sm font-semibold">{t.name}</div>
                  <div className="mt-1 text-xs text-zinc-600">{t.description}</div>
                  <div className="mt-2 flex flex-wrap gap-2">
                    {t.tags.map((tag) => (
                      <Pill key={tag}>{tag}</Pill>
                    ))}
                  </div>
                </button>
              ))}
            </div>
            <div className="text-xs text-zinc-600">
              Thumbnails can be added later; Milestone 1 can use simple cards like this.
            </div>
          </div>
        )}

        {step === 2 && (
          <div className="space-y-3">
            <div className="text-sm font-semibold">AI mode</div>

            <div className="flex gap-2">
              <button
                className={`rounded border px-3 py-2 text-sm ${aiMode === 'cloud' ? 'border-black' : 'border-zinc-200'}`}
                onClick={() => setAiMode('cloud')}
                title="Use cloud models like GPT-4 (requires API key)"
              >
                Cloud
              </button>
              <button
                className={`rounded border px-3 py-2 text-sm ${aiMode === 'local' ? 'border-black' : 'border-zinc-200'}`}
                onClick={() => setAiMode('local')}
                title="Use a local model (configured later)"
              >
                Local
              </button>
              <button
                className="ml-auto rounded border px-3 py-2 text-sm hover:bg-zinc-50"
                onClick={props.settingsOpen}
                title="Open Settings (API keys, model paths, etc.)"
              >
                Settings…
              </button>
            </div>

            {aiMode === 'cloud' ? (
              <div className="space-y-2">
                <div className="text-xs font-semibold text-zinc-700">Cloud model</div>
                <select
                  className="w-full rounded border px-3 py-2 text-sm"
                  value={cloudModel}
                  onChange={(e) => setCloudModel(e.target.value)}
                >
                  <option value="gpt-4">GPT-4</option>
                  <option value="gpt-4o">GPT-4o</option>
                </select>
              </div>
            ) : (
              <div className="space-y-2">
                <div className="text-xs font-semibold text-zinc-700">Local model</div>
                <input
                  className="w-full rounded border px-3 py-2 text-sm"
                  value={localModel}
                  onChange={(e) => setLocalModel(e.target.value)}
                  placeholder="ollama:llama3.1"
                />
              </div>
            )}
          </div>
        )}

        {step === 3 && (
          <div className="space-y-3">
            <div className="text-sm font-semibold">Options</div>

            <label className="flex items-start gap-3 rounded border p-3">
              <input
                type="checkbox"
                checked={enableImageGeneration}
                onChange={(e) => setEnableImageGeneration(e.target.checked)}
              />
              <div>
                <div className="text-sm font-semibold">Use AI image generation for design mockups</div>
                <div className="text-xs text-zinc-600">UI only for now; integration can be added later.</div>
              </div>
            </label>

            <label className="flex items-start gap-3 rounded border p-3">
              <input type="checkbox" checked={initGit} onChange={(e) => setInitGit(e.target.checked)} />
              <div>
                <div className="text-sm font-semibold">Initialize a Git repository</div>
                <div className="text-xs text-zinc-600">
                  This runs <code className="rounded bg-zinc-100 px-1 py-0.5">git init</code> in the project folder.
                </div>
              </div>
            </label>
          </div>
        )}

        <div className="flex justify-between pt-2">
          <button className="rounded border px-4 py-2 text-sm hover:bg-zinc-50" onClick={back} disabled={step === 0}>
            Back
          </button>

          {step < 3 ? (
            <button className="rounded bg-black px-4 py-2 text-sm text-white hover:bg-zinc-800" onClick={next}>
              Next
            </button>
          ) : (
            <button
              className="rounded bg-black px-4 py-2 text-sm text-white hover:bg-zinc-800 disabled:opacity-50"
              onClick={create}
              disabled={creating}
            >
              {creating ? 'Creating…' : 'Create Project'}
            </button>
          )}
        </div>
      </div>
    </Modal>
  )
}

export default function App() {
  const [settings, setSettings] = useState<AppSettings | null>(null)
  const [projects, setProjects] = useState<ProjectSummary[]>([])
  const [templates, setTemplates] = useState<TemplateSummary[]>([])
  const [activeProject, setActiveProject] = useState<ProjectSummary | null>(null)
  const [tree, setTree] = useState<FileTreeNode | null>(null)

  const [mode, setMode] = useState<'chat' | 'design'>('chat')
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [draft, setDraft] = useState('')

  const [newProjectOpen, setNewProjectOpen] = useState(false)
  const [settingsOpen, setSettingsOpen] = useState(false)

  const [busy, setBusy] = useState(false)
  const [aiBusy, setAiBusy] = useState(false)
  const [aiRequestId, setAiRequestId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const chatEndRef = useRef<HTMLDivElement | null>(null)

  type AsyncResult<T> = { ok: true; value: T } | { ok: false; error: unknown }

  async function wrap<T>(p: Promise<T>): Promise<AsyncResult<T>> {
    try {
      const value = await p
      return { ok: true, value }
    } catch (error) {
      return { ok: false, error }
    }
  }

  async function refreshProjectsOnly(): Promise<ProjectSummary[]> {
    const pRes = await wrap(window.api.projects.list())
    if (pRes.ok) {
      setProjects(pRes.value)
      return pRes.value
    }
    setError(pRes.error instanceof Error ? pRes.error.message : String(pRes.error))
    return []
  }

  async function refreshAll(): Promise<ProjectSummary[]> {
    setBusy(true)
    setError(null)
    try {
      const [sRes, tRes, pRes] = await Promise.all([
        wrap(window.api.settings.get()),
        wrap(window.api.templates.list()),
        wrap(window.api.projects.list())
      ])

      const errors: string[] = []

      if (sRes.ok) setSettings(sRes.value)
      else errors.push(sRes.error instanceof Error ? sRes.error.message : String(sRes.error))

      if (tRes.ok) setTemplates(tRes.value)
      else errors.push(tRes.error instanceof Error ? tRes.error.message : String(tRes.error))

      if (pRes.ok) {
        setProjects(pRes.value)
      } else {
        errors.push(pRes.error instanceof Error ? pRes.error.message : String(pRes.error))
      }

      if (errors.length > 0) setError(errors.join('\n'))

      return pRes.ok ? pRes.value : []
    } finally {
      setBusy(false)
    }
  }

  useEffect(() => {
    let disposed = false

    const boot = async () => {
      // In some dev/HMR situations the preload bridge can be a tick late.
      // A tiny retry makes the project list reliably appear on cold starts.
      for (let i = 0; i < 20; i++) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        if ((window as any).api) break
        await new Promise((r) => setTimeout(r, 50))
      }
      if (disposed) return

      const p = await refreshAll()
      if (disposed) return

      // If IPC was temporarily unavailable, do one quick retry.
      if (p.length === 0) {
        setTimeout(() => {
          if (!disposed) void refreshProjectsOnly()
        }, 500)
      }
    }

    void boot()

    const onFocus = () => {
      void refreshProjectsOnly()
    }

    const onVisibility = () => {
      if (!document.hidden) void refreshProjectsOnly()
    }

    window.addEventListener('focus', onFocus)
    document.addEventListener('visibilitychange', onVisibility)

    return () => {
      disposed = true
      window.removeEventListener('focus', onFocus)
      document.removeEventListener('visibilitychange', onVisibility)
    }
  }, [])

  useEffect(() => {
    if (!activeProject) return
    ;(async () => {
      try {
        const nextTree = await window.api.fs.tree(activeProject.path, { maxDepth: 6 })
        setTree(nextTree)
      } catch {
        setTree(null)
      }
    })()
  }, [activeProject])

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages.length])

  async function openProject(p: ProjectSummary) {
    setActiveProject(p)
    setMode('chat')
    setDraft('')
    setError(null)
    try {
      const chat = await window.api.chat.load(p.path)
      setMessages(chat)
    } catch {
      setMessages([])
    }
  }

  async function cancelAi() {
    if (!aiRequestId) return
    try {
      await window.api.ai.cancel(aiRequestId)
    } finally {
      setAiRequestId(null)
      setAiBusy(false)
    }
  }

  async function createProject(req: CreateProjectRequest) {
    const created = await window.api.projects.create(req)
    await refreshAll()
    await openProject(created)
  }

  async function sendMessage() {
    const content = draft.trim()
    if (!content) return
    if (!activeProject) {
      setError('No project is open.')
      return
    }

    const userMsg: ChatMessage = { id: uid(), role: 'user', content, createdAt: new Date().toISOString() }
    const pendingId = uid()
    const pendingMsg: ChatMessage = {
      id: pendingId,
      role: 'assistant',
      content: 'Generating…',
      createdAt: new Date().toISOString()
    }
    setMessages((m) => [...m, userMsg, pendingMsg])
    setDraft('')
    setError(null)

    const requestId = uid()
    setAiRequestId(requestId)
    setAiBusy(true)

    try {
      const res = await window.api.ai.run({ projectPath: activeProject.path, prompt: content, requestId })
      setMessages(res.chat)
      const t = await window.api.fs.tree(activeProject.path, { maxDepth: 6 })
      setTree(t)
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      setMessages((m) => m.map((x) => (x.id === pendingId ? { ...x, content: `⚠️ ${msg}` } : x)))
      setError(msg)
    } finally {
      setAiBusy(false)
      setAiRequestId(null)
    }
  }

  function onChatKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      sendMessage()
    }
  }

  return (
    <div className="h-full bg-white text-zinc-900">
      <div className="flex h-full">
        <aside className="w-72 shrink-0 border-r bg-white">
          <div className="flex items-center justify-between border-b px-3 py-2">
            <div className="text-sm font-semibold">{APP_TITLE}</div>
            <button
              className="rounded border px-2 py-1 text-xs hover:bg-zinc-50"
              onClick={() => setSettingsOpen(true)}
            >
              Settings
            </button>
          </div>

          {!activeProject ? (
            <div className="p-3">
              <div className="mb-2 text-xs font-semibold text-zinc-700">Projects</div>
              <div className="space-y-2">
                <button
                  className="w-full rounded bg-black px-3 py-2 text-sm text-white hover:bg-zinc-800"
                  onClick={() => setNewProjectOpen(true)}
                >
                  + New Project
                </button>

                {busy && <div className="text-sm text-zinc-600">Loading…</div>}

                {!busy && projects.length === 0 && (
                  <div className="rounded border bg-zinc-50 p-3 text-sm text-zinc-700">
                    No projects found. Create your first one.
                  </div>
                )}

                {!busy &&
                  projects.map((p) => (
                    <button
                      key={p.path}
                      className="w-full rounded border px-3 py-2 text-left text-sm hover:bg-zinc-50"
                      onClick={() => openProject(p)}
                      title={p.path}
                    >
                      <div className="font-semibold">{p.name}</div>
                      <div className="mt-0.5 text-xs text-zinc-600">{p.templateId ?? 'unknown template'}</div>
                    </button>
                  ))}
              </div>
            </div>
          ) : (
            <div className="p-3">
              <div className="flex items-start justify-between gap-2">
                <div>
                  <div className="text-xs text-zinc-600">Open project</div>
                  <div className="truncate text-sm font-semibold" title={activeProject.path}>
                    {activeProject.name}
                  </div>
                </div>
                <button className="rounded border px-2 py-1 text-xs hover:bg-zinc-50" onClick={() => setActiveProject(null)}>
                  Back
                </button>
              </div>

              <div className="mt-3">
                <div className="mb-1 text-xs font-semibold text-zinc-700">Files</div>
                <div className="max-h-[70vh] overflow-auto rounded border p-2">
                  <TreeView root={tree} />
                </div>
              </div>
            </div>
          )}
        </aside>

        <main className="flex-1">
          <div className="flex items-center justify-between border-b px-4 py-3">
            <div className="flex items-center gap-2">
              <button
                className={`rounded border px-3 py-1 text-sm ${mode === 'chat' ? 'border-black' : 'border-zinc-200'}`}
                onClick={() => setMode('chat')}
              >
                Chat
              </button>
              <button
                className={`rounded border px-3 py-1 text-sm ${mode === 'design' ? 'border-black' : 'border-zinc-200'}`}
                onClick={() => setMode('design')}
              >
                Design
              </button>
            </div>

            {error && (
              <div className="max-w-[60%] truncate text-right text-xs text-red-700" title={error}>
                ⚠️ {error}
              </div>
            )}
          </div>

          {!activeProject ? (
            <div className="p-6">
              <div className="text-lg font-semibold">Welcome</div>
              <div className="mt-1 text-sm text-zinc-700">
                Create a project to start. Your projects are stored locally.
              </div>

              {settings && (
                <div className="mt-3 text-xs text-zinc-600">
                  Projects folder: <code className="rounded bg-zinc-100 px-1 py-0.5">{settings.projectsRoot}</code>
                </div>
              )}
            </div>
          ) : mode === 'design' ? (
            <div className="p-6">
              <div className="rounded border bg-zinc-50 p-4 text-sm text-zinc-700">
                Preview will appear here (Milestone 3).
              </div>
            </div>
          ) : (
            <div className="flex h-[calc(100vh-56px)] flex-col">
              <div className="flex-1 overflow-auto p-4">
                <div className="space-y-3">
                  {messages.length === 0 && (
                    <div className="rounded border bg-zinc-50 p-4 text-sm text-zinc-700">
                      Describe what you want to build.
                    </div>
                  )}

                  {messages.map((m) => (
                    <div
                      key={m.id}
                      className={`max-w-[85%] rounded border p-3 text-sm ${
                        m.role === 'user' ? 'ml-auto bg-white' : 'bg-zinc-50'
                      }`}
                    >
                      <div className="mb-1 text-[11px] font-semibold text-zinc-600">
                        {m.role === 'user' ? 'You' : 'AI'}
                      </div>
                      <div className="whitespace-pre-wrap">{m.content}</div>
                      {m.createdAt && (
                        <div className="mt-2 text-[10px] text-zinc-500">{new Date(m.createdAt).toLocaleString()}</div>
                      )}
                    </div>
                  ))}

                  <div ref={chatEndRef} />
                </div>
              </div>

              <div className="border-t p-4">
                <div className="flex flex-col gap-2">
                  <textarea
                    className="min-h-[84px] w-full resize-none rounded border px-3 py-2 text-sm"
                    value={draft}
                    onChange={(e) => setDraft(e.target.value)}
                    onKeyDown={onChatKeyDown}
                    placeholder="Describe what you want to build…"
                    disabled={aiBusy}
                  />
                  <div className="mt-2 flex justify-end gap-2">
                    <button
                      className="rounded bg-black px-4 py-2 text-sm text-white hover:bg-zinc-800 disabled:opacity-50"
                      onClick={sendMessage}
                      disabled={aiBusy}
                    >
                      {aiBusy ? 'Generating…' : 'Send'}
                    </button>
                    {aiBusy && (
                      <button className="rounded border px-4 py-2 text-sm hover:bg-zinc-50" onClick={cancelAi}>
                        Stop
                      </button>
                    )}
                  </div>
                </div>
              </div>
            </div>
          )}
        </main>
      </div>

      {settings && (
        <SettingsModal
          open={settingsOpen}
          onClose={() => setSettingsOpen(false)}
          initial={settings}
          onSaved={(next) => {
            setSettings(next)
            void refreshProjectsOnly()
          }}
        />
      )}

      <NewProjectModal
        open={newProjectOpen}
        onClose={() => setNewProjectOpen(false)}
        templates={templates}
        onCreate={createProject}
        settingsOpen={() => setSettingsOpen(true)}
      />
    </div>
  )
}
