# VorByte Patch: Fix pnpm @vercel/preact install error + Preview runner args bug

This patch fixes two runtime issues reported from VorByte Studio:

1) **ERR_PNPM_FETCH_404 @vercel/preact**
   - The AI/codegen pipeline can sometimes suggest non-existent packages (e.g. `@vercel/preact`).
   - Previously, a single bad dependency caused the whole `ai:run` to fail.
   - **Fix:** `packages/codegen/src/apply.ts`
     - Filters out `@vercel/preact` (including versioned forms like `@vercel/preact@latest`).
     - Installs dependencies **best-effort**: if a batch install fails, it retries package-by-package and skips only the failing ones.

2) **Next.js preview fails with “Invalid project directory …/-p”**
   - On some setups, running `pnpm dev -- -p <port> -H <host>` results in Next receiving a literal `--`,
     which makes Next treat `-p` as a directory argument.
   - **Fix:** `packages/preview/src/previewManager.ts`
     - Prefer running the project’s local `node_modules/.bin/next dev -p <port> -H <host>` directly.
     - Falls back to `pnpm dev` / `yarn dev` / `npm run dev` only if the project does not look like a Next app.

## Files included
- `packages/codegen/src/apply.ts`
- `packages/preview/src/previewManager.ts`

## How to apply
Copy these files into your VorByte repo, preserving paths, then rebuild/restart VorByte Studio.
