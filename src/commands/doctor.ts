import { stat } from "node:fs/promises";

import { BitwardenClient } from "../bitwarden/client.js";
import { loadConfig } from "../config/load-config.js";
import { loadPolicy } from "../config/load-policy.js";
import { getAuditLogPath, getConfigPath, getPolicyPath } from "../config/paths.js";
import { resolveProfile } from "../runtime/resolve-profile.js";

export async function runDoctor(_args: string[]): Promise<void> {
  const config = await loadConfig();
  const policy = await loadPolicy();
  const { profileName, profile } = resolveProfile(config);
  const client = new BitwardenClient(profile);

  await stat(getConfigPath());
  await stat(getPolicyPath()).catch(() => undefined);
  await stat(getAuditLogPath()).catch(() => undefined);
  await client.ping();

  process.stdout.write("Doctor checks passed.\n");
  process.stdout.write(`Default profile: ${profileName}\n`);
  process.stdout.write(`Configured aliases: ${Object.keys(policy.secrets).length}\n`);
}
