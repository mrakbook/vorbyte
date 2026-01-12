# Vorbyte

Vorbyte is a **local-first** (Mac-focused) AI web app builder that replicates the major “prompt → build → iterate → preview → deploy” workflow of Vercel’s v0.app, while running primarily on your machine. It’s designed for both technical and non-technical users: chat to generate and refine apps, optionally fine-tune in a visual design mode, and keep everything local unless you opt into cloud models or deployment.  
:contentReference[oaicite:2]{index=2} :contentReference[oaicite:3]{index=3} :contentReference[oaicite:4]{index=4}

## What it does (high level)

- Generate modern web apps using **Next.js + Tailwind CSS + shadcn/ui** as the default output stack. :contentReference[oaicite:5]{index=5}
- Build via **chat-based iterative refinement** (prompt, adjust, repeat). :contentReference[oaicite:6]{index=6}
- Run **locally** for privacy/offline use, with optional cloud AI when configured. :contentReference[oaicite:7]{index=7}
- Support multiple model backends (e.g., **Ollama / LM Studio** and cloud APIs). :contentReference[oaicite:8]{index=8}
- Provide a **live preview** loop where changes reflect immediately. :contentReference[oaicite:9]{index=9}

## High-level architecture

Vorbyte is organized as a single monorepo with clear boundaries between UI, AI orchestration, code writing, and preview/runtime.

**Data flow (conceptual):**

User (Studio UI)
  → Engine (model/provider + context)
    → Codegen (apply file changes + deps)
      → Preview (run app locally)
        → Studio (render preview + iterate)

:contentReference[oaicite:10]{index=10} :contentReference[oaicite:11]{index=11}

### Core components

- **Studio (`apps/studio`)**: Electron + React desktop UI (projects, chat, design mode shell, settings). :contentReference[oaicite:12]{index=12}
- **Engine (`packages/engine`)**: provider-agnostic AI engine (local + cloud), prompt/context management, planning hooks. :contentReference[oaicite:13]{index=13}
- **Codegen (`packages/codegen`)**: turns model output into edits on disk (files, formatting, dependency installs). :contentReference[oaicite:14]{index=14}
- **Preview (`packages/preview`)**: starts/stops preview server, manages ports/logs/recovery. :contentReference[oaicite:15]{index=15}
- **Template Kit (`packages/template-kit`)**: stable scaffold copied on “new project” (Next.js + Tailwind + shadcn/ui prewired). :contentReference[oaicite:16]{index=16}
- **Templates (`packages/templates`)**: template gallery content + metadata. :contentReference[oaicite:17]{index=17}
- **Integrations (`packages/integrations`)**: deploy + external service adapters (e.g., Vercel, GitHub, env var sync). :contentReference[oaicite:18]{index=18}

## Repository layout (monorepo)

This repo follows a simple, predictable layout:

- `apps/*` for runnable end-user entrypoints
- `packages/*` for shared libraries/tools (engine, codegen, preview, etc.)
- `.github/` for community health + CI
- `docs/` for architecture + deeper documentation

:contentReference[oaicite:19]{index=19} :contentReference[oaicite:20]{index=20}

Example:

- `apps/studio` — desktop app  
- `packages/engine` — AI engine  
- `packages/codegen` — filesystem/code application  
- `packages/preview` — preview runner  
- `packages/integrations` — deploy/service adapters  
- `packages/template-kit` — base scaffold  
- `packages/templates` — templates library  

:contentReference[oaicite:21]{index=21} :contentReference[oaicite:22]{index=22}

## Status

Early-stage / under active development. The intent is: **one clone → everything runs** as the repo evolves. :contentReference[oaicite:23]{index=23}
