import { Editor, type EditorTheme, Key, matchesKey, truncateToWidth } from "@earendil-works/pi-tui";
import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import type {
  AskUserParams,
  AskUserResponse,
  DisplayOption,
} from "./types.js";

export async function promptAskUser(
  ctx: ExtensionContext,
  params: AskUserParams,
  displayOptions: DisplayOption[],
): Promise<AskUserResponse | null> {
  const hasPresetOptions = (params.options?.length ?? 0) > 0;
  const startsInCustomMode = !hasPresetOptions && params.allowText !== false;

  return ctx.ui.custom<AskUserResponse | null>((tui, theme, _kb, done) => {
    let selectedIndex = 0;
    let customMode = startsInCustomMode;
    let cachedLines: string[] | undefined;

    const editorTheme: EditorTheme = {
      borderColor: (s: string) => theme.fg("accent", s),
      selectList: {
        selectedPrefix: (t: string) => theme.fg("accent", t),
        selectedText: (t: string) => theme.fg("accent", t),
        description: (t: string) => theme.fg("muted", t),
        scrollInfo: (t: string) => theme.fg("dim", t),
        noMatch: (t: string) => theme.fg("warning", t),
      },
    };
    const editor = new Editor(tui, editorTheme);

    editor.onSubmit = (value: string) => {
      const trimmed = value.trim();
      if (!trimmed) {
        refresh();
        return;
      }
      done({ answer: trimmed, value: trimmed, wasCustom: true });
    };

    function refresh() {
      cachedLines = undefined;
      tui.requestRender();
    }

    function handleInput(data: string) {
      if (customMode) {
        if (matchesKey(data, Key.escape)) {
          if (!hasPresetOptions) {
            done(null);
            return;
          }
          customMode = false;
          editor.setText("");
          refresh();
          return;
        }
        editor.handleInput(data);
        refresh();
        return;
      }

      if (matchesKey(data, Key.up)) {
        selectedIndex = Math.max(0, selectedIndex - 1);
        refresh();
        return;
      }
      if (matchesKey(data, Key.down)) {
        selectedIndex = Math.min(displayOptions.length - 1, selectedIndex + 1);
        refresh();
        return;
      }
      if (matchesKey(data, Key.enter)) {
        const selected = displayOptions[selectedIndex];
        if (!selected) {
          return;
        }
        if (selected.isCustom) {
          customMode = true;
          editor.setText("");
          refresh();
          return;
        }
        done({
          answer: selected.label,
          value: selected.value ?? selected.label,
          wasCustom: false,
          selectedIndex: selectedIndex + 1,
        });
        return;
      }
      if (matchesKey(data, Key.escape)) {
        done(null);
      }
    }

    function render(width: number): string[] {
      if (cachedLines) {
        return cachedLines;
      }

      const lines: string[] = [];
      const add = (text: string) => lines.push(truncateToWidth(text, width));

      add(theme.fg("accent", "─".repeat(width)));
      add(theme.fg("text", ` ${params.question}`));
      lines.push("");

      if (customMode) {
        renderCustomMode(lines, add, width, editor, displayOptions, params.placeholder, theme);
      } else {
        renderSelectionMode(lines, add, displayOptions, selectedIndex, theme);
      }

      add(theme.fg("accent", "─".repeat(width)));
      cachedLines = lines;
      return lines;
    }

    return {
      render,
      invalidate() {
        cachedLines = undefined;
      },
      handleInput,
    };
  });
}

function renderCustomMode(
  lines: string[],
  add: (text: string) => void,
  width: number,
  editor: Editor,
  displayOptions: DisplayOption[],
  placeholder: string | undefined,
  theme: {
    fg(color: string, text: string): string;
  },
) {
  if (displayOptions.length > 0) {
    for (let index = 0; index < displayOptions.length; index++) {
      const option = displayOptions[index];
      if (!option) {
        continue;
      }
      const active = option.isCustom === true;
      const prefix = active ? theme.fg("accent", "> ") : "  ";
      const suffix = active ? " ✎" : "";
      add(prefix + theme.fg(active ? "accent" : "text", `${index + 1}. ${option.label}${suffix}`));
      if (option.description) {
        add(`     ${theme.fg("muted", option.description)}`);
      }
    }
    lines.push("");
  }

  add(theme.fg("muted", " Your answer:"));
  if (placeholder) {
    add(theme.fg("dim", ` ${placeholder}`));
  }
  for (const line of editor.render(width - 2)) {
    add(` ${line}`);
  }
  lines.push("");
  add(theme.fg("dim", " Enter to submit • Esc to go back"));
}

function renderSelectionMode(
  lines: string[],
  add: (text: string) => void,
  displayOptions: DisplayOption[],
  selectedIndex: number,
  theme: {
    fg(color: string, text: string): string;
  },
) {
  for (let index = 0; index < displayOptions.length; index++) {
    const option = displayOptions[index];
    if (!option) {
      continue;
    }
    const active = index === selectedIndex;
    const prefix = active ? theme.fg("accent", "> ") : "  ";
    add(prefix + theme.fg(active ? "accent" : "text", `${index + 1}. ${option.label}`));
    if (option.description) {
      add(`     ${theme.fg("muted", option.description)}`);
    }
  }
  lines.push("");
  add(theme.fg("dim", " ↑↓ navigate • Enter to select • Esc to cancel"));
}
