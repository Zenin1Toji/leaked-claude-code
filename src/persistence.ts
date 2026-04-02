import { appendFile, mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import { getDefaultModel } from "./config";
import type {
  PersistedConfig,
  ProviderName,
  SessionMessageRole,
} from "./types";

const DATA_DIR_NAME = ".leakclaude";

export const DATA_DIR_PATH = path.join(process.cwd(), DATA_DIR_NAME);
export const CONFIG_PATH = path.join(DATA_DIR_PATH, "config.json");
export const SESSION_HISTORY_PATH = path.join(DATA_DIR_PATH, "session.jsonl");

const DEFAULT_CONFIG: PersistedConfig = {
  provider: "ollama",
  model: getDefaultModel("ollama"),
  lastTier: "local",
  lastRateLimit: 120,
};

const ConfigSchema = z.object({
  provider: z.enum(["ollama", "openrouter"]).optional(),
  model: z.string().min(1).optional(),
  openRouterApiKey: z.string().min(1).optional(),
  lastTier: z.enum(["free", "paid", "local"]).optional(),
  lastRateLimit: z.number().int().positive().optional(),
});

export async function ensureDataDir(): Promise<void> {
  await mkdir(DATA_DIR_PATH, { recursive: true });
}

function mergeWithDefaults(
  parsed: Partial<PersistedConfig> | undefined,
): PersistedConfig {
  return {
    ...DEFAULT_CONFIG,
    ...parsed,
    provider: (parsed?.provider as ProviderName) || DEFAULT_CONFIG.provider,
    model: parsed?.model?.trim() || DEFAULT_CONFIG.model,
    openRouterApiKey: parsed?.openRouterApiKey?.trim() || undefined,
    lastTier: parsed?.lastTier || DEFAULT_CONFIG.lastTier,
    lastRateLimit:
      typeof parsed?.lastRateLimit === "number" && parsed.lastRateLimit > 0
        ? parsed.lastRateLimit
        : DEFAULT_CONFIG.lastRateLimit,
  };
}

export async function loadConfig(): Promise<PersistedConfig> {
  await ensureDataDir();

  try {
    const raw = await readFile(CONFIG_PATH, "utf8");
    if (!raw.trim()) {
      return DEFAULT_CONFIG;
    }

    const json = JSON.parse(raw);
    const parsed = ConfigSchema.safeParse(json);
    if (!parsed.success) {
      return DEFAULT_CONFIG;
    }

    return mergeWithDefaults(parsed.data);
  } catch {
    return DEFAULT_CONFIG;
  }
}

export async function saveConfig(config: PersistedConfig): Promise<void> {
  await ensureDataDir();
  const normalized = mergeWithDefaults(config);
  await writeFile(
    CONFIG_PATH,
    `${JSON.stringify(normalized, null, 2)}\n`,
    "utf8",
  );
}

export async function appendSessionMessage(
  role: SessionMessageRole,
  content: string,
  provider: ProviderName,
  model: string,
): Promise<void> {
  await ensureDataDir();
  const record = {
    timestamp: new Date().toISOString(),
    role,
    content,
    provider,
    model,
  };
  await appendFile(SESSION_HISTORY_PATH, `${JSON.stringify(record)}\n`, "utf8");
}
