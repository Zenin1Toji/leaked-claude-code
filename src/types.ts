export type ProviderName = 'ollama' | 'openrouter'

export type SubscriptionTier = 'free' | 'paid' | 'local'

export type ChatMessage = {
  role: 'system' | 'user' | 'assistant'
  content: string
}

export type ChatOptions = {
  model?: string
  temperature?: number
}

export type SessionBootstrap = {
  provider: ProviderName
  model: string
  tier: SubscriptionTier
  rateLimitPerMinute: number
  openRouterApiKey?: string
  availableModels: string[]
}

export interface LLMProvider {
  readonly name: ProviderName
  chat(messages: ChatMessage[], options?: ChatOptions): Promise<string>
}
