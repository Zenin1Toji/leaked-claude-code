import { input, select } from '@inquirer/prompts'
import chalk from 'chalk'
import { getDefaultModel } from './config'
import { detectTier, isModelAllowed, listModels } from './subscription'
import type { ProviderName, SessionBootstrap } from './types'

function printTopModels(label: string, models: string[]): void {
  if (models.length === 0) {
    process.stdout.write(chalk.gray(`No ${label} models discovered.\n\n`))
    return
  }

  process.stdout.write(chalk.green(`${label} models (sample):\n`))
  for (const model of models.slice(0, 12)) {
    process.stdout.write(`  - ${model}\n`)
  }
  if (models.length > 12) {
    process.stdout.write(`  ...and ${models.length - 12} more\n`)
  }
  process.stdout.write('\n')
}

export async function runStartupWizard(
  defaultProvider: ProviderName,
  defaultModel?: string,
): Promise<SessionBootstrap> {
  const provider = (await select({
    message: 'Choose provider',
    default: defaultProvider,
    choices: [
      { name: 'Ollama (local)', value: 'ollama' },
      { name: 'OpenRouter', value: 'openrouter' },
    ],
  })) as ProviderName

  let openRouterApiKey: string | undefined
  if (provider === 'openrouter') {
    openRouterApiKey = (await input({
      message: 'Enter OpenRouter API key (sk-or-...)',
      default: process.env.OPENROUTER_API_KEY || '',
      validate: value =>
        value.trim().length > 0 ? true : 'API key is required for OpenRouter.',
    })).trim()
  }

  const tierInfo = await detectTier(provider, { openRouterApiKey })
  process.stdout.write(
    chalk.yellow(
      `Detected tier: ${tierInfo.tier} (${tierInfo.note})\nRate limit: ${tierInfo.rateLimitPerMinute} req/min\n\n`,
    ),
  )

  const discoveredModels = await listModels(provider, { openRouterApiKey })
  const modelIds = discoveredModels.map(model => model.id)
  if (provider === 'openrouter' && tierInfo.tier === 'free') {
    printTopModels(
      'OpenRouter free-tier eligible',
      discoveredModels.filter(model => model.free).map(model => model.id),
    )
  } else {
    printTopModels(provider === 'openrouter' ? 'OpenRouter' : 'Ollama', modelIds)
  }

  const suggestedModel = defaultModel || getDefaultModel(provider)
  const model = (await input({
    message:
      provider === 'openrouter'
        ? 'Enter OpenRouter model id'
        : 'Enter Ollama model id',
    default: suggestedModel,
    validate: value => {
      const allowed = isModelAllowed(
        provider,
        tierInfo.tier,
        value,
        discoveredModels,
      )
      if (!allowed.ok) return allowed.reason || 'Model not allowed for this tier.'
      return true
    },
  })).trim()

  return {
    provider,
    model,
    tier: tierInfo.tier,
    rateLimitPerMinute: tierInfo.rateLimitPerMinute,
    openRouterApiKey,
    availableModels: modelIds,
  }
}
