import { readFile } from "node:fs/promises";

import { CliError } from "../errors/cli-error.js";
import type { PolicyFile } from "../schemas/policy-schema.js";
import { getPolicyPath } from "./paths.js";

export async function loadPolicy(): Promise<PolicyFile> {
  try {
    const raw = await readFile(getPolicyPath(), "utf8");
    const policy = normalizePolicy(JSON.parse(raw) as PolicyFile & { allowReveal?: boolean });
    validatePolicy(policy);
    return policy;
  } catch (error) {
    if (error instanceof CliError) {
      throw error;
    }
    throw new CliError(1, `Failed to load policy from ${getPolicyPath()}.`);
  }
}

function normalizePolicy(policy: PolicyFile & { allowReveal?: boolean }): PolicyFile {
  return {
    version: policy.version ?? 1,
    secrets: policy.secrets ?? {},
  };
}

function validatePolicy(policy: PolicyFile): void {
  if (!policy || typeof policy !== "object") {
    throw new CliError(2, "Invalid policy file.");
  }
  if (!policy.secrets || typeof policy.secrets !== "object") {
    throw new CliError(2, "Policy is missing secrets.");
  }
}

export function assertValidPolicy(policy: PolicyFile): void {
  validatePolicy(policy);

  for (const [alias, secret] of Object.entries(policy.secrets)) {
    if (!secret.secretId) {
      throw new CliError(2, `Policy alias ${alias} is missing secretId.`);
    }
    if (secret.mode !== "env" && secret.mode !== "file") {
      throw new CliError(2, `Policy alias ${alias} has invalid mode.`);
    }
    if (!secret.envName) {
      throw new CliError(2, `Policy alias ${alias} is missing envName.`);
    }
    if (!Array.isArray(secret.profiles) || secret.profiles.length === 0) {
      throw new CliError(2, `Policy alias ${alias} must define at least one profile.`);
    }
    if (secret.allowedCommands !== undefined) {
      if (!Array.isArray(secret.allowedCommands)) {
        throw new CliError(2, `Policy alias ${alias} has invalid allowedCommands.`);
      }
      if (secret.allowedCommands.some((command) => typeof command !== "string" || !command.trim())) {
        throw new CliError(2, `Policy alias ${alias} has invalid allowedCommands.`);
      }
    }
  }
}
