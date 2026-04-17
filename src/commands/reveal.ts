import { loadPolicy } from "../config/load-policy.js";
import { CliError } from "../errors/cli-error.js";

export async function runReveal(args: string[]): Promise<void> {
  const alias = args[0];
  if (!alias) {
    throw new CliError(64, "Usage: bitwarden-agent-secrets reveal <alias>");
  }

  const policy = await loadPolicy();
  if (!policy.allowReveal) {
    throw new CliError(65, "Reveal is disabled by policy.");
  }

  throw new CliError(1, `Reveal is not implemented yet for alias ${alias}.`);
}
