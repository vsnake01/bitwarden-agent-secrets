import { loadPolicy } from "../config/load-policy.js";
import { savePolicy } from "../config/save-policy.js";
import { CliError } from "../errors/cli-error.js";
import type { SecretMode } from "../schemas/policy-schema.js";
import { writeStderr, writeStdout } from "../utils/io.js";
import { readFlagValue, readRepeatedFlagValues } from "../utils/args.js";

const DANGEROUS_ALLOWED_COMMANDS = new Set([
  "sh",
  "bash",
  "zsh",
  "fish",
  "python",
  "python3",
  "node",
  "ruby",
  "perl",
  "env",
]);

export async function runPolicyAdd(args: string[]): Promise<void> {
  const alias = args[0];
  if (!alias) {
    throw new CliError(
      64,
      "Usage: bitwarden-agent-secrets policy add <alias> --secret-id <id> --mode <env|file> --env <ENV> --profile <name>",
    );
  }

  const secretId = readFlagValue(args, "--secret-id");
  const mode = readFlagValue(args, "--mode") as SecretMode | undefined;
  const envName = readFlagValue(args, "--env");
  const profiles = readRepeatedFlagValues(args, "--profile");
  const allowedCommands = readRepeatedFlagValues(args, "--allowed-command");

  if (!secretId || !mode || !envName || profiles.length === 0) {
    throw new CliError(
      64,
      "Missing required flags. Expected --secret-id, --mode, --env, and at least one --profile.",
    );
  }
  if (mode !== "env" && mode !== "file") {
    throw new CliError(64, "Mode must be either env or file.");
  }

  const policy = await loadPolicy();
  policy.secrets[alias] = {
    secretId,
    mode,
    envName,
    profiles,
    requiresApproval: args.includes("--requires-approval"),
    ...(allowedCommands.length > 0 ? { allowedCommands } : {}),
  };
  await savePolicy(policy);

  for (const command of allowedCommands) {
    if (DANGEROUS_ALLOWED_COMMANDS.has(command)) {
      await writeStderr(
        `Warning: allowed command '${command}' effectively allows arbitrary execution.\n`,
      );
    }
  }

  await writeStdout(`Added policy alias ${alias}.\n`);
}
