import { readFile } from "node:fs/promises";

import { CliError } from "../errors/cli-error.js";
import type { PolicyFile } from "../schemas/policy-schema.js";
import { getPolicyPath } from "./paths.js";

export async function loadPolicy(): Promise<PolicyFile> {
  try {
    const raw = await readFile(getPolicyPath(), "utf8");
    const policy = JSON.parse(raw) as PolicyFile;
    validatePolicy(policy);
    return policy;
  } catch (error) {
    if (error instanceof CliError) {
      throw error;
    }
    throw new CliError(1, `Failed to load policy from ${getPolicyPath()}.`);
  }
}

function validatePolicy(policy: PolicyFile): void {
  if (!policy || typeof policy !== "object") {
    throw new CliError(2, "Invalid policy file.");
  }
  if (!policy.secrets || typeof policy.secrets !== "object") {
    throw new CliError(2, "Policy is missing secrets.");
  }
}
