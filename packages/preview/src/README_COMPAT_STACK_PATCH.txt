// Patch note only: update compat stack versions to Next 14.2.35
// Apply these changes in your existing packages/preview/src/previewManager.ts:
//
// Replace occurrences of:
//   next@14.2.23  -> next@14.2.35
//
// (and keep react/react-dom 18.3.1)
//
// This patch zip includes a tiny helper file to remind this change.
// If you want a direct overwrite of previewManager.ts, reapply the earlier preview patch and then run a find/replace.
