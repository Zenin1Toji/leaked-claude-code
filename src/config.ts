import { config as loadEnv } from 'dotenv'
import { z } from 'zod'
import type { ProviderName } from './types'

loadEnv()

const EnvSchema = z.object({
  OPENROUTER_API_KEY: z.string().optional(),
  OPENROUTER_MODEL: z.string().optional(),
  OLLAMA_MODEL: z.string().optional(),
})

const env = EnvSchema.parse(process.env)

export function getDefaultModel(provider: ProviderName): string {
  if (provider === 'openrouter') {
    return env.OPENROUTER_MODEL || 'openrouter/auto'
  }
  return env.OLLAMA_MODEL || 'llama3.1:8b'
}

export function getOpenRouterKey(): string {
  const key = env.OPENROUTER_API_KEY
  if (!key) {
    throw new Error(
      'OPENROUTER_API_KEY missing. Set it in your shell or .env file.',
    )
  }
  return key
}
