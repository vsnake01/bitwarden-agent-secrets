import { CliError } from "../errors/cli-error.js";
import type { ConfigFile, ProfileConfig } from "../schemas/config-schema.js";

export function resolveProfile(
  config: ConfigFile,
  profileName?: string,
): { profileName: string; profile: ProfileConfig } {
  const selectedName = profileName ?? config.defaultProfile;
  const profile = config.profiles[selectedName];

  if (!profile) {
    throw new CliError(2, `Unknown profile: ${selectedName}`);
  }

  return { profileName: selectedName, profile };
}
