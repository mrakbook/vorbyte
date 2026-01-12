import type { FileChange, ParsedAiResponse } from './types'

function safeTrim(s: string) {
  return s.replace(/\s+$/g, '').replace(/^\s+/g, '')
}

function parseJsonArrayLoose(text: string): string[] {
  // Try strict JSON first
  try {
    const arr = JSON.parse(text)
    if (Array.isArray(arr)) return arr.filter((x) => typeof x === 'string') as string[]
  } catch {
    // ignore
  }

  // Fallback: comma-separated list inside brackets or after "Dependencies:"
  const cleaned = text
    .replace(/^Dependencies\s*:\s*/i, '')
    .replace(/^[\[\(]\s*/g, '')
    .replace(/[\]\)]\s*$/g, '')
  return cleaned
    .split(',')
    .map((s) => s.trim().replace(/^['"]|['"]$/g, ''))
    .filter(Boolean)
}

/**
 * Supported AI response formats:
 *  1) "File: path" + fenced code block
 *  2) fenced code block info string like ```file path/to/file.tsx
 */
export function parseAiResponse(raw: string): ParsedAiResponse {
  const lines = raw.replace(/\r\n/g, '\n').split('\n')

  const files: FileChange[] = []
  const deps: string[] = []

  let i = 0
  let firstFileLineIndex: number | null = null

  while (i < lines.length) {
    const line = lines[i]

    // Dependencies: [...]
    if (/^Dependencies\s*:/i.test(line)) {
      const rest = line.replace(/^Dependencies\s*:\s*/i, '').trim()
      if (rest) {
        deps.push(...parseJsonArrayLoose(rest))
        i++
        continue
      }
      // maybe next lines contain JSON
      let j = i + 1
      let buf = ''
      while (j < lines.length && buf.length < 20000) {
        const l = lines[j]
        if (l.trim() === '') break
        buf += l + '\n'
        j++
      }
      deps.push(...parseJsonArrayLoose(buf.trim()))
      i = j
      continue
    }

    // Format 1: File: path
    const mFile = line.match(/^File\s*:\s*(.+)$/i)
    if (mFile) {
      if (firstFileLineIndex === null) firstFileLineIndex = i
      const filePath = mFile[1].trim()
      i++

      // Expect opening fence
      while (i < lines.length && lines[i].trim() === '') i++
      if (i >= lines.length || !lines[i].startsWith('```')) continue

      // consume opening fence
      i++
      const contentLines: string[] = []
      while (i < lines.length && !lines[i].startsWith('```')) {
        contentLines.push(lines[i])
        i++
      }
      // consume closing fence if present
      if (i < lines.length && lines[i].startsWith('```')) i++

      files.push({ path: filePath, content: contentLines.join('\n') })
      continue
    }

    // Format 2: ```file path/to/file.tsx
    const mFenceFile = line.match(/^```\s*file\s+(.+)$/i)
    if (mFenceFile) {
      if (firstFileLineIndex === null) firstFileLineIndex = i
      const filePath = mFenceFile[1].trim()
      i++
      const contentLines: string[] = []
      while (i < lines.length && !lines[i].startsWith('```')) {
        contentLines.push(lines[i])
        i++
      }
      if (i < lines.length && lines[i].startsWith('```')) i++
      files.push({ path: filePath, content: contentLines.join('\n') })
      continue
    }

    i++
  }

  const summary =
    firstFileLineIndex === null ? safeTrim(raw) : safeTrim(lines.slice(0, firstFileLineIndex).join('\n'))

  const uniqDeps = Array.from(new Set(deps.map((d) => d.trim()).filter(Boolean)))

  return { summary, files, dependencies: uniqDeps, raw }
}
