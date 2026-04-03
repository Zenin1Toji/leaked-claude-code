import { input, select } from "@inquirer/prompts";
import chalk from "chalk";
import { getDefaultModel } from "./config";
import { detectTier, isModelAllowed, listModels } from "./subscription";
import type { PersistedConfig, ProviderName, SessionBootstrap } from "./types";

const MODEL_PICKER_LIMIT = 15;
const CUSTOM_MODEL_PICKER_VALUE = "__custom_model__";

function printTopModels(label: string, models: string[]): void {
  if (models.length === 0) {
    process.stdout.write(chalk.gray(`No ${label} models discovered.\n\n`));
    return;
  }

  process.stdout.write(chalk.green(`${label} models (sample):\n`));
  for (const model of models.slice(0, 12)) {
    process.stdout.write(`  - ${model}\n`);
  }
  if (models.length > 12) {
    process.stdout.write(`  ...and ${models.length - 12} more\n`);
  }
  process.stdout.write("\n");
}

export async function runStartupWizard(
  defaultProvider: ProviderName,
  defaultModel?: string,
  persistedDefaults?: Partial<PersistedConfig>,
): Promise<SessionBootstrap> {
  if (
    persistedDefaults?.onboarded === true &&
    persistedDefaults.provider &&
    persistedDefaults.model &&
    !defaultModel
  ) {
    return {
      provider: persistedDefaults.provider,
      model: persistedDefaults.model,
      tier: persistedDefaults.lastTier || "local",
      rateLimitPerMinute: persistedDefaults.lastRateLimit || 120,
      openRouterApiKey: persistedDefaults.openRouterApiKey,
      availableModels: [],
    };
  }

  const provider = (await select({
    message: "Choose provider",
    default: persistedDefaults?.provider || defaultProvider,
    choices: [
      { name: "Ollama (local)", value: "ollama" },
      { name: "OpenRouter", value: "openrouter" },
    ],
  })) as ProviderName;

  let openRouterApiKey: string | undefined;
  if (provider === "openrouter") {
    openRouterApiKey = (
      await input({
        message: "Enter OpenRouter API key (sk-or-...)",
        default:
          persistedDefaults?.openRouterApiKey ||
          process.env.OPENROUTER_API_KEY ||
          "",
        validate: (value) =>
          value.trim().length > 0
            ? true
            : "API key is required for OpenRouter.",
      })
    ).trim();
  }

  const tierInfo = await detectTier(provider, { openRouterApiKey });
  process.stdout.write(
    chalk.yellow(
      `Detected tier: ${tierInfo.tier} (${tierInfo.note})\nRate limit: ${tierInfo.rateLimitPerMinute} req/min\n\n`,
    ),
  );

  const discoveredModels = await listModels(provider, { openRouterApiKey });
  const modelIds = discoveredModels.map((model) => model.id);
  if (provider === "openrouter" && tierInfo.tier === "free") {
    printTopModels(
      "OpenRouter free-tier eligible",
      discoveredModels.filter((model) => model.free).map((model) => model.id),
    );
  } else {
    printTopModels(
      provider === "openrouter" ? "OpenRouter" : "Ollama",
      modelIds,
    );
  }

  const suggestedModel =
    defaultModel || persistedDefaults?.model || getDefaultModel(provider);

  const validateModel = (value: string) => {
    const allowed = isModelAllowed(
      provider,
      tierInfo.tier,
      value,
      discoveredModels,
    );
    if (!allowed.ok)
      return allowed.reason || "Model not allowed for this tier.";
    return true;
  };

  let model = suggestedModel;
  const sortedModelIds = [...modelIds].sort((a, b) => a.localeCompare(b));

  if (sortedModelIds.length > 0) {
    const picked = await select({
      message: "Choose model",
      choices: [
        ...sortedModelIds.slice(0, MODEL_PICKER_LIMIT).map((id) => ({
          name: id,
          value: id,
        })),
        {
          name: "Enter custom model id",
          value: CUSTOM_MODEL_PICKER_VALUE,
        },
      ],
      default: sortedModelIds.includes(suggestedModel)
        ? suggestedModel
        : CUSTOM_MODEL_PICKER_VALUE,
    });

    if (picked !== CUSTOM_MODEL_PICKER_VALUE) {
      model = String(picked).trim();
    } else {
      model = (
        await input({
          message:
            provider === "openrouter"
              ? "Enter OpenRouter model id"
              : "Enter Ollama model id",
          default: suggestedModel,
          validate: validateModel,
        })
      ).trim();
    }
  } else {
    model = (
      await input({
        message:
          provider === "openrouter"
            ? "Enter OpenRouter model id"
            : "Enter Ollama model id",
        default: suggestedModel,
        validate: validateModel,
      })
    ).trim();
  }

  const allowed = isModelAllowed(
    provider,
    tierInfo.tier,
    model,
    discoveredModels,
  );
  if (!allowed.ok) {
    throw new Error(allowed.reason || "Model not allowed for this tier.");
  }

  return {
    provider,
    model,
    tier: tierInfo.tier,
    rateLimitPerMinute: tierInfo.rateLimitPerMinute,
    openRouterApiKey,
    availableModels: modelIds,
  };
}
