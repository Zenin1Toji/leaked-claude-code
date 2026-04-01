import { input } from '@inquirer/prompts'
import chalk from 'chalk'
import { SlidingWindowRateLimiter } from './rateLimiter'
import type { LLMProvider } from './types'

export async function runRepl(
  provider: LLMProvider,
  options?: { model?: string; rateLimitPerMinute?: number; tierLabel?: string },
) {
  const history: Array<{ role: 'user' | 'assistant'; content: string }> = []
  const limiter = new SlidingWindowRateLimiter(options?.rateLimitPerMinute || 30)

  process.stdout.write(
    chalk.green(
      `\nleakclaude (${provider.name}${options?.model ? `:${options.model}` : ''}, tier=${options?.tierLabel || 'unknown'}, limit=${options?.rateLimitPerMinute || 30}/min) ready. Type /exit to quit.\n\n`,
    ),
  )

  while (true) {
    const text = (await input({ message: 'you>' })).trim()
    if (!text) continue
    if (text === '/exit' || text === '/quit') break

    history.push({ role: 'user', content: text })
    process.stdout.write(chalk.cyan('assistant> thinking...\n'))

    try {
      await limiter.waitForSlot()
      const reply = await provider.chat(history, { model: options?.model })
      history.push({ role: 'assistant', content: reply })
      process.stdout.write(chalk.white(`assistant> ${reply}\n\n`))
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error)
      process.stderr.write(chalk.red(`error> ${msg}\n\n`))
    }
  }
}
