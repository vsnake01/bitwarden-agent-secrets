import { loadAccessToken } from "../credentials/store.js";
import type { ProfileConfig, ResolvedProfileConfig } from "../schemas/config-schema.js";

export async function resolveProfileCredentials(
  profile: ProfileConfig,
): Promise<ResolvedProfileConfig> {
  const accessToken = await loadAccessToken(profile.credentialStore);
  return {
    ...profile,
    accessToken,
  };
}
