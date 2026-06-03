import { test } from "node:test";
import assert from "node:assert/strict";
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

  assert.deepEqual(options, [
    { label: "A" },
    { label: "B", value: "b", description: "second" },
  ]);
});

test("buildDisplayOptions appends custom option only when allowText is true", () => {
  const base = [{ label: "A" }];

  assert.deepEqual(buildDisplayOptions(base, false), [{ label: "A" }]);
  assert.deepEqual(buildDisplayOptions(base, true), [
    { label: "A" },
    { label: "Write a custom answer.", isCustom: true },
  ]);
});

test("createCancelledDetails returns a cancelled result shape", () => {
  assert.deepEqual(createCancelledDetails("Q?", [{ label: "A" }]), {
    question: "Q?",
    options: [{ label: "A" }],
    answer: null,
    value: null,
    wasCustom: false,
    cancelled: true,
  });
});
