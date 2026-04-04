import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import * as readline from "node:readline";
import chalk from "chalk";
import { SlidingWindowRateLimiter } from "./rateLimiter";
import type {
  ChatMessage,
  LLMProvider,
  ReplRuntimeContext,
  SessionSummary,
  StoredSessionMessage,
} from "./types";

const MAX_READ_LINES = 200;
const MIN_WIDTH = 72;
const INPUT_MARKER = "▌";
const ROLE_COLUMN_WIDTH = 10;

type UIMode = "AGENT" | "PLAN";

type TranscriptRole = "user" | "assistant" | "system";

type TranscriptEntry = {
  role: TranscriptRole;
  content: string;
};

type TranscriptRenderLine = {
  role: TranscriptRole;
  continuation: boolean;
  text: string;
};

function wrapSingleLine(line: string, width: number): string[] {
  if (width <= 1) return [line];
  if (line.length === 0) return [""];

  const segments: string[] = [];
  let remaining = line;

  while (remaining.length > width) {
    let breakIndex = -1;
    for (let i = width - 1; i >= 0; i--) {
      const char = remaining[i];
      if (char === " " || char === "\t") {
        breakIndex = i;
        break;
      }
    }

    if (breakIndex > Math.floor(width * 0.35)) {
      segments.push(remaining.slice(0, breakIndex));
      let nextIndex = breakIndex;
      while (remaining[nextIndex] === " " || remaining[nextIndex] === "\t") {
        nextIndex += 1;
      }
      remaining = remaining.slice(nextIndex);
    } else {
      segments.push(remaining.slice(0, width));
      remaining = remaining.slice(width);
    }
  }

  segments.push(remaining);
  return segments;
}

function wrapText(text: string, width: number): string[] {
  const normalized = text.replace(/\r/g, "");
  const rawLines = normalized.split("\n");
  const wrapped: string[] = [];

  for (const rawLine of rawLines) {
    if (rawLine.length === 0) {
      wrapped.push("");
      continue;
    }
    wrapped.push(...wrapSingleLine(rawLine, width));
  }

  return wrapped.length > 0 ? wrapped : [""];
}

function truncateForDisplay(text: string, maxWidth: number): string {
  if (maxWidth <= 1) {
    return text.slice(0, Math.max(0, maxWidth));
  }
  if (text.length <= maxWidth) {
    return text;
  }
  return `${text.slice(0, maxWidth - 1)}…`;
}

function looksLikeImplementationRequest(text: string): boolean {
  const lowered = text.toLowerCase();
  return /\b(implement|build|create|add|fix|refactor|rewrite|optimi[sz]e|update|change|write code|generate code|feature|bug|patch|test|tests|script|cli|api|component|ui|backend)\b/.test(
    lowered,
  );
}

function isPathInside(baseDir: string, targetPath: string): boolean {
  const relative = path.relative(baseDir, targetPath);
  return (
    relative === "" ||
    (!relative.startsWith("..") && !path.isAbsolute(relative))
  );
}

function parseCommand(text: string): { name: string; args: string } {
  const trimmed = text.trim();
  const firstSpace = trimmed.indexOf(" ");
  if (firstSpace === -1) {
    return { name: trimmed, args: "" };
  }
  return {
    name: trimmed.slice(0, firstSpace),
    args: trimmed.slice(firstSpace + 1).trim(),
  };
}

function parseMouseWheelDirection(
  sequence: string | undefined,
): "up" | "down" | null {
  if (!sequence) return null;

  // SGR mouse mode (enabled via ?1006h):
  //   ESC [ < 64 ; x ; y M  => wheel up
  //   ESC [ < 65 ; x ; y M  => wheel down
  if (sequence.startsWith("\x1b[<")) {
    const body = sequence.slice(3);
    const terminatorIndex = body.search(/[mM]/);
    if (terminatorIndex !== -1) {
      const payload = body.slice(0, terminatorIndex);
      const [codeRaw] = payload.split(";");
      const code = Number.parseInt(codeRaw ?? "", 10);
      if (code === 64) return "up";
      if (code === 65) return "down";
    }
  }

  // Legacy X10 mouse mode:
  //   ESC [ M Cb Cx Cy, where (Cb - 32) is button code
  if (sequence.startsWith("\x1b[M") && sequence.length >= 6) {
    const code = sequence.charCodeAt(3) - 32;
    if ((code & 0b11_1111) === 64) return "up";
    if ((code & 0b11_1111) === 65) return "down";
  }

  // urxvt/1015 style: ESC [ Cb ; Cx ; Cy M
  if (sequence.startsWith("\x1b[") && sequence.endsWith("M")) {
    const payload = sequence.slice(2, -1);
    const [codeRaw] = payload.split(";");
    const code = Number.parseInt(codeRaw ?? "", 10);
    if (code === 64) return "up";
    if (code === 65) return "down";
  }

  return null;
}

function isMouseSequence(sequence: string | undefined): boolean {
  if (!sequence) return false;

  // SGR (1006): ESC [ < Cb ; Cx ; Cy (m|M)
  if (sequence.startsWith("\x1b[<")) {
    return true;
  }

  // X10 (1000): ESC [ M Cb Cx Cy
  if (sequence.startsWith("\x1b[M") && sequence.length >= 6) {
    return true;
  }

  // urxvt/1015: ESC [ Cb ; Cx ; Cy M
  if (sequence.startsWith("\x1b[") && sequence.endsWith("M")) {
    const parts = sequence.slice(2, -1).split(";");
    if (parts.length === 3 && parts.every((part) => /^\d+$/.test(part))) {
      return true;
    }
  }

  return false;
}

function isPrintableInputChunk(sequence: string | undefined): boolean {
  if (!sequence) return false;
  if (sequence.includes("\x1b")) return false;

  for (const ch of sequence) {
    const code = ch.charCodeAt(0);
    if (code < 32 || code === 127) {
      return false;
    }
  }

  return true;
}

export async function runRepl(
  provider: LLMProvider,
  context: ReplRuntimeContext,
) {
  const history: ChatMessage[] = [];
  const transcript: TranscriptEntry[] = [];
  const limiter = new SlidingWindowRateLimiter(
    context.rateLimitPerMinute || 30,
  );
  let mode: UIMode = "AGENT";
  let inputBuffer = "";
  let busy = false;
  let prompting = false;
  let closed = false;
  let transcriptScrollOffset = 0;

  const persist = async (role: "user" | "assistant", content: string) => {
    if (!context.persistMessage) return;
    try {
      await context.persistMessage(context.sessionId, role, content);
    } catch {
      // non-fatal persistence failure
    }
  };

  const addTranscript = (role: TranscriptRole, content: string) => {
    transcript.push({ role, content });
    transcriptScrollOffset = 0;
  };

  const getLayoutMetrics = () => {
    const width = Math.max(MIN_WIDTH, process.stdout.columns || 80);
    const rows = Math.max(24, process.stdout.rows || 30);
    const fixedRows = 8;
    const transcriptRowsBudget = Math.max(6, rows - fixedRows);
    const contentWidth = Math.max(18, width - ROLE_COLUMN_WIDTH - 1);
    return { width, rows, transcriptRowsBudget, contentWidth };
  };

  const getRoleCell = (role: TranscriptRole, continuation: boolean): string => {
    const raw = continuation
      ? "↳"
      : role === "user"
        ? "YOU"
        : role === "assistant"
          ? "ASSIST"
          : "INFO";
    const padded = `${raw.padEnd(ROLE_COLUMN_WIDTH - 1, " ")}│`;
    if (role === "user") return chalk.cyan(padded);
    if (role === "assistant") return chalk.white(padded);
    return chalk.yellow(padded);
  };

  const buildTranscriptLineBuffer = (
    contentWidth: number,
  ): TranscriptRenderLine[] => {
    const buffer: TranscriptRenderLine[] = [];
    for (const item of transcript) {
      const wrapped = wrapText(item.content, contentWidth);
      wrapped.forEach((segment, idx) => {
        buffer.push({
          role: item.role,
          continuation: idx > 0,
          text: segment,
        });
      });
    }
    return buffer;
  };

  const render = () => {
    if (closed) return;
    const { width, transcriptRowsBudget, contentWidth } = getLayoutMetrics();
    const divider = "─".repeat(width);
    const modelLabel = context.model || "(default)";

    const transcriptLines = buildTranscriptLineBuffer(contentWidth);
    const totalLineCount = transcriptLines.length;
    const maxOffset = Math.max(0, totalLineCount - transcriptRowsBudget);
    transcriptScrollOffset = Math.max(
      0,
      Math.min(maxOffset, transcriptScrollOffset),
    );

    const windowStart = Math.max(
      0,
      totalLineCount - transcriptRowsBudget - transcriptScrollOffset,
    );
    const windowEnd = Math.min(
      totalLineCount,
      windowStart + transcriptRowsBudget,
    );
    const windowLines = transcriptLines.slice(windowStart, windowEnd);

    const viewportIndicator =
      totalLineCount === 0
        ? "lines 0-0 / 0"
        : `lines ${windowStart + 1}-${windowEnd} / ${totalLineCount}`;

    const transcriptSection: string[] = [];
    if (windowLines.length === 0) {
      transcriptSection.push(
        `${" ".repeat(ROLE_COLUMN_WIDTH)} ${chalk.dim("(no messages yet)")}`,
      );
    } else {
      for (const line of windowLines) {
        transcriptSection.push(
          `${getRoleCell(line.role, line.continuation)} ${line.text}`,
        );
      }
    }

    while (transcriptSection.length < transcriptRowsBudget) {
      transcriptSection.push(`${" ".repeat(ROLE_COLUMN_WIDTH)} `);
    }

    const titleRaw = `leakclaude  ${provider.name.toUpperCase()} :: ${modelLabel}`;
    const metaRaw = `mode=${mode}  tier=${context.tierLabel || "unknown"}  limit=${context.rateLimitPerMinute || 30}/min`;
    const keysRaw =
      "TAB mode • Enter send • ↑/↓ or Ctrl+P/N scroll • PgUp/PgDn jump • /help • Ctrl+C exit";

    const statusText = busy ? "working... (wait for current request)" : "ready";
    const statusLabel = busy ? chalk.yellow("WORKING") : chalk.green("READY");
    const scrolledLabel =
      transcriptScrollOffset > 0
        ? chalk.dim(` • viewing history (+${transcriptScrollOffset})`)
        : "";

    const inputLabelRaw = `Input [${mode}]>`;
    const inputMax = Math.max(8, width - inputLabelRaw.length - 2);
    const inputVisible =
      inputBuffer.length > inputMax
        ? `…${inputBuffer.slice(-(inputMax - 1))}`
        : inputBuffer;

    const lines: string[] = [];
    lines.push(chalk.bold.green(truncateForDisplay(titleRaw, width)));
    lines.push(chalk.dim(truncateForDisplay(metaRaw, width)));
    lines.push(chalk.dim(truncateForDisplay(keysRaw, width)));
    lines.push(divider);
    lines.push(`${chalk.bold("Transcript")} ${chalk.dim(viewportIndicator)}`);
    lines.push(...transcriptSection);

    lines.push(divider);
    lines.push(
      `${chalk.bold("Status")} ${statusLabel} ${statusText}${scrolledLabel}`,
    );
    lines.push(`${chalk.cyan(inputLabelRaw)} ${inputVisible}${INPUT_MARKER}`);

    process.stdout.write("\x1b[2J\x1b[H");
    process.stdout.write(`${lines.join("\n")}`);
  };

  const scrollTranscriptBy = (delta: number) => {
    const { contentWidth, transcriptRowsBudget } = getLayoutMetrics();
    const totalLines = buildTranscriptLineBuffer(contentWidth).length;
    const maxOffset = Math.max(0, totalLines - transcriptRowsBudget);
    transcriptScrollOffset = Math.max(
      0,
      Math.min(maxOffset, transcriptScrollOffset + delta),
    );
    render();
  };

  const scrollTranscriptPage = (direction: "up" | "down") => {
    const { transcriptRowsBudget } = getLayoutMetrics();
    const jump = Math.max(3, Math.floor(transcriptRowsBudget * 0.8));
    scrollTranscriptBy(direction === "up" ? jump : -jump);
  };

  const printAssistant = async (text: string) => {
    addTranscript("assistant", text);
    render();
    await persist("assistant", text);
  };

  const withLinePrompt = async <T>(fn: () => Promise<T>): Promise<T> => {
    prompting = true;
    if (process.stdin.isTTY) {
      process.stdin.setRawMode(false);
    }
    process.stdout.write("\n");
    try {
      return await fn();
    } finally {
      if (process.stdin.isTTY) {
        process.stdin.setRawMode(true);
      }
      prompting = false;
      render();
    }
  };

  const promptLine = async (message: string): Promise<string> =>
    withLinePrompt(
      () =>
        new Promise((resolve) => {
          const rl = readline.createInterface({
            input: process.stdin,
            output: process.stdout,
          });
          rl.question(`${message} `, (answer) => {
            rl.close();
            resolve(answer);
          });
        }),
    );

  const promptConfirm = async (
    message: string,
    defaultValue = false,
  ): Promise<boolean> => {
    const suffix = defaultValue ? "[Y/n]" : "[y/N]";
    const answer = (await promptLine(`${message} ${suffix}`))
      .trim()
      .toLowerCase();
    if (!answer) return defaultValue;
    return answer === "y" || answer === "yes";
  };

  const handleChat = async (text: string) => {
    history.push({ role: "user", content: text });

    await limiter.waitForSlot();
    const reply = await provider.chat(history, { model: context.model });

    history.push({ role: "assistant", content: reply });
    await printAssistant(reply);
  };

  const handlePlanMode = async (text: string) => {
    if (!looksLikeImplementationRequest(text)) {
      await handleChat(text);
      return;
    }

    const planPrompt = `Create a concise implementation plan for this request. Return the plan first, without implementation details.\n\nRequest:\n${text}`;

    await limiter.waitForSlot();
    const plan = await provider.chat(
      [...history, { role: "user", content: planPrompt }],
      { model: context.model },
    );
    await printAssistant(`PLAN\n${plan}`);

    history.push({ role: "user", content: text });
    history.push({ role: "assistant", content: plan });

    const shouldImplement = await promptConfirm(
      "Proceed with implementation using this plan?",
      false,
    );

    if (!shouldImplement) {
      addTranscript("system", "Plan generated. Implementation cancelled.");
      render();
      return;
    }

    const implementationPrompt = `Use the approved plan below to produce the implementation response for the original request.\n\nOriginal request:\n${text}\n\nApproved plan:\n${plan}`;

    await limiter.waitForSlot();
    const implementation = await provider.chat(
      [...history, { role: "user", content: implementationPrompt }],
      { model: context.model },
    );

    history.push({ role: "assistant", content: implementation });
    await printAssistant(implementation);
  };

  const handleSlashCommand = async (
    text: string,
  ): Promise<"exit" | "continue"> => {
    const { name, args } = parseCommand(text);

    if (name === "/help") {
      await printAssistant(
        [
          "Commands:",
          "  /help               Show this help",
          "  /status             Show provider, tier, model",
          "  /limits             Show current rate limit",
          "  /provider           Show current provider",
          "  /model              Show current model",
          "  /history            Browse previous sessions",
          "  /run <cmd>          Run shell command (with confirmation)",
          "  /read <path>        Read text file (max 200 lines)",
          "  /write <path>       Write file (prompt + confirmation)",
          "  /exit, /quit        Exit REPL",
          "",
          "Keyboard:",
          "  TAB                 Toggle AGENT / PLAN mode",
          "  Enter               Submit current input",
          "  Up/Down             Scroll transcript (when input is empty)",
          "  Ctrl+P / Ctrl+N     Scroll transcript (when input is empty)",
          "  PgUp / PgDn         Jump transcript viewport",
          "  Ctrl+C              Exit REPL",
          "",
          "PLAN mode behavior:",
          "  - Coding/implementation prompts: plan -> confirm -> implement",
          "  - Conversational prompts (e.g. hi): direct answer",
        ].join("\n"),
      );
      return "continue";
    }

    if (name === "/status") {
      await printAssistant(
        `provider=${context.provider}\ntier=${context.tierLabel}\nmodel=${context.model}\nmode=${mode}`,
      );
      return "continue";
    }

    if (name === "/limits") {
      await printAssistant(
        `Rate limit: ${context.rateLimitPerMinute} requests/minute`,
      );
      return "continue";
    }

    if (name === "/provider") {
      await printAssistant(context.provider);
      return "continue";
    }

    if (name === "/model") {
      await printAssistant(context.model);
      return "continue";
    }

    if (name === "/history") {
      if (!context.listSessions || !context.loadSessionMessages) {
        await printAssistant("History is unavailable in this runtime.");
        return "continue";
      }

      const sessions = await context.listSessions();
      if (sessions.length === 0) {
        await printAssistant("No previous sessions found.");
        return "continue";
      }

      const capped = sessions.slice(0, 15);
      const menu = capped
        .map((s: SessionSummary, idx: number) => {
          return `${idx + 1}) ${s.lastAt} | ${s.provider}/${s.model} | ${s.messageCount} msgs | ${s.preview}`;
        })
        .join("\n");

      const selectedRaw = await promptLine(
        `History sessions:\n${menu}\nEnter number to preview:`,
      );
      const selectedIndex = Number.parseInt(selectedRaw.trim(), 10) - 1;
      if (
        Number.isNaN(selectedIndex) ||
        selectedIndex < 0 ||
        selectedIndex >= capped.length
      ) {
        await printAssistant("Invalid selection.");
        return "continue";
      }

      const selected = capped[selectedIndex]!;
      const messages = await context.loadSessionMessages(selected.sessionId);
      const preview = messages.slice(-12).map((m: StoredSessionMessage) => {
        const role = m.role === "user" ? "you" : "assistant";
        const clean = m.content.replace(/\s+/g, " ").trim();
        const short = clean.length > 140 ? `${clean.slice(0, 139)}…` : clean;
        return `${role}> ${short}`;
      });

      await printAssistant(
        [
          `History preview: ${selected.sessionId}`,
          `provider/model: ${selected.provider}/${selected.model}`,
          ...preview,
        ].join("\n"),
      );
      return "continue";
    }

    if (name === "/run") {
      if (!args) {
        await printAssistant("Usage: /run <cmd>");
        return "continue";
      }

      const shouldRun = await promptConfirm(`Run command? ${args}`, false);
      if (!shouldRun) {
        await printAssistant("Cancelled.");
        return "continue";
      }

      const result = await Bun.$`bash -lc ${args}`.quiet().nothrow();
      const stdout = result.stdout.toString().trim();
      const stderr = result.stderr.toString().trim();
      const output: string[] = [];
      output.push(`exit=${result.exitCode}`);
      output.push(`stdout:\n${stdout || "(empty)"}`);
      output.push(`stderr:\n${stderr || "(empty)"}`);
      await printAssistant(output.join("\n"));
      return "continue";
    }

    if (name === "/read") {
      if (!args) {
        await printAssistant("Usage: /read <path>");
        return "continue";
      }

      const targetPath = path.resolve(context.cwd, args);
      try {
        const fileText = await readFile(targetPath, "utf8");
        const lines = fileText.split(/\r?\n/);
        const display = lines.slice(0, MAX_READ_LINES);
        const numbered = display
          .map((line, idx) => `${idx + 1}: ${line}`)
          .join("\n");
        const suffix =
          lines.length > MAX_READ_LINES
            ? `\n... truncated ${lines.length - MAX_READ_LINES} additional lines`
            : "";
        await printAssistant(`Reading ${targetPath}\n${numbered}${suffix}`);
      } catch (error) {
        const msg = error instanceof Error ? error.message : String(error);
        await printAssistant(`Failed to read file: ${msg}`);
      }
      return "continue";
    }

    if (name === "/write") {
      if (!args) {
        await printAssistant("Usage: /write <path>");
        return "continue";
      }

      const targetPath = path.resolve(context.cwd, args);
      if (!isPathInside(context.cwd, targetPath)) {
        await printAssistant(
          "Blocked: /write only allows paths inside current cwd.",
        );
        return "continue";
      }

      const content = await promptLine(`Enter content for ${targetPath}`);
      const shouldWrite = await promptConfirm(
        `Write ${content.length} chars to ${targetPath}?`,
        false,
      );

      if (!shouldWrite) {
        await printAssistant("Cancelled.");
        return "continue";
      }

      try {
        await writeFile(targetPath, content, "utf8");
        await printAssistant(`Wrote ${content.length} chars to ${targetPath}`);
      } catch (error) {
        const msg = error instanceof Error ? error.message : String(error);
        await printAssistant(`Failed to write file: ${msg}`);
      }
      return "continue";
    }

    if (name === "/exit" || name === "/quit") {
      return "exit";
    }

    await printAssistant(`Unknown command: ${name}. Try /help.`);
    return "continue";
  };

  const submitCurrentInput = async (): Promise<"exit" | "continue"> => {
    if (busy || prompting) {
      return "continue";
    }

    const text = inputBuffer.trim();
    inputBuffer = "";
    render();
    if (!text) return "continue";

    addTranscript("user", text);
    render();
    await persist("user", text);

    busy = true;
    render();

    try {
      if (text.startsWith("/")) {
        return handleSlashCommand(text);
      }

      if (mode === "AGENT") {
        await handleChat(text);
        return "continue";
      }

      await handlePlanMode(text);
      return "continue";
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      addTranscript("system", `Error: ${msg}`);
      return "continue";
    } finally {
      busy = false;
      render();
    }
  };

  await new Promise<void>((resolve) => {
    const enableMouseTracking = () => {
      // 1000: button tracking, 1006: SGR extended coordinates
      process.stdout.write("\x1b[?1000h\x1b[?1006h");
    };

    const disableMouseTracking = () => {
      process.stdout.write("\x1b[?1000l\x1b[?1006l");
    };

    const cleanup = () => {
      if (closed) return;
      closed = true;

      process.stdin.off("keypress", onKeypress);
      process.stdout.off("resize", onResize);
      process.off("SIGINT", onSigint);

      disableMouseTracking();

      if (process.stdin.isTTY) {
        process.stdin.setRawMode(false);
      }
      process.stdin.pause();

      process.stdout.write("\x1b[2J\x1b[H");
      process.stdout.write(chalk.green("Session ended.\n"));
      resolve();
    };

    const onResize = () => {
      render();
    };

    const onSigint = () => {
      cleanup();
    };

    const onKeypress = (
      str: string,
      key: { name?: string; ctrl?: boolean; meta?: boolean; sequence?: string },
    ) => {
      if (prompting) return;

      const sequence = key.sequence ?? str;

      const wheel = parseMouseWheelDirection(sequence);
      if (wheel === "up") {
        scrollTranscriptBy(1);
        return;
      }
      if (wheel === "down") {
        scrollTranscriptBy(-1);
        return;
      }

      // Ignore mouse events from terminals with different mouse encodings.
      if (isMouseSequence(sequence)) {
        return;
      }

      const canScrollTranscript = inputBuffer.length === 0;

      if (canScrollTranscript) {
        if (key.name === "up") {
          scrollTranscriptBy(1);
          return;
        }

        if (key.name === "down") {
          scrollTranscriptBy(-1);
          return;
        }

        if (key.name === "pageup" || key.name === "prior") {
          scrollTranscriptPage("up");
          return;
        }

        if (key.name === "pagedown" || key.name === "next") {
          scrollTranscriptPage("down");
          return;
        }

        if (key.ctrl && key.name === "p") {
          scrollTranscriptBy(1);
          return;
        }

        if (key.ctrl && key.name === "n") {
          scrollTranscriptBy(-1);
          return;
        }
      }

      if (key.ctrl && key.name === "c") {
        cleanup();
        return;
      }

      if (key.name === "tab") {
        if (!busy) {
          mode = mode === "AGENT" ? "PLAN" : "AGENT";
          addTranscript("system", `Switched mode to ${mode}.`);
          render();
        }
        return;
      }

      if (key.name === "return") {
        if (!busy) {
          void submitCurrentInput().then((result) => {
            if (result === "exit") {
              cleanup();
            }
          });
        }
        return;
      }

      if (busy) return;

      if (key.name === "backspace") {
        inputBuffer = inputBuffer.slice(0, -1);
        render();
        return;
      }

      if (key.meta || key.ctrl) {
        return;
      }

      if (isPrintableInputChunk(sequence)) {
        inputBuffer += sequence;
        render();
      }
    };

    readline.emitKeypressEvents(process.stdin);
    if (process.stdin.isTTY) {
      process.stdin.setRawMode(true);
    }
    enableMouseTracking();
    process.stdin.resume();

    process.stdin.on("keypress", onKeypress);
    process.stdout.on("resize", onResize);
    process.on("SIGINT", onSigint);

    render();
  });
}
