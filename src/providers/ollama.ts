import OpenAI from 'openai'
import { getDefaultModel } from '../config'
import type { ChatMessage, ChatOptions, LLMProvider } from '../types'

export class OllamaProvider implements LLMProvider {
  readonly name = 'ollama' as const

  async chat(messages: ChatMessage[], options?: ChatOptions): Promise<string> {
    const client = new OpenAI({
      baseURL: 'http://127.0.0.1:11434/v1',
      apiKey: 'ollama',
    })

    const response = await client.chat.completions.create({
      model: options?.model || getDefaultModel('ollama'),
      temperature: options?.temperature,
      messages,
    })

    return response.choices[0]?.message?.content || ''
  }
}
