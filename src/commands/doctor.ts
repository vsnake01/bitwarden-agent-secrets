import { stat } from "node:fs/promises";

import { BitwardenClient } from "../bitwarden/client.js";
import { loadConfig } from "../config/load-config.js";
import { loadPolicy } from "../config/load-policy.js";
import { getAuditLogPath, getConfigPath, getPolicyPath } from "../config/paths.js";
import { resolveProfileCredentials } from "../runtime/resolve-profile-credentials.js";
import { resolveProfile } from "../runtime/resolve-profile.js";
import { readFlagValue } from "../utils/args.js";
import { writeStdout } from "../utils/io.js";

export async function runDoctor(args: string[]): Promise<void> {
  const config = await loadConfig();
  const policy = await loadPolicy();
  const { profileName, profile } = resolveProfile(config, readFlagValue(args, "--profile"));
  const resolvedProfile = await resolveProfileCredentials(profile);
  const client = new BitwardenClient(resolvedProfile);

  await stat(getConfigPath());
  await stat(getPolicyPath()).catch(() => undefined);
  await stat(getAuditLogPath()).catch(() => undefined);
  await client.ping();

  await writeStdout("Doctor checks passed.\n");
  await writeStdout(`Profile: ${profileName}\n`);
  await writeStdout(`Credential store: ${profile.credentialStore.type}\n`);
  await writeStdout(`Configured aliases: ${Object.keys(policy.secrets).length}\n`);
}
