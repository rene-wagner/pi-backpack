import { spawn } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";
import { DEFAULT_COWORK_TIMEOUT_MS, DEFAULT_COWORK_TOOLS, type CoworkJob, type CoworkRunOptions, type CoworkRunResult } from "./types.js";

const MAX_OUTPUT_CHARS = 20_000;
const MAX_STDERR_CHARS = 8_000;
const MAX_BUFFER_CHARS = 65_536;

function truncateText(text: string, maxChars: number): string {
  if (text.length <= maxChars) return text;
  return `${text.slice(0, maxChars)}\n\n[truncated ${text.length - maxChars} chars]`;
}

function appendCapped(existing: string, chunk: string, maxChars: number): string {
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
  const assistant = asAssistantMessage(message);
  if (!assistant) return "";

  return assistant.content
    .map((part) => {
      if (
        part &&
        typeof part === "object" &&
        "type" in part &&
        part.type === "text" &&
        "text" in part &&
        typeof part.text === "string"
      ) {
        return part.text;
      }
      return "";
    })
    .filter(Boolean)
    .join("\n");
}

function asAssistantMessage(message: unknown): { content: unknown[]; stopReason?: string; errorMessage?: string } | undefined {
  if (
    !message ||
    typeof message !== "object" ||
    !("role" in message) ||
    message.role !== "assistant" ||
    !("content" in message) ||
    !Array.isArray(message.content)
  ) {
    return undefined;
  }

  const stopReason = "stopReason" in message && typeof message.stopReason === "string" ? message.stopReason : undefined;
  const errorMessage = "errorMessage" in message && typeof message.errorMessage === "string" ? message.errorMessage : undefined;
  return { content: message.content, ...(stopReason ? { stopReason } : {}), ...(errorMessage ? { errorMessage } : {}) };
}

export async function runCoworkJob(job: CoworkJob, options: CoworkRunOptions = {}): Promise<CoworkRunResult> {
  const startedAt = new Date().toISOString();
  const started = Date.now();
  const tools = job.tools?.length ? job.tools : DEFAULT_COWORK_TOOLS;
  const args = ["--mode", "json", "-p", "--no-session", "--tools", tools.join(",")];
  if (job.model) args.push("--model", job.model);
  args.push(job.prompt);

  const invocation = getPiInvocation(args);

  return new Promise((resolve) => {
    const child = spawn(invocation.command, invocation.args, {
      cwd: job.cwd,
      stdio: ["ignore", "pipe", "pipe"],
    });

    let output = "";
    let stderr = "";
    let buffer = "";
    let settled = false;
    let aborted = false;
    let assistantError: string | undefined;

    const finish = (exitCode: number) => {
      if (assistantError && exitCode === 0) exitCode = 1;
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      const finishedAt = new Date().toISOString();
      resolve({
        jobId: job.id,
        startedAt,
        finishedAt,
        durationMs: Date.now() - started,
        exitCode,
        output,
        stderr: assistantError ? appendCapped(stderr, assistantError, MAX_STDERR_CHARS) : stderr,
        cwd: job.cwd,
        ...(job.model ? { model: job.model } : {}),
        tools,
      });
    };

    const timeout = setTimeout(() => {
      aborted = true;
      stderr = appendCapped(stderr, "Cowork job timed out.\n", MAX_STDERR_CHARS);
      child.kill("SIGTERM");
      setTimeout(() => child.kill("SIGKILL"), 5000).unref();
    }, job.timeoutMs ?? DEFAULT_COWORK_TIMEOUT_MS);
    timeout.unref();

    const abort = () => {
      aborted = true;
      child.kill("SIGTERM");
      setTimeout(() => child.kill("SIGKILL"), 5000).unref();
    };
    if (options.signal?.aborted) abort();
    else options.signal?.addEventListener("abort", abort, { once: true });

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
          const assistant = asAssistantMessage(event.message);
          if (assistant?.stopReason === "error" || assistant?.stopReason === "aborted") {
            assistantError = assistant.errorMessage ?? `Assistant stopped with ${assistant.stopReason}.`;
          }
          const text = truncateText(textFromAssistantMessage(event.message), MAX_OUTPUT_CHARS);
          if (text) {
            output = text;
            options.onUpdate?.(text);
          }
        } else if (
          event &&
          typeof event === "object" &&
          "type" in event &&
          event.type === "message_update" &&
          "assistantMessageEvent" in event &&
          event.assistantMessageEvent &&
          typeof event.assistantMessageEvent === "object" &&
          "type" in event.assistantMessageEvent &&
          event.assistantMessageEvent.type === "text_delta" &&
          "delta" in event.assistantMessageEvent &&
          typeof event.assistantMessageEvent.delta === "string"
        ) {
          output = appendCapped(output, event.assistantMessageEvent.delta, MAX_OUTPUT_CHARS);
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
      if (buffer.length > MAX_BUFFER_CHARS) {
        buffer = buffer.slice(-MAX_BUFFER_CHARS);
      }
    });

    child.stderr.on("data", (chunk) => {
      stderr = appendCapped(stderr, chunk.toString(), MAX_STDERR_CHARS);
    });

    child.on("error", (error) => {
      stderr = appendCapped(stderr, error.message, MAX_STDERR_CHARS);
      finish(1);
    });

    child.on("close", (code) => {
      if (buffer.trim()) processLine(buffer);
      finish(aborted ? 130 : (code ?? 0));
    });
  });
}
