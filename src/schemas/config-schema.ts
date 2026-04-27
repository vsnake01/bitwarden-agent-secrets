export type CredentialStoreType = "keychain" | "file";

export interface KeychainCredentialStore {
  type: "keychain";
  service: string;
  account: string;
}

export interface FileCredentialStore {
  type: "file";
  path: string;
}

export type CredentialStoreRef = KeychainCredentialStore | FileCredentialStore;

export interface ProfileConfig {
  apiUrl?: string;
  identityUrl?: string;
  organizationId?: string;
  credentialStore: CredentialStoreRef;
}

export interface ResolvedProfileConfig extends ProfileConfig {
  accessToken: string;
}

export interface ConfigFile {
  version: number;
  defaultProfile: string;
  profiles: Record<string, ProfileConfig>;
}
