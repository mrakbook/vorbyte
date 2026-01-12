import { readNdjson } from '../shared/ndjson'
import type { ChatMessage, OllamaConfig } from '../types'

const DEFAULT_BASE_URL = 'http://127.0.0.1:11434'

function toOllamaMessages(messages: ChatMessage[]) {
  // Ollama chat expects { role, content }
  return messages.map((m) => ({ role: m.role, content: m.content }))
}

function normalizeBaseUrl(raw?: string) {
  return String(raw ?? DEFAULT_BASE_URL).replace(/\/$/, '')
}

function buildCandidateBaseUrls(raw?: string): string[] {
  const primary = normalizeBaseUrl(raw)
  const candidates = new Set<string>([primary])

  try {
    const u = new URL(primary)
    const host = u.hostname

    // `localhost` can resolve to IPv6 (::1) on macOS. If Ollama is only bound to IPv4,
    // the connection fails with ECONNREFUSED. Add an IPv4 candidate automatically.
    if (host === 'localhost' || host === '::1') {
      const v4 = new URL(primary)
      v4.hostname = '127.0.0.1'
      candidates.add(v4.toString().replace(/\/$/, ''))
    }

    // Also add localhost as a fallback if the user gave 127.0.0.1 (sometimes Ollama is bound differently).
    if (host === '127.0.0.1') {
      const lh = new URL(primary)
      lh.hostname = 'localhost'
      candidates.add(lh.toString().replace(/\/$/, ''))
    }
  } catch {
    // If URL parsing fails, just use the primary string.
  }

  return Array.from(candidates)
}

function isNetworkConnectError(err: unknown) {
  // Node's fetch throws TypeError with a nested `cause` for network issues.
  const anyErr = err as any
  const cause = anyErr?.cause
  const code = cause?.code ?? anyErr?.code
  return (
    code === 'ECONNREFUSED' ||
    code === 'ENOTFOUND' ||
    code === 'EHOSTUNREACH' ||
    code === 'ECONNRESET' ||
    code === 'ETIMEDOUT'
  )
}

function formatConnectHelp(candidates: string[], err: unknown) {
  const anyErr = err as any
  const cause = anyErr?.cause
  const code = cause?.code ?? anyErr?.code
  const detail = cause?.message ?? anyErr?.message ?? String(err)

  return [
    `Could not connect to Ollama.`,
    ``,
    `Tried:`,
    ...candidates.map((c) => `- ${c}`),
    ``,
    `Fix:`,
    `- Make sure Ollama is running (open the Ollama app, or run \`ollama serve\`).`,
    `- Make sure it's listening on port 11434.`,
    `- If you use a different host/port, set VORBYTE_OLLAMA_BASE_URL (or configure it in Settings if your build has that UI).`,
    `- Ensure the model is available: \`ollama pull <model>\``,
    ``,
    `Details: ${code ? `${code} ` : ''}${detail}`
  ].join('\n')
}

export async function ollamaChat(config: OllamaConfig, messages: ChatMessage[], signal?: AbortSignal) {
  const candidates = buildCandidateBaseUrls(config.baseUrl)
  let lastErr: unknown = null

  for (const baseUrl of candidates) {
    const url = `${baseUrl}/api/chat`

    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        signal,
        body: JSON.stringify({
          model: config.model,
          messages: toOllamaMessages(messages),
          stream: false,
          options: {
            temperature: config.temperature
          }
        })
      })

      if (!res.ok) {
        const text = await res.text().catch(() => '')
        throw new Error(`Ollama error ${res.status}: ${text || res.statusText}`)
      }

      const data = (await res.json()) as any
      const content = data?.message?.content ?? ''
      return String(content)
    } catch (err) {
      lastErr = err
      if (isNetworkConnectError(err) && candidates.length > 1) {
        // Try next candidate (e.g., localhost -> 127.0.0.1)
        continue
      }
      // Non-network error, or only one candidate: rethrow.
      throw err
    }
  }

  // All candidates failed with a network error
  throw new Error(formatConnectHelp(candidates, lastErr))
}

export async function* ollamaChatStream(
  config: OllamaConfig,
  messages: ChatMessage[],
  signal?: AbortSignal
): AsyncGenerator<string> {
  const candidates = buildCandidateBaseUrls(config.baseUrl)
  let lastErr: unknown = null

  for (const baseUrl of candidates) {
    const url = `${baseUrl}/api/chat`

    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        signal,
        body: JSON.stringify({
          model: config.model,
          messages: toOllamaMessages(messages),
          stream: true,
          options: {
            temperature: config.temperature,
            num_predict: config.numPredict
          }
        })
      })

      if (!res.ok || !res.body) {
        const text = await res.text().catch(() => '')
        throw new Error(`Ollama stream error ${res.status}: ${text || res.statusText}`)
      }

      for await (const obj of readNdjson(res.body)) {
        const delta = obj?.message?.content
        if (typeof delta === 'string' && delta.length > 0) {
          yield delta
        }
        if (obj?.done) break
      }

      return
    } catch (err) {
      lastErr = err
      if (isNetworkConnectError(err) && candidates.length > 1) {
        continue
      }
      throw err
    }
  }

  throw new Error(formatConnectHelp(candidates, lastErr))
}
