# VorByte Preview Repair Patch

Your preview isn't starting because the AI generated code that crashes Next dev immediately:
- Invalid App Router layout using next/app / AppRouter
- Wrong imports like `import { Button } from '@shadcn/ui'`
- Installing @shadcn/ui, which is not a supported shadcn setup

This patch fixes preview reliability by:
1) Repairing clearly-invalid layout.tsx before starting preview.
2) Creating a minimal local `src/components/ui/button.tsx` if needed.
3) Rewriting bad Button imports to `@/components/ui/button`.
4) Keeping stronger error tail logs on exit.

It also includes a stricter dependency filter in codegen (apply.ts) in earlier patches.
