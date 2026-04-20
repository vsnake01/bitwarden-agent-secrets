import { BitwardenClient } from "../bitwarden/client.js";
import { writeAuditRecord } from "../audit/logger.js";
import { loadConfig } from "../config/load-config.js";
import { loadPolicy } from "../config/load-policy.js";
import { CliError } from "../errors/cli-error.js";
import { checkCommandAllowed } from "../runtime/check-command.js";
import { parseRuntimeArgs } from "../runtime/parse-runtime-args.js";
import { resolveProfileCredentials } from "../runtime/resolve-profile-credentials.js";
import { resolveProfile } from "../runtime/resolve-profile.js";
import { runCommand } from "../runtime/run-command.js";
import { formatError } from "../errors/cli-error.js";

export async function runExec(args: string[]): Promise<void> {
  const parsed = parseRuntimeArgs(args, "--map");
  const config = await loadConfig();
  const policy = await loadPolicy();
  const { profileName, profile } = resolveProfile(config, parsed.profileName);
  const resolvedProfile = await resolveProfileCredentials(profile);
  const client = new BitwardenClient(profileName, resolvedProfile);
  const env: Record<string, string> = {};
  const aliases = parsed.mappings.map((entry) => entry.alias);
  let result: "success" | "failure" | "policy_violation" | "fetch_error" = "failure";
  let exitCode = 1;
  let errorKind: string | undefined;
  let allowedCommand: "pass" | "fail" | "unrestricted" = "unrestricted";

  try {
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

      const commandPolicy = checkCommandAllowed(mapping.alias, parsed.command, secret);
      if (allowedCommand === "unrestricted" || commandPolicy === "pass") {
        allowedCommand = commandPolicy;
      }

      env[mapping.envName] = await client.getSecret(secret.secretId);
    }

    exitCode = await runCommand(parsed.command, env);
    result = exitCode === 0 ? "success" : "failure";
    process.exitCode = exitCode;
  } catch (error) {
    const cliError = formatError(error);
    exitCode = cliError.exitCode;
    errorKind = error instanceof Error ? error.name : "UnknownError";
    if (cliError.exitCode === 65) {
      result = "policy_violation";
      if (allowedCommand !== "pass") {
        allowedCommand = "fail";
      }
    } else {
      result = "fetch_error";
    }
    throw error;
  } finally {
    await writeAuditRecord({
      ts: new Date().toISOString(),
      profile: profileName,
      alias: aliases.join(","),
      aliases,
      mode: "env",
      command: parsed.command.join(" "),
      result,
      exitCode,
      errorKind,
      allowedCommand,
    });
  }
}
