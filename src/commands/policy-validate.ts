import { assertValidPolicy, loadPolicy } from "../config/load-policy.js";
import { writeStdout } from "../utils/io.js";

export async function runPolicyValidate(_args: string[]): Promise<void> {
  const policy = await loadPolicy();
  assertValidPolicy(policy);
  await writeStdout(`Policy is valid. Aliases: ${Object.keys(policy.secrets).length}\n`);
}
