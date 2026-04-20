export type SecretMode = "env" | "file";

export interface SecretPolicy {
  secretId: string;
  mode: SecretMode;
  envName: string;
  profiles: string[];
  requiresApproval: boolean;
  allowedCommands?: string[];
}

export interface PolicyFile {
  version: number;
  secrets: Record<string, SecretPolicy>;
}
