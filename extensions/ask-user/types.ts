import { Type, type Static } from "typebox";

export interface AskUserOption {
  label: string;
  value?: string;
  description?: string;
}

export interface AskUserDetails {
  question: string;
  options: AskUserOption[];
  answer: string | null;
  value: string | null;
  selectedIndex?: number;
  wasCustom: boolean;
  cancelled: boolean;
}

export interface AskUserResponse {
  answer: string;
  value: string;
  wasCustom: boolean;
  selectedIndex?: number;
}

export type DisplayOption = AskUserOption & { isCustom?: boolean };

export const AskUserOptionSchema = Type.Object({
  label: Type.String({ description: "Display label for the option" }),
  value: Type.Optional(Type.String({ description: "Value returned to the model for this option" })),
  description: Type.Optional(Type.String({ description: "Optional description shown below the option" })),
});

export const AskUserParamsSchema = Type.Object({
  question: Type.String({ description: "Question to ask the user" }),
  options: Type.Optional(Type.Array(AskUserOptionSchema, { description: "Selectable options for the user" })),
  allowText: Type.Optional(
    Type.Boolean({ description: "Allow a free-text answer in addition to the listed options. Defaults to true." }),
  ),
  placeholder: Type.Optional(
    Type.String({ description: "Placeholder text shown when entering a free-text answer" }),
  ),
});

export type AskUserParams = Static<typeof AskUserParamsSchema>;

export function normalizeOptions(options?: AskUserOption[]): AskUserOption[] {
  return (options ?? []).map((option) => ({
    label: option.label,
    ...(option.value ? { value: option.value } : {}),
    ...(option.description ? { description: option.description } : {}),
  }));
}

export function buildDisplayOptions(
  options: AskUserOption[],
  allowText: boolean,
): DisplayOption[] {
  return allowText
    ? [...options, { label: "Write a custom answer.", isCustom: true }]
    : [...options];
}

export function createCancelledDetails(
  question: string,
  options: AskUserOption[],
): AskUserDetails {
  return {
    question,
    options,
    answer: null,
    value: null,
    wasCustom: false,
    cancelled: true,
  };
}
