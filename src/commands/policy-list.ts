import { loadPolicy } from "../config/load-policy.js";
import { writeStdout } from "../utils/io.js";

export async function runPolicyList(_args: string[]): Promise<void> {
  const policy = await loadPolicy();
  const aliases = Object.entries(policy.secrets);

  if (aliases.length === 0) {
    await writeStdout("No policy aliases configured.\n");
    return;
  }

  const lines = aliases.map(([alias, secret]) => {
    const profiles = secret.profiles.join(",");
    return `${alias}  mode=${secret.mode} env=${secret.envName} profiles=${profiles} secretId=${secret.secretId}`;
  });
  await writeStdout(`${lines.join("\n")}\n`);
}
