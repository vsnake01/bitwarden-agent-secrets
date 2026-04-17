import { assertValidPolicy, loadPolicy } from "../config/load-policy.js";

export async function runPolicyValidate(_args: string[]): Promise<void> {
  const policy = await loadPolicy();
  assertValidPolicy(policy);
  process.stdout.write(`Policy is valid. Aliases: ${Object.keys(policy.secrets).length}\n`);
}
