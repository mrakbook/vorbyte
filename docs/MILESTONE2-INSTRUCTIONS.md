# VorByte Milestone 2 Patch

This folder contains the new/updated files to complete **Milestone 2: AI Engine Integration & Code Generation**.

## Apply

Copy the contents of this patch into the **root** of your VorByte monorepo (merge/overwrite).

Example (macOS/Linux):

```bash
# from your repo root
unzip vorbyte_milestone2_patch.zip -d /tmp/vorbyte_m2_patch
rsync -av /tmp/vorbyte_m2_patch/ ./
```

(Windows: extract the zip and copy/merge.)

## Run Studio (dev)

From repo root:

```bash
pnpm install
pnpm dev:studio
```

## Local AI (Ollama)

1. Install Ollama
2. Start it (usually auto-starts)
3. Pull a code-capable model:

```bash
ollama pull llama3.1
# or
ollama pull codellama:13b
```

In VorByte Studio:
- Settings → AI Mode = Local
- Local model = `ollama:llama3.1` (or `ollama:codellama:13b`)

Optional env var (if Ollama not on default port):
- `VORBYTE_OLLAMA_BASE_URL=http://localhost:11434`

## Cloud / OpenAI

In Studio Settings:
- AI Mode = Cloud
- Set OpenAI API key

Optional env var for OpenAI-compatible servers (LM Studio, etc):
- `VORBYTE_OPENAI_BASE_URL=http://localhost:1234`

## Verify Milestone 2

1. Create a new project.
2. Go to Chat.
3. Prompt: “Create a homepage with a header that says Welcome and a blue background.”
4. Confirm files were created/updated in the project folder.
5. In a terminal, run the generated project:

```bash
cd <your-project-path>
pnpm install
pnpm dev
```

6. Send a follow-up prompt (e.g., “Add a signup button to the navbar”) and verify files update.
