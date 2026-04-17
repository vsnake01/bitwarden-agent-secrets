import os from "node:os";
import path from "node:path";

export function getConfigDir(): string {
  return path.join(os.homedir(), ".config", "bitwarden-agent-secrets");
}

export function getStateDir(): string {
  return path.join(os.homedir(), ".local", "state", "bitwarden-agent-secrets");
}

export function getRuntimeTempRoot(): string {
  return path.join(getStateDir(), "tmp");
}

export function getCredentialDir(): string {
  return path.join(getConfigDir(), "credentials");
}

export function getCredentialFilePath(profileName: string): string {
  return path.join(getCredentialDir(), `${profileName}.token`);
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
