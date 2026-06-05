import { expect, test } from "vitest";
import {
  buildDisplayOptions,
  createCancelledDetails,
  normalizeOptions,
} from "../extensions/ask-user/types.js";

test("normalizeOptions drops undefined optional fields", () => {
  const options = normalizeOptions([
    { label: "A" },
    { label: "B", value: "b", description: "second" },
  ]);

  expect(options).toEqual([
    { label: "A" },
    { label: "B", value: "b", description: "second" },
  ]);
});

test("buildDisplayOptions appends custom option only when allowText is true", () => {
  const base = [{ label: "A" }];

  expect(buildDisplayOptions(base, false)).toEqual([{ label: "A" }]);
  expect(buildDisplayOptions(base, true)).toEqual([
    { label: "A" },
    { label: "Write a custom answer.", isCustom: true },
  ]);
});

test("createCancelledDetails returns a cancelled result shape", () => {
  expect(createCancelledDetails("Q?", [{ label: "A" }])).toEqual({
    question: "Q?",
    options: [{ label: "A" }],
    answer: null,
    value: null,
    wasCustom: false,
    cancelled: true,
  });
});
