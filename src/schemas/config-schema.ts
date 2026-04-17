export interface ProfileConfig {
  accessToken: string;
  apiUrl?: string;
  identityUrl?: string;
}

export interface ConfigFile {
  version: number;
  defaultProfile: string;
  profiles: Record<string, ProfileConfig>;
}
