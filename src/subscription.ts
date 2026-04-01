import { z } from 'zod'
import type { ProviderName, SubscriptionTier } from './types'

export type TierMetadata = {
  tier: SubscriptionTier
  isPaid: boolean
  note: string
  rateLimitPerMinute: number
}

export type ModelInfo = {
  id: string
  displayName: string
  free: boolean
}

const OpenRouterKeySchema = z.object({
  data: z.object({
    is_free_tier: z.boolean(),
    rate_limit: z
      .object({
        requests: z.number().int().positive().optional(),
      })
      .partial()
      .nullable()
      .optional(),
  }),
})

const OpenRouterModelsSchema = z.object({
  data: z.array(
    z.object({
      id: z.string(),
      name: z.string().optional(),
      pricing: z
        .object({
          prompt: z.string(),
          completion: z.string(),
        })
        .optional(),
    }),
  ),
})

const OllamaTagsSchema = z.object({
  models: z.array(
    z.object({
      name: z.string(),
    }),
  ),
})

function inferOpenRouterModelFree(modelId: string): boolean {
  const lowered = modelId.toLowerCase()
  return (
    lowered.includes(':free') ||
    lowered.includes('/free') ||
    lowered.includes('free-') ||
    lowered.endsWith('free')
  )
}

function fallbackRateByTier(isFreeTier: boolean): number {
  return isFreeTier ? 15 : 60
}

export async function detectTier(
  provider: ProviderName,
  options?: { openRouterApiKey?: string },
): Promise<TierMetadata> {
  if (provider === 'ollama') {
    return {
      tier: 'local',
      isPaid: false,
      note: 'Local provider (no paid/free vendor subscription semantics).',
      rateLimitPerMinute: 120,
    }
  }

  const apiKey = options?.openRouterApiKey?.trim()
  if (!apiKey) {
    throw new Error('OpenRouter API key required to detect account tier.')
  }

  const response = await fetch('https://openrouter.ai/api/v1/key', {
    headers: {
      Authorization: `Bearer ${apiKey}`,
    },
  })

  if (!response.ok) {
    throw new Error(
      `OpenRouter tier check failed (${response.status} ${response.statusText}).`,
    )
  }

  const parsed = OpenRouterKeySchema.parse(await response.json())
  const isFreeTier = parsed.data.is_free_tier
  const detectedLimit = parsed.data.rate_limit?.requests

  return {
    tier: isFreeTier ? 'free' : 'paid',
    isPaid: !isFreeTier,
    note: 'Detected from OpenRouter /api/v1/key (is_free_tier).',
    rateLimitPerMinute:
      typeof detectedLimit === 'number' && Number.isFinite(detectedLimit)
        ? detectedLimit
        : fallbackRateByTier(isFreeTier),
  }
}

export async function listModels(
  provider: ProviderName,
  options?: { openRouterApiKey?: string },
): Promise<ModelInfo[]> {
  if (provider === 'ollama') {
    const response = await fetch('http://127.0.0.1:11434/api/tags')
    if (!response.ok) {
      throw new Error(
        `Ollama model list failed (${response.status} ${response.statusText}). Is Ollama running?`,
      )
    }
    const parsed = OllamaTagsSchema.parse(await response.json())
    return parsed.models.map(model => ({
      id: model.name,
      displayName: model.name,
      free: true,
    }))
  }

  const apiKey = options?.openRouterApiKey?.trim()
  if (!apiKey) {
    throw new Error('OpenRouter API key required to list models.')
  }

  const response = await fetch('https://openrouter.ai/api/v1/models', {
    headers: {
      Authorization: `Bearer ${apiKey}`,
    },
  })
  if (!response.ok) {
    throw new Error(
      `OpenRouter model list failed (${response.status} ${response.statusText}).`,
    )
  }

  const parsed = OpenRouterModelsSchema.parse(await response.json())
  return parsed.data.map(model => ({
    id: model.id,
    displayName: model.name || model.id,
    free: inferOpenRouterModelFree(model.id),
  }))
}

export function isModelAllowed(
  provider: ProviderName,
  tier: SubscriptionTier,
  model: string,
  availableModels?: ModelInfo[],
): { ok: boolean; reason?: string } {
  const chosen = model.trim()
  if (!chosen) {
    return { ok: false, reason: 'Model id is required.' }
  }

  if (availableModels && availableModels.length > 0) {
    const exact = availableModels.some(m => m.id === chosen)
    if (!exact) {
      return {
        ok: false,
        reason:
          'Model id is not present in your currently available model list for this provider.',
      }
    }
  }

  if (provider === 'ollama') {
    return { ok: true }
  }

  if (tier === 'paid') {
    return { ok: true }
  }

  const matchedModel = availableModels?.find(m => m.id === chosen)
  const freeByCatalog = matchedModel ? matchedModel.free : false
  if (freeByCatalog || inferOpenRouterModelFree(chosen)) {
    return { ok: true }
  }

  return {
    ok: false,
    reason:
      'OpenRouter free-tier can only use models marked as free (typically model ids with :free).',
  }
}
