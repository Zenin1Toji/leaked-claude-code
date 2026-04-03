export type ProviderName = "ollama" | "openrouter";

export type SubscriptionTier = "free" | "paid" | "local";

export type ChatMessage = {
  role: "system" | "user" | "assistant";
  content: string;
};

export type ChatOptions = {
  model?: string;
  temperature?: number;
};

export type SessionBootstrap = {
  provider: ProviderName;
  model: string;
  tier: SubscriptionTier;
  rateLimitPerMinute: number;
  openRouterApiKey?: string;
  availableModels: string[];
};

export type PersistedConfig = {
  onboarded: boolean;
  provider: ProviderName;
  model: string;
  openRouterApiKey?: string;
  lastTier: SubscriptionTier;
  lastRateLimit: number;
};

export type SessionMessageRole = "user" | "assistant";

export type StoredSessionMessage = {
  sessionId: string;
  timestamp: string;
  role: SessionMessageRole;
  content: string;
  provider: ProviderName;
  model: string;
};

export type SessionSummary = {
  sessionId: string;
  startedAt: string;
  lastAt: string;
  provider: ProviderName;
  model: string;
  messageCount: number;
  preview: string;
};

export type ReplRuntimeContext = {
  provider: ProviderName;
  model: string;
  tierLabel: SubscriptionTier;
  rateLimitPerMinute: number;
  cwd: string;
  sessionId: string;
  persistMessage?: (
    sessionId: string,
    role: SessionMessageRole,
    content: string,
  ) => Promise<void>;
  listSessions?: () => Promise<SessionSummary[]>;
  loadSessionMessages?: (sessionId: string) => Promise<StoredSessionMessage[]>;
};

export interface LLMProvider {
  readonly name: ProviderName;
  chat(messages: ChatMessage[], options?: ChatOptions): Promise<string>;
}
