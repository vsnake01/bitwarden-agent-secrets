import { loadPolicy } from "../config/load-policy.js";

export async function runPolicyList(_args: string[]): Promise<void> {
  const policy = await loadPolicy();
  const aliases = Object.entries(policy.secrets);

  if (aliases.length === 0) {
    process.stdout.write("No policy aliases configured.\n");
    return;
  }

  const lines = aliases.map(([alias, secret]) => {
    const profiles = secret.profiles.join(",");
    return `${alias}  mode=${secret.mode} env=${secret.envName} profiles=${profiles} secretId=${secret.secretId}`;
  });
  process.stdout.write(`${lines.join("\n")}\n`);
}
