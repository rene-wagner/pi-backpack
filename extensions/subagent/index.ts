import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { registerSubagentTool } from "./tool.js";

export default function (pi: ExtensionAPI) {
  registerSubagentTool(pi);
}
