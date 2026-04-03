#!/usr/bin/env bun

import chalk from "chalk";
import { Command } from "commander";
import { runStartupWizard } from "./onboarding";
import {
  appendSessionMessage,
  listSessionSummaries,
  loadConfig,
  loadSessionMessages,
  saveConfig,
} from "./persistence";
import { createProvider } from "./providers";
import { runRepl } from "./repl";
import type { ProviderName } from "./types";

const program = new Command();

program
  .name("leakclaude")
  .description("Local coding agent with pluggable LLM providers")
  .option("-p, --provider <name>", "Provider: ollama | openrouter")
  .option("-m, --model <name>", "Model override");

async function resolveSession(commandLabel: "chat" | "agent") {
  const opts = program.opts<{ provider?: string; model?: string }>();
  const persisted = await loadConfig();

  const providerName = (opts.provider || persisted.provider) as ProviderName;
  if (providerName !== "ollama" && providerName !== "openrouter") {
    process.stderr.write(
      chalk.red("Invalid --provider. Use: ollama or openrouter\n"),
    );
    process.exit(1);
  }

  const shouldSkipWizard =
    persisted.onboarded === true && !opts.provider && !opts.model;

  const session = shouldSkipWizard
    ? {
        provider: persisted.provider,
        model: persisted.model,
        tier: persisted.lastTier,
        rateLimitPerMinute: persisted.lastRateLimit,
        openRouterApiKey: persisted.openRouterApiKey,
        availableModels: [],
      }
    : await runStartupWizard(providerName, opts.model, persisted);

  const sessionId = crypto.randomUUID();

  await saveConfig({
    onboarded: true,
    provider: session.provider,
    model: session.model,
    openRouterApiKey: session.openRouterApiKey,
    lastTier: session.tier,
    lastRateLimit: session.rateLimitPerMinute,
  });

  const provider = createProvider(session.provider, {
    openRouterApiKey: session.openRouterApiKey,
  });

  if (commandLabel === "agent") {
    process.stdout.write(chalk.magenta("Agent mode booting...\n"));
  }

  await runRepl(provider, {
    provider: session.provider,
    model: session.model,
    tierLabel: session.tier,
    rateLimitPerMinute: session.rateLimitPerMinute,
    cwd: process.cwd(),
    sessionId,
    persistMessage: (id, role, content) =>
      appendSessionMessage(id, role, content, session.provider, session.model),
    listSessions: listSessionSummaries,
    loadSessionMessages,
  });
}

program
  .command("chat")
  .description("Start interactive chat REPL")
  .action(async () => {
    await resolveSession("chat");
  });

program
  .command("agent")
  .description(
    "Start agent mode (currently same runtime as chat, with setup wizard)",
  )
  .action(async () => {
    await resolveSession("agent");
  });

program
  .command("providers")
  .description("List available providers")
  .action(() => {
    process.stdout.write("ollama\nopenrouter\n");
  });

if (process.argv.length <= 2) {
  process.argv.push("agent");
}

void program.parseAsync(process.argv);
