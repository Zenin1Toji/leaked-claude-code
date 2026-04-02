import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { confirm, input } from "@inquirer/prompts";
import chalk from "chalk";
import { SlidingWindowRateLimiter } from "./rateLimiter";
import type { LLMProvider, ReplRuntimeContext } from "./types";

const MAX_READ_LINES = 200;

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

export async function runRepl(
  provider: LLMProvider,
  context: ReplRuntimeContext,
) {
  const history: Array<{ role: "user" | "assistant"; content: string }> = [];
  const limiter = new SlidingWindowRateLimiter(
    context.rateLimitPerMinute || 30,
  );

  const persist = async (role: "user" | "assistant", content: string) => {
    if (!context.persistMessage) return;
    try {
      await context.persistMessage(role, content);
    } catch {
      // non-fatal persistence failure
    }
  };

  const printAssistant = async (text: string) => {
    process.stdout.write(chalk.white(`assistant> ${text}\n\n`));
    await persist("assistant", text);
  };

  process.stdout.write(
    chalk.green(
      `\nleakclaude (${provider.name}${context.model ? `:${context.model}` : ""}, tier=${context.tierLabel || "unknown"}, limit=${context.rateLimitPerMinute || 30}/min) ready. Type /exit to quit.\n\n`,
    ),
  );

  while (true) {
    const text = (await input({ message: "you>" })).trim();
    if (!text) continue;
    if (text === "/exit" || text === "/quit") break;
    await persist("user", text);

    if (text.startsWith("/")) {
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
            "  /run <cmd>          Run shell command (with confirmation)",
            "  /read <path>        Read text file (max 200 lines)",
            "  /write <path>       Write file (prompt + confirmation)",
            "  /exit, /quit        Exit REPL",
          ].join("\n"),
        );
        continue;
      }

      if (name === "/status") {
        await printAssistant(
          `provider=${context.provider}\ntier=${context.tierLabel}\nmodel=${context.model}`,
        );
        continue;
      }

      if (name === "/limits") {
        await printAssistant(
          `Rate limit: ${context.rateLimitPerMinute} requests/minute`,
        );
        continue;
      }

      if (name === "/provider") {
        await printAssistant(context.provider);
        continue;
      }

      if (name === "/model") {
        await printAssistant(context.model);
        continue;
      }

      if (name === "/run") {
        if (!args) {
          await printAssistant("Usage: /run <cmd>");
          continue;
        }

        const shouldRun = await confirm({
          message: `Run command? ${args}`,
          default: false,
        });
        if (!shouldRun) {
          await printAssistant("Cancelled.");
          continue;
        }

        const result = await Bun.$`bash -lc ${args}`.quiet().nothrow();
        const stdout = result.stdout.toString().trim();
        const stderr = result.stderr.toString().trim();
        const output: string[] = [];
        output.push(`exit=${result.exitCode}`);
        output.push(`stdout:\n${stdout || "(empty)"}`);
        output.push(`stderr:\n${stderr || "(empty)"}`);
        await printAssistant(output.join("\n"));
        continue;
      }

      if (name === "/read") {
        if (!args) {
          await printAssistant("Usage: /read <path>");
          continue;
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
        continue;
      }

      if (name === "/write") {
        if (!args) {
          await printAssistant("Usage: /write <path>");
          continue;
        }

        const targetPath = path.resolve(context.cwd, args);
        if (!isPathInside(context.cwd, targetPath)) {
          await printAssistant(
            "Blocked: /write only allows paths inside current cwd.",
          );
          continue;
        }

        const content = await input({
          message: `Enter content for ${targetPath}`,
        });
        const shouldWrite = await confirm({
          message: `Write ${content.length} chars to ${targetPath}?`,
          default: false,
        });

        if (!shouldWrite) {
          await printAssistant("Cancelled.");
          continue;
        }

        try {
          await writeFile(targetPath, content, "utf8");
          await printAssistant(
            `Wrote ${content.length} chars to ${targetPath}`,
          );
        } catch (error) {
          const msg = error instanceof Error ? error.message : String(error);
          await printAssistant(`Failed to write file: ${msg}`);
        }
        continue;
      }

      await printAssistant(`Unknown command: ${name}. Try /help.`);
      continue;
    }

    history.push({ role: "user", content: text });
    process.stdout.write(chalk.cyan("assistant> thinking...\n"));

    try {
      await limiter.waitForSlot();
      const reply = await provider.chat(history, { model: context.model });
      history.push({ role: "assistant", content: reply });
      process.stdout.write(chalk.white(`assistant> ${reply}\n\n`));
      await persist("assistant", reply);
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      process.stderr.write(chalk.red(`error> ${msg}\n\n`));
    }
  }
}
