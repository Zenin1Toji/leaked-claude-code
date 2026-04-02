# leakclaude

Run your own local CLI coding/chat agent with your own model provider credentials.

Current providers:
- **Ollama** (local models)
- **OpenRouter** (API key)

---

## What you get

- Interactive CLI agent/chat loop
- Provider setup wizard on startup
- Tier-aware OpenRouter flow (free vs paid)
- Model selection + validation
- Request rate limiting
- Useful REPL commands (`/status`, `/run`, `/read`, `/write`, etc.)
- Local persistence under `.leakclaude/`

---

## Prerequisites

- **Bun** installed (v1.3+ recommended)
- Linux/macOS/WSL terminal

If using Ollama:
- Ollama installed and running locally (`http://127.0.0.1:11434`)

If using OpenRouter:
- A valid OpenRouter API key

---

## Install

```bash
bun install
```

Optional environment file:

```bash
cp .env.example .env
```

You can set:

- `OPENROUTER_API_KEY=`
- `OPENROUTER_MODEL=`
- `OLLAMA_MODEL=`

---

## Run

### Development mode

```bash
bun run dev
```

Default command is `agent`.

### Explicit commands

```bash
# agent mode
bun run dev agent

# chat mode
bun run dev chat

# list providers
bun run dev providers
```

### Build + run bundled output

```bash
bun run build
bun run start
```

---

## First-run flow (wizard)

When you start `agent` or `chat`, leakclaude will ask:

1. Which provider to use (Ollama/OpenRouter)
2. OpenRouter API key (if OpenRouter selected)
3. Detect account tier:
   - OpenRouter: uses `GET /api/v1/key` (`is_free_tier`)
   - Ollama: local tier
4. Fetch available models:
   - OpenRouter: `GET /api/v1/models`
   - Ollama: `GET /api/tags`
5. Select model from list or enter custom model ID

---

## Rate limits

- **OpenRouter**: uses `rate_limit.requests` when available from `/api/v1/key`
- If missing/invalid, fallback:
  - paid: `60 req/min`
  - free: `15 req/min`
- **Ollama**: `120 req/min`

---

## REPL slash commands

- `/help` — show command help
- `/status` — provider, tier, model
- `/limits` — active request limit
- `/provider` — current provider
- `/model` — current model
- `/run <cmd>` — run shell command (asks confirmation)
- `/read <path>` — read text file (up to 200 lines)
- `/write <path>` — write file (prompts content + confirmation)
- `/exit` or `/quit` — leave session

Safety rules:
- `/run` always asks before execution
- `/write` is blocked for paths outside current working directory

---

## Persistence

leakclaude stores local runtime data in:

- `.leakclaude/config.json`
  - remembers provider/model and recent tier/rate defaults
- `.leakclaude/session.jsonl`
  - appends user and assistant messages

---

## Troubleshooting

### OpenRouter key errors

- Ensure API key is valid
- Re-run and paste key when prompted
- Or set `OPENROUTER_API_KEY` in `.env`

### Ollama not reachable

- Start Ollama server
- Verify `http://127.0.0.1:11434/api/tags` works locally

### Type/build checks

```bash
bun run check
bun run build
```

---

## Current status

This is an actively evolving MVP. Core flow is stable for local usage with Ollama/OpenRouter, and additional agent capabilities are being added iteratively.
