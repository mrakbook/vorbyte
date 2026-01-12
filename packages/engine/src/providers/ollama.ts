import { readNdjson } from '../shared/ndjson'
import type { ChatMessage, OllamaConfig } from '../types'

function toOllamaMessages(messages: ChatMessage[]) {
  // Ollama chat expects { role, content }
  return messages.map((m) => ({ role: m.role, content: m.content }))
}

export async function ollamaChat(config: OllamaConfig, messages: ChatMessage[], signal?: AbortSignal) {
  const baseUrl = (config.baseUrl ?? 'http://localhost:11434').replace(/\/$/, '')
  const url = `${baseUrl}/api/chat`

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
}

export async function* ollamaChatStream(
  config: OllamaConfig,
  messages: ChatMessage[],
  signal?: AbortSignal
): AsyncGenerator<string> {
  const baseUrl = (config.baseUrl ?? 'http://localhost:11434').replace(/\/$/, '')
  const url = `${baseUrl}/api/chat`

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
}
