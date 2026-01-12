import { readSseData } from '../shared/sse'
import type { ChatMessage, OpenAIConfig } from '../types'

function toOpenAIMessages(messages: ChatMessage[]) {
  return messages.map((m) => ({ role: m.role, content: m.content }))
}

export async function openaiChat(config: OpenAIConfig, messages: ChatMessage[], signal?: AbortSignal) {
  const baseUrl = (config.baseUrl ?? 'https://api.openai.com').replace(/\/$/, '')
  const url = `${baseUrl}/v1/chat/completions`

  const res = await fetch(url, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${config.apiKey}`,
      'content-type': 'application/json'
    },
    signal,
    body: JSON.stringify({
      model: config.model,
      messages: toOpenAIMessages(messages),
      temperature: config.temperature ?? 0.2,
      max_tokens: config.maxTokens
    })
  })

  if (!res.ok) {
    const text = await res.text().catch(() => '')
    throw new Error(`OpenAI error ${res.status}: ${text || res.statusText}`)
  }

  const json = (await res.json()) as any
  const content = json?.choices?.[0]?.message?.content ?? ''
  return String(content)
}

export async function* openaiChatStream(
  config: OpenAIConfig,
  messages: ChatMessage[],
  signal?: AbortSignal
): AsyncGenerator<string> {
  const baseUrl = (config.baseUrl ?? 'https://api.openai.com').replace(/\/$/, '')
  const url = `${baseUrl}/v1/chat/completions`

  const res = await fetch(url, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${config.apiKey}`,
      'content-type': 'application/json'
    },
    signal,
    body: JSON.stringify({
      model: config.model,
      messages: toOpenAIMessages(messages),
      temperature: config.temperature ?? 0.2,
      stream: true
    })
  })

  if (!res.ok || !res.body) {
    const text = await res.text().catch(() => '')
    throw new Error(`OpenAI stream error ${res.status}: ${text || res.statusText}`)
  }

  for await (const data of readSseData(res.body)) {
    if (data === '[DONE]') break
    try {
      const json = JSON.parse(data)
      const delta = json?.choices?.[0]?.delta?.content
      if (typeof delta === 'string' && delta.length > 0) yield delta
    } catch {
      // ignore
    }
  }
}
