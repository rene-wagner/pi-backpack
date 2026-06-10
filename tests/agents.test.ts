import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, expect, test } from "vitest";
import {
  discoverCustomAgents,
  findNearestProjectAgentsDir,
  formatCustomAgentsForPrompt,
} from "../extensions/subagent/agents.js";

const tempDirs: string[] = [];

function makeTempProject() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "pi-backpack-agents-"));
  tempDirs.push(dir);
  return dir;
}

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("discovers custom agents from nearest .pi/agents directory", () => {
  const project = makeTempProject();
  const agentsDir = path.join(project, ".pi", "agents");
  const nested = path.join(project, "packages", "app");
  fs.mkdirSync(agentsDir, { recursive: true });
  fs.mkdirSync(nested, { recursive: true });

  fs.writeFileSync(
    path.join(agentsDir, "reviewer.md"),
    `---\nname: reviewer\ndescription: Reviews code.\ntools: [read, bash]\nmodel: test-model\ncwd: packages/app\n---\n\nYou review code.\n`,
  );
  fs.writeFileSync(
    path.join(agentsDir, "invalid.md"),
    `---\nname: missing-description\n---\n\nIgnored.\n`,
  );

  expect(findNearestProjectAgentsDir(nested)).toBe(agentsDir);

  const result = discoverCustomAgents(nested);
  expect(result.agentsDir).toBe(agentsDir);
  expect(result.agents).toEqual([
    {
      name: "reviewer",
      description: "Reviews code.",
      tools: ["read", "bash"],
      model: "test-model",
      cwd: "packages/app",
      systemPrompt: "You review code.",
      filePath: path.join(agentsDir, "reviewer.md"),
    },
  ]);
});

test("formats custom agents for the system prompt", () => {
  expect(
    formatCustomAgentsForPrompt([
      {
        name: "reviewer",
        description: "Reviews code.",
        systemPrompt: "prompt",
        filePath: "/tmp/reviewer.md",
      },
    ]),
  ).toBe("- reviewer: Reviews code.");
});
