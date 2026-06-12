import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { registerCoworkCommand } from "./command.js";

export default function (pi: ExtensionAPI) {
  registerCoworkCommand(pi);
}
