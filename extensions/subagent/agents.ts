import * as fs from "node:fs";
import * as path from "node:path";
import { parseFrontmatter } from "@earendil-works/pi-coding-agent";

export interface CustomAgentConfig {
  name: string;
  description: string;
  tools?: string[];
  model?: string;
  cwd?: string;
  systemPrompt: string;
  filePath: string;
}

export interface CustomAgentDiscoveryResult {
  agents: CustomAgentConfig[];
  agentsDir: string | null;
}

function isDirectory(candidate: string): boolean {
  try {
    return fs.statSync(candidate).isDirectory();
  } catch {
    return false;
  }
}

export function findNearestProjectAgentsDir(cwd: string): string | null {
  let current = path.resolve(cwd);

  while (true) {
    const candidate = path.join(current, ".pi", "agents");
    if (isDirectory(candidate)) return candidate;

    const parent = path.dirname(current);
    if (parent === current) return null;
    current = parent;
  }
}

function asString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function asTools(value: unknown): string[] | undefined {
  if (Array.isArray(value)) {
    const tools = value
      .map((entry) => asString(entry))
      .filter((entry): entry is string => Boolean(entry));
    return tools.length > 0 ? tools : undefined;
  }

  if (typeof value === "string") {
    const tools = value
      .split(",")
      .map((entry) => entry.trim())
      .filter(Boolean);
    return tools.length > 0 ? tools : undefined;
  }

  return undefined;
}

function loadCustomAgentsFromDir(dir: string): CustomAgentConfig[] {
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return [];
  }

  const agents: CustomAgentConfig[] = [];

  entries.sort((a, b) => a.name.localeCompare(b.name));

  for (const entry of entries) {
    if (!entry.name.endsWith(".md")) continue;
    if (!entry.isFile() && !entry.isSymbolicLink()) continue;

    const filePath = path.join(dir, entry.name);
    let content: string;
    try {
      content = fs.readFileSync(filePath, "utf8");
    } catch {
      continue;
    }

    const { frontmatter, body } = parseFrontmatter(content);
    const name = asString(frontmatter.name);
    const description = asString(frontmatter.description);
    if (!name || !description) continue;

    const tools = asTools(frontmatter.tools);
    const model = asString(frontmatter.model);
    const cwd = asString(frontmatter.cwd);

    agents.push({
      name,
      description,
      systemPrompt: body,
      filePath,
      ...(tools ? { tools } : {}),
      ...(model ? { model } : {}),
      ...(cwd ? { cwd } : {}),
    });
  }

  return agents;
}

export function discoverCustomAgents(cwd: string): CustomAgentDiscoveryResult {
  const agentsDir = findNearestProjectAgentsDir(cwd);
  if (!agentsDir) return { agents: [], agentsDir: null };
  return { agents: loadCustomAgentsFromDir(agentsDir), agentsDir };
}

export function formatCustomAgentsForPrompt(agents: CustomAgentConfig[]): string {
  return agents
    .map((agent) => `- ${agent.name}: ${agent.description}`)
    .join("\n");
}
