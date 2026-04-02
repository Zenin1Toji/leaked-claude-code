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
  provider: ProviderName;
  model: string;
  openRouterApiKey?: string;
  lastTier: SubscriptionTier;
  lastRateLimit: number;
};

export type SessionMessageRole = "user" | "assistant";

export type ReplRuntimeContext = {
  provider: ProviderName;
  model: string;
  tierLabel: SubscriptionTier;
  rateLimitPerMinute: number;
  cwd: string;
  persistMessage?: (role: SessionMessageRole, content: string) => Promise<void>;
};

export interface LLMProvider {
  readonly name: ProviderName;
  chat(messages: ChatMessage[], options?: ChatOptions): Promise<string>;
}
