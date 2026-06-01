import { spawn } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import type { RunSubagentInput, RunSubagentResult } from "./types.js";

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
    return await new Promise((resolve, reject) => {
      const child = spawn(invocation.command, invocation.args, {
        cwd: input.cwd,
        stdio: ["ignore", "pipe", "pipe"],
      });

      const messages: unknown[] = [];
      let output = "";
      let stderr = "";
      let buffer = "";
      let aborted = false;

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
            messages.push(event.message);
            const text = textFromAssistantMessage(event.message);
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
        buffer += chunk.toString();
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";
        for (const line of lines) processLine(line);
      });

      child.stderr.on("data", (chunk) => {
        stderr += chunk.toString();
      });

      child.on("error", reject);
      child.on("close", (code) => {
        if (buffer.trim()) processLine(buffer);
        if (aborted) reject(new Error(`Subagent ${input.name} aborted`));
        else {
          resolve({
            name: input.name,
            output,
            stderr,
            exitCode: code ?? 0,
            messages,
          });
        }
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
