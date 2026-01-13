# Patch v9

Fixes preview build error:

- `Module not found: Can't resolve 'tailwindcss'`

Cause: our previous repairs may add Tailwind directives / PostCSS plugins, but some generated projects do not actually have `tailwindcss` installed (or it was removed / not present).

Fix: before starting preview, if globals.css or postcss config indicates Tailwind is being used and `node_modules/tailwindcss` is missing, we:

1) Add these devDependencies to the preview project package.json if missing:
   - tailwindcss ^3.4.19
   - postcss ^8.5.6
   - autoprefixer ^10.4.23
2) Run the project package manager install (`pnpm install` / `yarn install` / `npm install`).

This patch preserves all previous repairs.
