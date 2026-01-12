import React, { useEffect, useMemo, useRef, useState } from 'react'
import type {
  AppSettings,
  ChatMessage,
  CreateProjectRequest,
  FileTreeNode,
  ProjectSummary,
  TemplateSummary
} from '@shared/types'

const APP_TITLE = 'vorbyte Studio'

function uid(): string {
  // crypto.randomUUID exists in modern Chromium/Electron
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const c: any = globalThis.crypto
  if (c?.randomUUID) return c.randomUUID()
  return `${Date.now()}-${Math.random().toString(16).slice(2)}`
}

function formatDate(iso?: string): string {
  if (!iso) return ''
  try {
    const d = new Date(iso)
    return d.toLocaleString()
  } catch {
    return iso
  }
}

function clampText(s: string, n: number): string {
  const t = s ?? ''
  if (t.length <= n) return t
  return `${t.slice(0, n)}…`
}

function Modal(props: {
  open: boolean
  title: string
  onClose: () => void
  children: React.ReactNode
  widthClassName?: string
}) {
  if (!props.open) return null
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className={`w-full ${props.widthClassName ?? 'max-w-2xl'} rounded-lg bg-white shadow-xl`}>
        <div className="flex items-center justify-between border-b px-4 py-3">
          <div className="text-base font-semibold">{props.title}</div>
          <button
            className="rounded px-2 py-1 text-sm hover:bg-zinc-100"
            onClick={props.onClose}
            aria-label="Close"
          >
            ✕
          </button>
        </div>
        <div className="px-4 py-4">{props.children}</div>
      </div>
    </div>
  )
}

function Pill(props: { children: React.ReactNode }) {
  return (
    <span className="inline-flex items-center rounded-full border bg-white px-2 py-0.5 text-xs text-zinc-700">
      {props.children}
    </span>
  )
}

function TreeView(props: { node: FileTreeNode; depth?: number }) {
  const depth = props.depth ?? 0
  const [open, setOpen] = useState(depth < 2)

  const isDir = props.node.type === 'dir'
  const children = props.node.children ?? []

  return (
    <div>
      <div
        className="flex cursor-default items-center gap-2 rounded px-2 py-1 text-sm hover:bg-zinc-50"
        style={{ paddingLeft: 8 + depth * 12 }}
        onClick={() => isDir && setOpen((v) => !v)}
        title={props.node.path}
      >
        <span className="w-4 text-center">{isDir ? (open ? '▾' : '▸') : '•'}</span>
        <span className="truncate">{props.node.name}</span>
      </div>
      {isDir && open && (
        <div>
          {children.length === 0 ? (
            <div className="px-2 py-1 text-xs text-zinc-500" style={{ paddingLeft: 8 + (depth + 1) * 12 }}>
              (empty)
            </div>
          ) : (
            children.map((c) => <TreeView key={c.path} node={c} depth={depth + 1} />)
          )}
        </div>
      )}
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
  const [showKey, setShowKey] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (props.open) {
      setDraft(props.initial)
      setError(null)
      setSaving(false)
      setShowKey(false)
    }
  }, [props.open, props.initial])

  async function pickProjectsRoot() {
    const picked = await window.api.dialog.selectDirectory({ defaultPath: draft.projectsRoot ?? undefined })
    if (picked) setDraft((d) => ({ ...d, projectsRoot: picked }))
  }

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
    <Modal open={props.open} title="Settings" onClose={props.onClose} widthClassName="max-w-3xl">
      <div className="space-y-4">
        {error && <div className="rounded border border-red-200 bg-red-50 p-3 text-sm text-red-800">{error}</div>}

        <div className="space-y-2">
          <div className="text-sm font-semibold">Projects folder</div>
          <div className="flex gap-2">
            <input
              className="w-full rounded border px-3 py-2 text-sm"
              value={draft.projectsRoot ?? ''}
              placeholder="~/AIBuilderProjects"
              onChange={(e) => setDraft((d) => ({ ...d, projectsRoot: e.target.value }))}
            />
            <button
              className="rounded border px-3 py-2 text-sm hover:bg-zinc-50"
              onClick={pickProjectsRoot}
              title="Pick where projects are created/stored"
            >
              Choose…
            </button>
          </div>
          <div className="text-xs text-zinc-600">
            Tip: This is where “New Project” folders will be created (and where existing projects are listed).
          </div>
        </div>

        <div className="space-y-2">
          <div className="text-sm font-semibold">OpenAI API Key</div>
          <div className="flex gap-2">
            <input
              className="w-full rounded border px-3 py-2 text-sm"
              type={showKey ? 'text' : 'password'}
              value={draft.openaiApiKey}
              placeholder="sk-..."
              onChange={(e) => setDraft((d) => ({ ...d, openaiApiKey: e.target.value }))}
            />
            <button
              className="rounded border px-3 py-2 text-sm hover:bg-zinc-50"
              onClick={() => setShowKey((v) => !v)}
            >
              {showKey ? 'Hide' : 'Show'}
            </button>
          </div>
          <div className="text-xs text-zinc-600">
            Stored locally for now (Milestone 1). You can later move this to OS Keychain if desired.
          </div>
        </div>

        <div className="space-y-2">
          <div className="text-sm font-semibold">Local model path / name (stub)</div>
          <input
            className="w-full rounded border px-3 py-2 text-sm"
            value={draft.localModelPath}
            placeholder="e.g., ollama:llama3.1 or /path/to/model"
            onChange={(e) => setDraft((d) => ({ ...d, localModelPath: e.target.value }))}
          />
          <div className="text-xs text-zinc-600">Used later when Local mode is implemented (Milestone 2).</div>
        </div>

        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <div className="text-sm font-semibold">Environment variables</div>
            <button
              className="rounded border px-3 py-1 text-sm hover:bg-zinc-50"
              onClick={() => setDraft((d) => ({ ...d, envVars: [...d.envVars, { key: '', value: '' }] }))}
            >
              Add
            </button>
          </div>

          {draft.envVars.length === 0 ? (
            <div className="text-sm text-zinc-600">(none)</div>
          ) : (
            <div className="space-y-2">
              {draft.envVars.map((kv, idx) => (
                <div className="flex gap-2" key={idx}>
                  <input
                    className="w-1/2 rounded border px-3 py-2 text-sm"
                    placeholder="KEY"
                    value={kv.key}
                    onChange={(e) => {
                      const key = e.target.value
                      setDraft((d) => {
                        const next = [...d.envVars]
                        next[idx] = { ...next[idx], key }
                        return { ...d, envVars: next }
                      })
                    }}
                  />
                  <input
                    className="w-1/2 rounded border px-3 py-2 text-sm"
                    placeholder="value"
                    value={kv.value}
                    onChange={(e) => {
                      const value = e.target.value
                      setDraft((d) => {
                        const next = [...d.envVars]
                        next[idx] = { ...next[idx], value }
                        return { ...d, envVars: next }
                      })
                    }}
                  />
                  <button
                    className="rounded border px-3 py-2 text-sm hover:bg-zinc-50"
                    onClick={() =>
                      setDraft((d) => ({ ...d, envVars: d.envVars.filter((_, i) => i !== idx) }))
                    }
                    aria-label="Remove env var"
                    title="Remove"
                  >
                    ✕
                  </button>
                </div>
              ))}
            </div>
          )}
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
            <div className="text-sm font-semibold">AI mode (UI only in Milestone 1)</div>

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
                  <option value="gpt-4">GPT-4 (placeholder)</option>
                  <option value="gpt-4o">GPT-4o (placeholder)</option>
                </select>
                <div className="text-xs text-zinc-600">Actual API integration is Milestone 2.</div>
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
                <div className="text-xs text-zinc-600">Local model integration is Milestone 2.</div>
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

            <div className="text-xs text-zinc-600">
              Help: Git is version control. If you don’t know what it is, you can leave it off for now.
            </div>
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
  const [chatBusy, setChatBusy] = useState(false)
  const [draft, setDraft] = useState('')

  const [newProjectOpen, setNewProjectOpen] = useState(false)
  const [settingsOpen, setSettingsOpen] = useState(false)

  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const chatEndRef = useRef<HTMLDivElement | null>(null)

  async function refreshAll() {
    setBusy(true)
    setError(null)
    try {
      const [s, t, p] = await Promise.all([
        window.api.settings.get(),
        window.api.templates.list(),
        window.api.projects.list()
      ])
      setSettings(s)
      setTemplates(t)
      setProjects(p)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  useEffect(() => {
    if (!activeProject) return
    ;(async () => {
      try {
        const nextTree = await window.api.fs.tree(activeProject.path, { maxDepth: 6 })
        setTree(nextTree)
      } catch (e) {
        console.warn('Failed to load file tree', e)
        setTree(null)
      }
      try {
        const nextChat = await window.api.chat.load(activeProject.path)
        setMessages(nextChat)
      } catch (e) {
        console.warn('Failed to load chat history', e)
        setMessages([])
      }
    })()
  }, [activeProject])

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages.length])

  async function openProject(p: ProjectSummary) {
    setActiveProject(p)
    setMode('chat')
    setMessages([])
    setDraft('')
  }

  async function createProject(req: CreateProjectRequest) {
    const created = await window.api.projects.create(req)
    await refreshAll()
    await openProject(created)
  }

  async function sendMessage() {
    const content = draft.trim()
    if (!content) return
    if (!activeProject) return
    if (chatBusy) return

    const userMsg: ChatMessage = {
      id: randomId(),
      role: 'user',
      content,
      createdAt: new Date().toISOString()
    }

    const placeholderId = randomId()
    const placeholder: ChatMessage = {
      id: placeholderId,
      role: 'assistant',
      content: 'Generating…',
      createdAt: new Date().toISOString()
    }

    setDraft('')
    setChatBusy(true)
    setMessages((prev) => [...prev, userMsg, placeholder])

    try {
      const result = await window.api.ai.run({ projectPath: activeProject.path, prompt: content })
      setMessages(result.chat)
      // Refresh file tree (the AI may have created/updated files)
      const nextTree = await window.api.fs.tree(activeProject.path, { maxDepth: 6 })
      setTree(nextTree)
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      setMessages((prev) => [
        ...prev.filter((m) => m.id !== placeholderId),
        {
          id: randomId(),
          role: 'assistant',
          content: `⚠️ ${msg}`,
          createdAt: new Date().toISOString()
        }
      ])
    } finally {
      setChatBusy(false)
    }
  }

  function onChatKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    // Enter sends; Shift+Enter newline
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      sendMessage()
    }
  }

  return (
    <div className="h-full bg-white text-zinc-900">
      <div className="flex h-full">
        {/* Sidebar */}
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
                  {activeProject.createdAt && (
                    <div className="text-xs text-zinc-500">{formatDate(activeProject.createdAt)}</div>
                  )}
                </div>
                <button
                  className="rounded border px-2 py-1 text-xs hover:bg-zinc-50"
                  onClick={() => {
                    setActiveProject(null)
                    setTree(null)
                    setMessages([])
                    setDraft('')
                  }}
                >
                  Close
                </button>
              </div>

              <div className="mt-4 flex items-center justify-between">
                <div className="text-xs font-semibold text-zinc-700">Project files</div>
                <button
                  className="rounded border px-2 py-1 text-xs hover:bg-zinc-50"
                  onClick={async () => {
                    if (!activeProject) return
                    const nextTree = await window.api.fs.tree(activeProject.path, { maxDepth: 6 })
                    setTree(nextTree)
                  }}
                  title="Refresh file tree"
                >
                  Refresh
                </button>
              </div>

              <div className="mt-2 h-[calc(100vh-180px)] overflow-auto rounded border">
                {tree ? (
                  <TreeView node={tree} />
                ) : (
                  <div className="p-3 text-sm text-zinc-600">File tree unavailable.</div>
                )}
              </div>
            </div>
          )}
        </aside>

        {/* Main */}
        <main className="flex min-w-0 flex-1 flex-col">
          <header className="flex items-center justify-between border-b px-4 py-3">
            <div className="min-w-0">
              <div className="truncate text-sm font-semibold">
                {activeProject ? `Workspace — ${activeProject.name}` : 'Welcome'}
              </div>
              <div className="text-xs text-zinc-600">
                {activeProject ? 'Describe what you want to build in chat.' : 'Create or open a project to begin.'}
              </div>
            </div>

            {activeProject && (
              <div className="flex gap-2">
                <button
                  className={`rounded border px-3 py-1.5 text-sm ${
                    mode === 'chat' ? 'border-black' : 'border-zinc-200'
                  }`}
                  onClick={() => setMode('chat')}
                >
                  Chat
                </button>
                <button
                  className={`rounded border px-3 py-1.5 text-sm ${
                    mode === 'design' ? 'border-black' : 'border-zinc-200'
                  }`}
                  onClick={() => setMode('design')}
                  title="Design mode preview will be implemented later"
                >
                  Design
                </button>
              </div>
            )}
          </header>

          {error && <div className="border-b bg-red-50 px-4 py-2 text-sm text-red-800">{error}</div>}

          {!activeProject ? (
            <div className="flex-1 overflow-auto p-6">
              <div className="mx-auto max-w-3xl space-y-4">
                <div className="rounded-lg border bg-white p-5">
                  <div className="text-lg font-semibold">Start a new project</div>
                  <div className="mt-1 text-sm text-zinc-600">
                    Pick a template or start from scratch. Then describe what you want to build.
                  </div>
                  <div className="mt-4">
                    <button
                      className="rounded bg-black px-4 py-2 text-sm text-white hover:bg-zinc-800"
                      onClick={() => setNewProjectOpen(true)}
                    >
                      + New Project
                    </button>
                  </div>
                </div>

                <div className="rounded-lg border bg-white p-5">
                  <div className="text-sm font-semibold">What you can do in Milestone 1</div>
                  <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-zinc-700">
                    <li>Create/open projects (folders on disk)</li>
                    <li>See project file tree in the sidebar</li>
                    <li>Chat with stubbed AI responses (UI flow)</li>
                    <li>Save settings (API keys, local model path, env vars)</li>
                  </ul>
                </div>
              </div>
            </div>
          ) : mode === 'design' ? (
            <div className="flex-1 overflow-auto p-6">
              <div className="rounded-lg border bg-zinc-50 p-6">
                <div className="text-lg font-semibold">Preview will appear here</div>
                <div className="mt-1 text-sm text-zinc-600">
                  Live preview server + embedded browser view is planned for a later milestone.
                </div>
              </div>
            </div>
          ) : (
            <div className="flex min-h-0 flex-1 flex-col">
              <div className="flex-1 overflow-auto p-4">
                {messages.length === 0 ? (
                  <div className="mx-auto max-w-2xl rounded-lg border bg-white p-5">
                    <div className="text-sm font-semibold">Describe what you want to build</div>
                    <div className="mt-1 text-sm text-zinc-600">
                      Example: “Build a landing page with a hero, pricing cards, and a FAQ section.”
                    </div>
                  </div>
                ) : (
                  <div className="mx-auto max-w-3xl space-y-3">
                    {messages.map((m) => (
                      <div
                        key={m.id}
                        className={`w-full rounded-lg border p-3 ${
                          m.role === 'user' ? 'bg-white' : 'bg-zinc-50'
                        }`}
                      >
                        <div className="flex items-center justify-between">
                          <div className="text-xs font-semibold text-zinc-700">
                            {m.role === 'user' ? 'You' : 'AI'}
                          </div>
                          <div className="text-xs text-zinc-500">{formatDate(m.createdAt)}</div>
                        </div>
                        <div className="mt-2 whitespace-pre-wrap text-sm text-zinc-900">{m.content}</div>
                      </div>
                    ))}
                    <div ref={chatEndRef} />
                  </div>
                )}
              </div>

              <div className="border-t bg-white p-3">
                <div className="mx-auto max-w-3xl">
                  <textarea
                    className="h-24 w-full resize-none rounded border px-3 py-2 text-sm"
                    placeholder="Describe what you want to build…"
                    value={draft}
                    onChange={(e) => setDraft(e.target.value)}
                    onKeyDown={onChatKeyDown}
                  />
                  <div className="mt-2 flex justify-end">
                    <button
                      className={`rounded px-4 py-2 text-sm text-white ${
                        chatBusy || !draft.trim()
                          ? 'cursor-not-allowed bg-zinc-400'
                          : 'bg-black hover:bg-zinc-800'
                      }`}
                      onClick={sendMessage}
                      disabled={chatBusy || !draft.trim()}
                    >
                      {chatBusy ? 'Generating…' : 'Send'}
                    </button>
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
          onSaved={(next) => setSettings(next)}
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
