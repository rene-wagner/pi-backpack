import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Text } from "@earendil-works/pi-tui";
import { promptAskUser } from "./ui.js";
import {
  AskUserParamsSchema,
  buildDisplayOptions,
  createCancelledDetails,
  normalizeOptions,
  type AskUserDetails,
} from "./types.js";

function formatResultText(details: AskUserDetails): string {
  if (details.answer === null) {
    return "User cancelled the question.";
  }
  if (details.wasCustom) {
    return `User wrote: ${details.answer}`;
  }
  return `User selected: ${details.selectedIndex}. ${details.answer} (value: ${details.value})`;
}

export function registerAskUserTool(pi: ExtensionAPI) {
  pi.on("before_agent_start", async (event) => ({
    systemPrompt:
      event.systemPrompt +
      "\n\nWhen you need to ask the user a follow-up question, call the ask_user tool instead of asking in plain assistant text. Prefer concise option lists when the likely answers are known, and allow free-text when the user may need to provide something custom.",
  }));

  pi.registerTool({
    name: "ask_user",
    label: "Ask User",
    description:
      "Ask the user a follow-up question via Pi UI. Supports option selection and optional free-text answers.",
    promptSnippet: "Ask the user a follow-up question via a Pi selection UI, optionally with free-text input.",
    promptGuidelines: [
      "Use ask_user when you need the user to choose between options or provide a clarifying answer before continuing.",
      "Use ask_user instead of asking follow-up questions in plain assistant text.",
      "Include concise options in ask_user when the likely answers are known, and set allowText when the user may need to type something custom.",
    ],
    parameters: AskUserParamsSchema,

    async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
      const options = normalizeOptions(params.options);
      const allowText = params.allowText !== false;

      if (options.length === 0 && !allowText) {
        return {
          content: [{ type: "text", text: "Error: ask_user needs at least one option or allowText=true." }],
          details: createCancelledDetails(params.question, options),
        };
      }

      if (!ctx.hasUI) {
        return {
          content: [
            {
              type: "text",
              text: "Error: ask_user requires interactive UI. If you still need input, ask the user in plain text.",
            },
          ],
          details: createCancelledDetails(params.question, options),
        };
      }

      const result = await promptAskUser(ctx, params, buildDisplayOptions(options, allowText));
      const details: AskUserDetails = result
        ? {
            question: params.question,
            options,
            answer: result.answer,
            value: result.value,
            ...(result.selectedIndex ? { selectedIndex: result.selectedIndex } : {}),
            wasCustom: result.wasCustom,
            cancelled: false,
          }
        : createCancelledDetails(params.question, options);

      return {
        content: [{ type: "text", text: formatResultText(details) }],
        details,
      };
    },

    renderCall(args, theme) {
      const text =
        theme.fg("toolTitle", theme.bold("ask_user ")) +
        theme.fg("muted", typeof args.question === "string" ? args.question : "Ask user");
      return new Text(text, 0, 0);
    },

    renderResult(result, _options, theme) {
      const details = result.details as AskUserDetails | undefined;
      if (!details) {
        const first = result.content[0];
        return new Text(first?.type === "text" ? first.text : "", 0, 0);
      }
      if (details.cancelled || details.answer === null) {
        return new Text(theme.fg("warning", "Cancelled"), 0, 0);
      }
      if (details.wasCustom) {
        return new Text(
          theme.fg("success", "✓ ") + theme.fg("muted", "(wrote) ") + theme.fg("accent", details.answer),
          0,
          0,
        );
      }

      const prefix = details.selectedIndex ? `${details.selectedIndex}. ` : "";
      const suffix = details.value && details.value !== details.answer ? theme.fg("muted", ` → ${details.value}`) : "";
      return new Text(theme.fg("success", "✓ ") + theme.fg("accent", `${prefix}${details.answer}`) + suffix, 0, 0);
    },
  });
}
