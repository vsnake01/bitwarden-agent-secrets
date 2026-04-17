export type SecretMode = "env" | "file";

export interface SecretPolicy {
  secretId: string;
  mode: SecretMode;
  envName: string;
  profiles: string[];
  requiresApproval: boolean;
}

export interface PolicyFile {
  version: number;
  allowReveal: boolean;
  secrets: Record<string, SecretPolicy>;
}
