import { loadPolicy } from "../config/load-policy.js";
import { savePolicy } from "../config/save-policy.js";
import { CliError } from "../errors/cli-error.js";
import type { SecretMode } from "../schemas/policy-schema.js";

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
  };
  await savePolicy(policy);
  process.stdout.write(`Added policy alias ${alias}.\n`);
}

function readFlagValue(args: string[], flagName: string): string | undefined {
  const index = args.indexOf(flagName);
  if (index === -1) {
    return undefined;
  }
  return args[index + 1];
}

function readRepeatedFlagValues(args: string[], flagName: string): string[] {
  const values: string[] = [];
  for (let index = 0; index < args.length; index += 1) {
    if (args[index] === flagName && args[index + 1]) {
      values.push(args[index + 1]);
      index += 1;
    }
  }
  return values;
}
