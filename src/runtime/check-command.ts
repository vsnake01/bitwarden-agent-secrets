import path from "node:path";

import { CliError } from "../errors/cli-error.js";
import type { SecretPolicy } from "../schemas/policy-schema.js";

export function checkCommandAllowed(
  alias: string,
  command: string[],
  policy: SecretPolicy,
): "pass" | "unrestricted" {
  if (!policy.allowedCommands || policy.allowedCommands.length === 0) {
    return "unrestricted";
  }

  const commandBase = path.basename(command[0]);
  if (!policy.allowedCommands.includes(commandBase)) {
    throw new CliError(
      65,
      `Alias ${alias} is not allowed for command '${commandBase}'. Allowed: ${policy.allowedCommands.join(", ")}.`,
    );
  }

  return "pass";
}
