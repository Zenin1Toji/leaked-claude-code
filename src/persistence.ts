import { appendFile, mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import { getDefaultModel } from "./config";
import type {
  PersistedConfig,
  ProviderName,
  SessionMessageRole,
  SessionSummary,
  StoredSessionMessage,
} from "./types";

const DATA_DIR_NAME = ".leakclaude";

export const DATA_DIR_PATH = path.join(process.cwd(), DATA_DIR_NAME);
export const CONFIG_PATH = path.join(DATA_DIR_PATH, "config.json");
export const SESSION_HISTORY_PATH = path.join(DATA_DIR_PATH, "session.jsonl");

const DEFAULT_CONFIG: PersistedConfig = {
  onboarded: false,
  provider: "ollama",
  model: getDefaultModel("ollama"),
  lastTier: "local",
  lastRateLimit: 120,
};

const ConfigSchema = z.object({
  onboarded: z.boolean().optional(),
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
    onboarded: parsed?.onboarded === true,
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
  sessionId: string,
  role: SessionMessageRole,
  content: string,
  provider: ProviderName,
  model: string,
): Promise<void> {
  await ensureDataDir();
  const record = {
    sessionId,
    timestamp: new Date().toISOString(),
    role,
    content,
    provider,
    model,
  };
  await appendFile(SESSION_HISTORY_PATH, `${JSON.stringify(record)}\n`, "utf8");
}

function summarizePreview(text: string, limit = 88): string {
  const clean = text.replace(/\s+/g, " ").trim();
  if (clean.length <= limit) return clean;
  return `${clean.slice(0, Math.max(0, limit - 1))}…`;
}

export async function loadSessionMessages(
  sessionId: string,
): Promise<StoredSessionMessage[]> {
  await ensureDataDir();
  try {
    const raw = await readFile(SESSION_HISTORY_PATH, "utf8");
    const lines = raw.split(/\r?\n/).filter(Boolean);
    const output: StoredSessionMessage[] = [];

    for (const line of lines) {
      try {
        const parsed = JSON.parse(line) as StoredSessionMessage;
        if (parsed.sessionId === sessionId) {
          output.push(parsed);
        }
      } catch {
        // skip malformed lines
      }
    }

    return output;
  } catch {
    return [];
  }
}

export async function listSessionSummaries(): Promise<SessionSummary[]> {
  await ensureDataDir();
  try {
    const raw = await readFile(SESSION_HISTORY_PATH, "utf8");
    const lines = raw.split(/\r?\n/).filter(Boolean);
    const map = new Map<string, SessionSummary>();

    for (const line of lines) {
      try {
        const parsed = JSON.parse(line) as StoredSessionMessage;
        if (!parsed.sessionId || !parsed.timestamp || !parsed.role) continue;

        const existing = map.get(parsed.sessionId);
        if (!existing) {
          map.set(parsed.sessionId, {
            sessionId: parsed.sessionId,
            startedAt: parsed.timestamp,
            lastAt: parsed.timestamp,
            provider: parsed.provider,
            model: parsed.model,
            messageCount: 1,
            preview: summarizePreview(parsed.content),
          });
          continue;
        }

        existing.messageCount += 1;
        if (parsed.timestamp < existing.startedAt) {
          existing.startedAt = parsed.timestamp;
        }
        if (parsed.timestamp > existing.lastAt) {
          existing.lastAt = parsed.timestamp;
          if (parsed.role === "user") {
            existing.preview = summarizePreview(parsed.content);
          }
        }
      } catch {
        // skip malformed line
      }
    }

    return [...map.values()].sort((a, b) => b.lastAt.localeCompare(a.lastAt));
  } catch {
    return [];
  }
}
