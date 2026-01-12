import path from 'node:path'

function parserForFile(filePath: string): string | null {
  const ext = path.extname(filePath).toLowerCase()
  if (ext === '.ts' || ext === '.tsx') return 'typescript'
  if (ext === '.js' || ext === '.jsx') return 'babel'
  if (ext === '.json') return 'json'
  if (ext === '.css') return 'css'
  if (ext === '.md' || ext === '.mdx') return 'markdown'
  if (ext === '.yml' || ext === '.yaml') return 'yaml'
  return null
}

async function loadPrettier() {
  // Dynamic import is safest across CJS/ESM boundaries.
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  return await import('prettier')
}

export async function formatTextIfSupported(opts: { filePath: string; text: string; cwd?: string }): Promise<string> {
  const parser = parserForFile(opts.filePath)
  if (!parser) return opts.text

  const prettier = await loadPrettier()

  const config =
    (await prettier.resolveConfig(opts.filePath, { editorconfig: true }).catch(() => null)) ??
    (opts.cwd ? await prettier.resolveConfig(opts.cwd, { editorconfig: true }).catch(() => null) : null) ??
    {}

  // Prettier respects filepath for some parsers/plugins
  return prettier.format(opts.text, {
    ...config,
    parser,
    filepath: opts.filePath
  })
}
