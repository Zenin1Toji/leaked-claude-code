import type { LLMProvider, ProviderName } from '../types'
import { OllamaProvider } from './ollama'
import { OpenRouterProvider } from './openrouter'

export function createProvider(
  name: ProviderName,
  options?: { openRouterApiKey?: string },
): LLMProvider {
  if (name === 'openrouter') {
    return new OpenRouterProvider(options?.openRouterApiKey)
  }
  return new OllamaProvider()
}
