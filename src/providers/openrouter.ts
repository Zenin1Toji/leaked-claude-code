import OpenAI from 'openai'
import { getDefaultModel, getOpenRouterKey } from '../config'
import type { ChatMessage, ChatOptions, LLMProvider } from '../types'

export class OpenRouterProvider implements LLMProvider {
  readonly name = 'openrouter' as const

  constructor(private readonly apiKeyOverride?: string) {}

  async chat(messages: ChatMessage[], options?: ChatOptions): Promise<string> {
    const client = new OpenAI({
      baseURL: 'https://openrouter.ai/api/v1',
      apiKey: this.apiKeyOverride || getOpenRouterKey(),
    })

    const response = await client.chat.completions.create({
      model: options?.model || getDefaultModel('openrouter'),
      temperature: options?.temperature,
      messages,
    })

    return response.choices[0]?.message?.content || ''
  }
}
