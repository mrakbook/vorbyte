import type { AIEngine, ChatRequest, ChatStreamChunk, CreateEngineOptions } from './types'
import { ollamaChat, ollamaChatStream } from './providers/ollama'
import { openaiChat, openaiChatStream } from './providers/openai'

export function createAIEngine(opts: CreateEngineOptions): AIEngine {
  if (opts.provider === 'ollama') {
    if (!opts.ollama) throw new Error('Missing ollama config')
    return {
      async chat(req: ChatRequest) {
        const text = await ollamaChat(opts.ollama!, req.messages, req.signal)
        return { text }
      },
      async *chatStream(req: ChatRequest): AsyncIterable<ChatStreamChunk> {
        if (req.stream === false) {
          const text = await ollamaChat(opts.ollama!, req.messages, req.signal)
          yield { delta: text }
          return
        }
        for await (const delta of ollamaChatStream(opts.ollama!, req.messages, req.signal)) {
          yield { delta }
        }
      }
    }
  }

  if (opts.provider === 'openai') {
    if (!opts.openai) throw new Error('Missing openai config')
    return {
      async chat(req: ChatRequest) {
        const text = await openaiChat(opts.openai!, req.messages, req.signal)
        return { text }
      },
      async *chatStream(req: ChatRequest): AsyncIterable<ChatStreamChunk> {
        if (req.stream === false) {
          const text = await openaiChat(opts.openai!, req.messages, req.signal)
          yield { delta: text }
          return
        }
        for await (const delta of openaiChatStream(opts.openai!, req.messages, req.signal)) {
          yield { delta }
        }
      }
    }
  }

  // Exhaustive guard
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const neverProvider: any = opts.provider
  throw new Error(`Unknown provider: ${String(neverProvider)}`)
}
