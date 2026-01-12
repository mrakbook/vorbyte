export type ChatRole = 'system' | 'user' | 'assistant'

export interface ChatMessage {
  role: ChatRole
  content: string
}

export interface ChatRequest {
  messages: ChatMessage[]
  /**
   * Optional stop signal (for cancel button / timeouts).
   */
  signal?: AbortSignal
  /**
   * If true, provider may stream tokens. If provider doesn't support streaming,
   * it should fall back to non-stream behavior.
   */
  stream?: boolean
}

export interface ChatStreamChunk {
  delta: string
}

export interface AIEngine {
  /**
   * Non-streaming. Returns the full assistant text (may include code blocks).
   */
  chat(req: ChatRequest): Promise<{ text: string }>

  /**
   * Streaming. Yields incremental deltas. Also returns final text when done.
   */
  chatStream(req: ChatRequest): AsyncIterable<ChatStreamChunk>
}

export type EngineProvider = 'ollama' | 'openai'

export interface OllamaConfig {
  baseUrl?: string
  model: string
  temperature?: number
  numPredict?: number
}

export interface OpenAIConfig {
  apiKey: string
  baseUrl?: string
  model: string
  temperature?: number
  maxTokens?: number
}

export interface CreateEngineOptions {
  provider: EngineProvider
  ollama?: OllamaConfig
  openai?: OpenAIConfig
}
