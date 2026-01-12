# Vorbyte

Vorbyte is a local-first AI web app builder (v0-style) that turns prompts into working web apps you can iterate on quickly. It’s designed to run primarily on your machine for speed and privacy, with optional cloud model support when configured.

## What it does (high level)

- Generate modern web apps using a Next.js-based stack (Tailwind + shadcn/ui by default)
- Iterate through chat-based refinement (prompt → update → preview → repeat)
- Run locally-first, with optional local or cloud model backends
- Provide a tight live preview loop while you build

## High-level architecture

Vorbyte is organized as a modular monorepo. Conceptually, the flow looks like this:

**Studio UI** → **AI Engine** → **Codegen** → **Local Preview**

### Core components

- **Studio (`apps/studio`)**: Desktop UI for projects, chat, and preview
- **Engine (`packages/engine`)**: Model/provider layer + prompt/context orchestration
- **Codegen (`packages/codegen`)**: Applies structured edits to project files and dependencies
- **Preview (`packages/preview`)**: Runs and manages the local preview server
- **Template Kit (`packages/template-kit`)**: Base project scaffold used for new apps
- **Templates (`packages/templates`)**: Template gallery definitions and metadata
- **Integrations (`packages/integrations`)**: Adapters for deployment and external services

## Repository layout

- `apps/` — runnable applications (e.g., Studio)
- `packages/` — shared libraries (engine, codegen, preview, etc.)
- `.github/` — CI and GitHub configuration
- `docs/` — design notes and architecture documentation

## Status

Early-stage / under active development.

## Contributing

Contributions are very welcome. Please contact Boris before starting work so we can align on scope and approach.

## Author

Boris Karaoglanov  
https://mrakbook.com/boris  
boris@mrakbook.com
