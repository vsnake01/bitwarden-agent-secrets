import { loadPolicy } from "../config/load-policy.js";
import { savePolicy } from "../config/save-policy.js";
import { CliError } from "../errors/cli-error.js";
import { writeStdout } from "../utils/io.js";

export async function runPolicyRemove(args: string[]): Promise<void> {
  const alias = args[0];
  if (!alias) {
    throw new CliError(64, "Usage: bitwarden-agent-secrets policy remove <alias>");
  }

  const policy = await loadPolicy();
  if (!policy.secrets[alias]) {
    throw new CliError(2, `Unknown policy alias: ${alias}`);
  }

  delete policy.secrets[alias];
  await savePolicy(policy);
  await writeStdout(`Removed policy alias ${alias}.\n`);
}
