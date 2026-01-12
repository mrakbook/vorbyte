import React, { useEffect, useMemo, useRef, useState } from 'react'
import type {
  AppSettings,
  ChatMessage,
  CreateProjectRequest,
  FileTreeNode,
  ProjectSummary,
  TemplateSummary
} from '@shared/types'
import { Button } from './components/ui/button'
import { Input } from './components/ui/input'
import { Textarea } from './components/ui/textarea'
import { Tabs, TabsContent, TabsList, TabsTrigger } from './components/ui/tabs'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from './components/ui/dialog'
import { Label } from './components/ui/label'
import { ScrollArea } from './components/ui/scroll-area'
import { Separator } from './components/ui/separator'

declare global {
  interface Window {
    api: {
      settingsLoad: () => Promise<AppSettings>
      settingsSave: (s: AppSettings) => Promise<void>

      templatesList: () => Promise<TemplateSummary[]>
      templatesThumbnail: (id: string) => Promise<string | null>

      projectsList: () => Promise<ProjectSummary[]>
      projectsCreate: (req: CreateProjectRequest) => Promise<ProjectSummary>
      projectsTree: (path: string) => Promise<FileTreeNode>

      chatRead: (projectPath: string) => Promise<ChatMessage[]>
      chatWrite: (projectPath: string, messages: ChatMessage[]) => Promise<void>

      aiRun: (req: any) => Promise<any>

      dialogSelectDirectory: () => Promise<string | null>
    }
  }
}

function SettingsDialog(props: {
  open: boolean
  settings: AppSettings | null
  onClose: () => void
  onSave: (next: AppSettings) => Promise<void>
}) {
  const [draft, setDraft] = useState<AppSettings | null>(props.settings)

  useEffect(() => setDraft(props.settings), [props.settings])

  if (!draft) return null

  return (
    <Dialog open={props.open} onOpenChange={(o) => !o && props.onClose()}>
      <DialogContent className="max-w-xl">
        <DialogHeader>
          <DialogTitle>Settings</DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-2">
            <Label>Projects folder</Label>
            <div className="flex gap-2">
              <Input
                value={draft.projectsRoot ?? ''}
                onChange={(e) => setDraft({ ...draft, projectsRoot: e.target.value })}
                placeholder="~/VorByteProjects"
              />
              <Button
                variant="secondary"
                onClick={async () => {
                  const dir = await window.api.dialogSelectDirectory()
                  if (dir) setDraft({ ...draft, projectsRoot: dir })
                }}
              >
                Browse
              </Button>
            </div>
          </div>

          <Separator />

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label>AI mode</Label>
              <select
                className="w-full rounded border px-2 py-1"
                value={draft.aiMode ?? 'local'}
                onChange={(e) => setDraft({ ...draft, aiMode: e.target.value as any })}
              >
                <option value="local">Local</option>
                <option value="cloud">Cloud</option>
              </select>
            </div>

            <div className="space-y-2">
              <Label>Cloud model</Label>
              <Input
                value={draft.cloudModel ?? ''}
                onChange={(e) => setDraft({ ...draft, cloudModel: e.target.value })}
                placeholder="gpt-4o-mini"
              />
            </div>

            <div className="space-y-2">
              <Label>Local model</Label>
              <Input
                value={draft.localModelPath ?? ''}
                onChange={(e) => setDraft({ ...draft, localModelPath: e.target.value })}
                placeholder="llama3.1:8b (Ollama)"
              />
            </div>

            <div className="space-y-2">
              <Label>OpenAI API key</Label>
              <Input
                type="password"
                value={draft.openAiApiKey ?? ''}
                onChange={(e) => setDraft({ ...draft, openAiApiKey: e.target.value })}
                placeholder="sk-..."
              />
            </div>
          </div>

          <div className="flex justify-end gap-2 pt-2">
            <Button variant="secondary" onClick={props.onClose}>
              Cancel
            </Button>
            <Button
              onClick={async () => {
                await props.onSave(draft)
                props.onClose()
              }}
            >
              Save
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}

function NewProjectModal(props: {
  open: boolean
  templates: TemplateSummary[]
  onClose: () => void
  onCreate: (req: CreateProjectRequest) => Promise<void>
}) {
  const allTemplates = useMemo<TemplateSummary[]>(() => {
    const scratch: TemplateSummary = {
      id: 'scratch',
      name: 'Start from scratch',
      description: 'Create a new Next.js + Tailwind + shadcn/ui project scaffold.',
      overlayDir: '',
      thumbnail: ''
    }
    return [scratch, ...props.templates]
  }, [props.templates])

  const [step, setStep] = useState(0)
  const [name, setName] = useState('')
  const [templateId, setTemplateId] = useState<string>('scratch')
  const [aiMode, setAiMode] = useState<'local' | 'cloud'>('local')
  const [cloudModel, setCloudModel] = useState('gpt-4o-mini')
  const [localModel, setLocalModel] = useState('llama3.1:8b')
  const [enableImageGeneration, setEnableImageGeneration] = useState(false)
  const [initGit, setInitGit] = useState(true)

  const [creating, setCreating] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!props.open) {
      setStep(0)
      setName('')
      setTemplateId('scratch')
      setAiMode('local')
      setCloudModel('gpt-4o-mini')
      setLocalModel('llama3.1:8b')
      setEnableImageGeneration(false)
      setInitGit(true)
      setCreating(false)
      setError(null)
    }
  }, [props.open])

  function next() {
    setError(null)
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
        aiMode,
        cloudModel: aiMode === 'cloud' ? cloudModel : undefined,
        localModel: aiMode === 'local' ? localModel : undefined,
        enableImageGeneration,
        initGit
      }
      // IMPORTANT: "scratch" means omit templateId entirely (backend treats it as no overlay).
      if (templateId !== 'scratch') req.templateId = templateId

      await props.onCreate(req)
      props.onClose()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setCreating(false)
    }
  }

  const selectedTemplate = allTemplates.find((t) => t.id === templateId)

  return (
    <Dialog open={props.open} onOpenChange={(o) => !o && props.onClose()}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>New Project</DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          <div className="flex items-center justify-between text-sm text-zinc-600">
            <div>Step {step + 1} of 4</div>
            {creating ? <div className="text-zinc-800">Creating...</div> : null}
          </div>

          {error ? <div className="rounded border border-red-200 bg-red-50 p-2 text-sm text-red-700">{error}</div> : null}

          {step === 0 ? (
            <div className="space-y-2">
              <Label>Project name</Label>
              <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="My awesome app" />
              <div className="text-xs text-zinc-500">
                This will be used for display and as the folder name inside your Projects folder.
              </div>
            </div>
          ) : null}

          {step === 1 ? (
            <div className="space-y-2">
              <Label>Choose a template</Label>
              <div className="grid grid-cols-2 gap-2">
                {allTemplates.map((t) => (
                  <button
                    key={t.id}
                    className={`rounded border p-3 text-left hover:bg-zinc-50 ${
                      templateId === t.id ? 'border-zinc-900' : 'border-zinc-200'
                    }`}
                    onClick={() => setTemplateId(t.id)}
                  >
                    <div className="font-medium">{t.name}</div>
                    <div className="mt-1 text-xs text-zinc-600">{t.description}</div>
                  </button>
                ))}
              </div>
              <div className="text-xs text-zinc-500">Selected: {selectedTemplate?.name ?? '—'}</div>
            </div>
          ) : null}

          {step === 2 ? (
            <div className="space-y-3">
              <Label>AI model</Label>
              <div className="flex gap-2">
                <button
                  className={`rounded border px-3 py-2 text-sm ${
                    aiMode === 'local' ? 'border-zinc-900' : 'border-zinc-200'
                  }`}
                  onClick={() => setAiMode('local')}
                >
                  Local
                </button>
                <button
                  className={`rounded border px-3 py-2 text-sm ${
                    aiMode === 'cloud' ? 'border-zinc-900' : 'border-zinc-200'
                  }`}
                  onClick={() => setAiMode('cloud')}
                >
                  Cloud
                </button>
              </div>

              {aiMode === 'cloud' ? (
                <div className="space-y-2">
                  <Label>Cloud model</Label>
                  <Input value={cloudModel} onChange={(e) => setCloudModel(e.target.value)} placeholder="gpt-4o-mini" />
                </div>
              ) : (
                <div className="space-y-2">
                  <Label>Local model</Label>
                  <Input value={localModel} onChange={(e) => setLocalModel(e.target.value)} placeholder="llama3.1:8b" />
                  <div className="text-xs text-zinc-500">Use an Ollama model name (for example: llama3.1:8b).</div>
                </div>
              )}
            </div>
          ) : null}

          {step === 3 ? (
            <div className="space-y-3">
              <div className="flex items-center gap-2">
                <input
                  id="imggen"
                  type="checkbox"
                  checked={enableImageGeneration}
                  onChange={(e) => setEnableImageGeneration(e.target.checked)}
                />
                <Label htmlFor="imggen">Use AI image generation for design mockups</Label>
              </div>

              <div className="flex items-center gap-2">
                <input id="git" type="checkbox" checked={initGit} onChange={(e) => setInitGit(e.target.checked)} />
                <Label htmlFor="git">Initialize a Git repository</Label>
              </div>
            </div>
          ) : null}

          <div className="flex justify-between pt-2">
            <Button variant="secondary" disabled={creating || step === 0} onClick={back}>
              Back
            </Button>

            {step < 3 ? (
              <Button
                disabled={creating || (step === 0 && !name.trim())}
                onClick={() => {
                  if (step === 0 && !name.trim()) return
                  next()
                }}
              >
                Next
              </Button>
            ) : (
              <Button disabled={creating || !name.trim()} onClick={create}>
                Create project
              </Button>
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}

function ChatView(props: {
  project: ProjectSummary | null
  messages: ChatMessage[]
  onSend: (content: string) => Promise<void>
}) {
  const [value, setValue] = useState('')
  const endRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [props.messages])

  return (
    <div className="flex h-full flex-col">
      <div className="border-b p-3">
        <div className="text-sm font-medium">Chat</div>
        <div className="text-xs text-zinc-600">
          {props.project ? `Project: ${props.project.name}` : 'Create or open a project to start.'}
        </div>
      </div>

      <ScrollArea className="flex-1">
        <div className="space-y-2 p-3">
          {props.messages.map((m, idx) => (
            <div
              key={idx}
              className={`max-w-[80%] rounded border p-2 text-sm ${
                m.role === 'user' ? 'ml-auto border-zinc-900 bg-zinc-900 text-white' : 'border-zinc-200 bg-white'
              }`}
            >
              {m.content}
            </div>
          ))}
          <div ref={endRef} />
        </div>
      </ScrollArea>

      <div className="border-t p-3">
        <div className="flex gap-2">
          <Textarea
            value={value}
            onChange={(e) => setValue(e.target.value)}
            placeholder="Describe what you want to build…"
            className="min-h-[44px]"
          />
          <Button
            onClick={async () => {
              const c = value.trim()
              if (!c) return
              setValue('')
              await props.onSend(c)
            }}
          >
            Send
          </Button>
        </div>
      </div>
    </div>
  )
}

export default function App() {
  const [settings, setSettings] = useState<AppSettings | null>(null)
  const [settingsOpen, setSettingsOpen] = useState(false)

  const [templates, setTemplates] = useState<TemplateSummary[]>([])
  const [projects, setProjects] = useState<ProjectSummary[]>([])
  const [activeProject, setActiveProject] = useState<ProjectSummary | null>(null)

  const [fileTree, setFileTree] = useState<FileTreeNode | null>(null)
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([])

  const [newProjectOpen, setNewProjectOpen] = useState(false)

  async function refreshProjects() {
    const ps = await window.api.projectsList()
    setProjects(ps)
  }

  async function refreshTemplates() {
    const ts = await window.api.templatesList()
    setTemplates(ts)
  }

  async function openProject(p: ProjectSummary) {
    setActiveProject(p)
    const tree = await window.api.projectsTree(p.path)
    setFileTree(tree)
    const msgs = await window.api.chatRead(p.path)
    setChatMessages(msgs)
  }

  useEffect(() => {
    ;(async () => {
      const s = await window.api.settingsLoad()
      setSettings(s)
      await refreshTemplates()
      await refreshProjects()
    })()
  }, [])

  async function handleCreateProject(req: CreateProjectRequest) {
    const p = await window.api.projectsCreate(req)
    await refreshProjects()
    await openProject(p)
  }

  async function handleSendChat(content: string) {
    if (!activeProject) return

    const next = [...chatMessages, { role: 'user', content }]
    setChatMessages(next)
    await window.api.chatWrite(activeProject.path, next)

    // Milestone 2: call AI engine + codegen
    const result = await window.api.aiRun({
      projectPath: activeProject.path,
      messages: next
    })

    const assistantMsg: ChatMessage = {
      role: 'assistant',
      content: result.assistantText ?? '(no response)'
    }

    const next2 = [...next, assistantMsg]
    setChatMessages(next2)
    await window.api.chatWrite(activeProject.path, next2)

    // refresh tree after code application
    const tree = await window.api.projectsTree(activeProject.path)
    setFileTree(tree)
  }

  return (
    <div className="h-screen w-screen">
      <div className="flex h-full">
        {/* Sidebar */}
        <div className="w-72 border-r">
          <div className="border-b p-3">
            <div className="text-sm font-semibold">VorByte</div>
            <div className="mt-2 flex gap-2">
              <Button size="sm" onClick={() => setNewProjectOpen(true)}>
                New Project
              </Button>
              <Button size="sm" variant="secondary" onClick={() => setSettingsOpen(true)}>
                Settings
              </Button>
            </div>
          </div>

          <ScrollArea className="h-[calc(100%-68px)]">
            <div className="p-3">
              <div className="text-xs font-medium text-zinc-600">Projects</div>
              <div className="mt-2 space-y-2">
                {projects.map((p) => (
                  <button
                    key={p.path}
                    className={`w-full rounded border p-2 text-left hover:bg-zinc-50 ${
                      activeProject?.path === p.path ? 'border-zinc-900' : 'border-zinc-200'
                    }`}
                    onClick={() => openProject(p)}
                    title={p.path}
                  >
                    <div className="font-semibold">{p.name}</div>
                    <div className="mt-0.5 text-xs text-zinc-600">{p.templateId ?? 'scratch'}</div>
                  </button>
                ))}
              </div>
            </div>

            <Separator />

            <div className="p-3">
              <div className="text-xs font-medium text-zinc-600">Files</div>
              <div className="mt-2 text-xs text-zinc-700">
                {fileTree ? <pre className="whitespace-pre-wrap">{renderTree(fileTree)}</pre> : 'Open a project.'}
              </div>
            </div>
          </ScrollArea>
        </div>

        {/* Main */}
        <div className="flex-1">
          <Tabs defaultValue="chat" className="h-full">
            <div className="border-b p-2">
              <TabsList>
                <TabsTrigger value="chat">Chat</TabsTrigger>
                <TabsTrigger value="design">Design</TabsTrigger>
              </TabsList>
            </div>

            <TabsContent value="chat" className="h-[calc(100%-48px)]">
              <ChatView project={activeProject} messages={chatMessages} onSend={handleSendChat} />
            </TabsContent>

            <TabsContent value="design" className="h-[calc(100%-48px)]">
              <div className="flex h-full items-center justify-center text-sm text-zinc-600">
                Preview will appear here in Milestone 3.
              </div>
            </TabsContent>
          </Tabs>
        </div>
      </div>

      <NewProjectModal
        open={newProjectOpen}
        templates={templates}
        onCreate={handleCreateProject}
        onClose={() => setNewProjectOpen(false)}
      />

      <SettingsDialog
        open={settingsOpen}
        settings={settings}
        onClose={() => setSettingsOpen(false)}
        onSave={async (next) => {
          await window.api.settingsSave(next)
          setSettings(next)
          await refreshProjects()
        }}
      />
    </div>
  )
}

function renderTree(node: FileTreeNode, indent = 0): string {
  const pad = '  '.repeat(indent)
  if (node.type === 'file') return `${pad}- ${node.name}\n`
  const children = node.children ?? []
  let out = `${pad}${node.name}/\n`
  for (const c of children) out += renderTree(c, indent + 1)
  return out
}
