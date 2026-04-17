import os from "node:os";
import path from "node:path";

export function getConfigDir(): string {
  return path.join(os.homedir(), ".config", "bitwarden-agent-secrets");
}

export function getConfigPath(): string {
  return path.join(getConfigDir(), "config.json");
}

export function getPolicyPath(): string {
  return path.join(getConfigDir(), "policy.json");
}

export function getAuditLogPath(): string {
  return path.join(getConfigDir(), "audit.log");
}
