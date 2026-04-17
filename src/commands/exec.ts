import { BitwardenClient } from "../bitwarden/client.js";
import { writeAuditRecord } from "../audit/logger.js";
import { loadConfig } from "../config/load-config.js";
import { loadPolicy } from "../config/load-policy.js";
import { CliError } from "../errors/cli-error.js";
import { parseRuntimeArgs } from "../runtime/parse-runtime-args.js";
import { resolveProfileCredentials } from "../runtime/resolve-profile-credentials.js";
import { resolveProfile } from "../runtime/resolve-profile.js";
import { runCommand } from "../runtime/run-command.js";

export async function runExec(args: string[]): Promise<void> {
  const parsed = parseRuntimeArgs(args, "--map");
  const config = await loadConfig();
  const policy = await loadPolicy();
  const { profileName, profile } = resolveProfile(config, parsed.profileName);
  const resolvedProfile = await resolveProfileCredentials(profile);
  const client = new BitwardenClient(profileName, resolvedProfile);
  const env: Record<string, string> = {};

  for (const mapping of parsed.mappings) {
    const secret = policy.secrets[mapping.alias];
    if (!secret) {
      throw new CliError(65, `Alias not found in policy: ${mapping.alias}`);
    }
    if (secret.mode !== "env") {
      throw new CliError(65, `Alias ${mapping.alias} is not configured for env mode.`);
    }
    if (!secret.profiles.includes(profileName)) {
      throw new CliError(65, `Alias ${mapping.alias} is not allowed for profile ${profileName}.`);
    }

    env[mapping.envName] = await client.getSecret(secret.secretId);
  }

  const exitCode = await runCommand(parsed.command, env);
  await writeAuditRecord({
    ts: new Date().toISOString(),
    profile: profileName,
    alias: parsed.mappings.map((entry) => entry.alias).join(","),
    mode: "env",
    command: parsed.command.join(" "),
    result: exitCode === 0 ? "success" : "failure",
    exitCode,
  });
  process.exitCode = exitCode;
}
