import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { registerAskUserTool } from "./tool.js";

export default function (pi: ExtensionAPI) {
  registerAskUserTool(pi);
}
