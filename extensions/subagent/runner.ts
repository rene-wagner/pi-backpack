import { spawn } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import {
  MAX_BUFFER_CHARS,
  MAX_MESSAGES,
  MAX_OUTPUT_CHARS,
  MAX_STDERR_CHARS,
  type RunSubagentInput,
  type RunSubagentResult,
} from "./types.js";

function truncateText(text: string, maxChars: number): string {
  if (text.length <= maxChars) return text;
  return `${text.slice(0, maxChars)}\n\n[truncated ${text.length - maxChars} chars]`;
}

function appendCapped(
  existing: string,
  chunk: string,
  maxChars: number,
): string {
  return truncateText(existing + chunk, maxChars);
}

function getPiInvocation(args: string[]): { command: string; args: string[] } {
  const currentScript = process.argv[1];
  const isBunVirtualScript = currentScript?.startsWith("/$bunfs/root/");

  if (currentScript && !isBunVirtualScript && fs.existsSync(currentScript)) {
    return { command: process.execPath, args: [currentScript, ...args] };
  }

  const execName = path.basename(process.execPath).toLowerCase();
  const isGenericRuntime = /^(node|bun)(\.exe)?$/.test(execName);
  if (!isGenericRuntime) return { command: process.execPath, args };

  return { command: "pi", args };
}

function textFromAssistantMessage(message: unknown): string {
  if (
    !message ||
    typeof message !== "object" ||
    !("role" in message) ||
    message.role !== "assistant" ||
    !("content" in message) ||
    !Array.isArray(message.content)
  ) {
    return "";
  }

  return message.content
    .filter(
      (part) =>
        part &&
        typeof part === "object" &&
        "type" in part &&
        part.type === "text" &&
        "text" in part &&
        typeof part.text === "string",
    )
    .map((part) => part.text)
    .join("\n");
}

async function writeTempSystemPrompt(
  systemPrompt: string,
): Promise<{ dir: string; file: string }> {
  const dir = await fs.promises.mkdtemp(path.join(os.tmpdir(), "pi-subagent-"));
  const file = path.join(dir, "system-prompt.md");
  await fs.promises.writeFile(file, systemPrompt, {
    encoding: "utf8",
    mode: 0o600,
  });
  return { dir, file };
}

export async function runSubagent(
  input: RunSubagentInput,
): Promise<RunSubagentResult> {
  const args = ["--mode", "json", "-p", "--no-session"];
  let temp: { dir: string; file: string } | undefined;

  try {
    if (input.model) args.push("--model", input.model);
    if (input.tools?.length) args.push("--tools", input.tools.join(","));
    if (input.systemPrompt?.trim()) {
      temp = await writeTempSystemPrompt(input.systemPrompt);
      args.push("--append-system-prompt", temp.file);
    }
    args.push(input.task);

    const invocation = getPiInvocation(args);
    return await new Promise((resolve) => {
      const child = spawn(invocation.command, invocation.args, {
        cwd: input.cwd,
        stdio: ["ignore", "pipe", "pipe"],
      });

      const messages: unknown[] = [];
      let output = "";
      let stderr = "";
      let buffer = "";
      let aborted = false;
      let settled = false;

      const finish = (result: RunSubagentResult) => {
        if (settled) return;
        settled = true;
        resolve(result);
      };

      const processLine = (line: string) => {
        if (!line.trim()) return;
        try {
          const event = JSON.parse(line) as unknown;
          if (
            event &&
            typeof event === "object" &&
            "type" in event &&
            event.type === "message_end" &&
            "message" in event
          ) {
            if (messages.length < MAX_MESSAGES) messages.push(event.message);
            const text = truncateText(
              textFromAssistantMessage(event.message),
              MAX_OUTPUT_CHARS,
            );
            if (text) {
              output = text;
              input.onUpdate?.(text);
            }
          }
        } catch {
          // Ignore non-JSON output.
        }
      };

      child.stdout.on("data", (chunk) => {
        buffer = appendCapped(buffer, chunk.toString(), MAX_BUFFER_CHARS);
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";
        for (const line of lines) processLine(line);
      });

      child.stderr.on("data", (chunk) => {
        stderr = appendCapped(stderr, chunk.toString(), MAX_STDERR_CHARS);
      });

      child.on("error", (error) => {
        finish({
          name: input.name,
          output,
          stderr: appendCapped(stderr, error.message, MAX_STDERR_CHARS),
          exitCode: 1,
          messages,
        });
      });
      child.on("close", (code) => {
        if (buffer.trim()) processLine(buffer);
        finish({
          name: input.name,
          output,
          stderr,
          exitCode: aborted ? 130 : (code ?? 0),
          messages,
        });
      });

      const abort = () => {
        aborted = true;
        child.kill("SIGTERM");
        setTimeout(() => child.kill("SIGKILL"), 5000).unref();
      };
      if (input.signal?.aborted) abort();
      else input.signal?.addEventListener("abort", abort, { once: true });
    });
  } finally {
    if (temp) {
      await fs.promises.rm(temp.dir, { recursive: true, force: true });
    }
  }
}
