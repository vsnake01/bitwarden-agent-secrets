import { loadConfig } from "../config/load-config.js";
import { saveConfig } from "../config/save-config.js";
import {
  buildCredentialStoreRef,
  deleteAccessToken,
  saveAccessToken,
} from "../credentials/store.js";
import { CliError } from "../errors/cli-error.js";
import type { CredentialStoreType } from "../schemas/config-schema.js";
import { readFlagValue, readTokenFromArgsOrEnv } from "../utils/args.js";

export async function runProfileRotateToken(args: string[]): Promise<void> {
  const name = args[0];
  if (!name) {
    throw new CliError(
      64,
      "Usage: bitwarden-agent-secrets profile rotate-token <name> [--credential-store keychain|file]",
    );
  }

  const accessToken = await readTokenFromArgsOrEnv(args);
  if (!accessToken) {
    throw new CliError(
      2,
      "Missing access token. Use BWS_ACCESS_TOKEN for now or `--access-token-stdin`.",
    );
  }

  const config = await loadConfig();
  const existingProfile = config.profiles[name];
  if (!existingProfile) {
    throw new CliError(2, `Unknown profile: ${name}`);
  }

  const requestedStoreType = readFlagValue(args, "--credential-store") as
    | CredentialStoreType
    | undefined;
  const targetStore =
    requestedStoreType !== undefined
      ? buildCredentialStoreRef(name, requestedStoreType)
      : existingProfile.credentialStore;
  const previousStore = existingProfile.credentialStore;

  await saveAccessToken(targetStore, accessToken);

  config.profiles[name] = {
    ...existingProfile,
    credentialStore: targetStore,
  };
  await saveConfig(config);

  if (
    previousStore.type !== targetStore.type ||
    (previousStore.type === "file" &&
      targetStore.type === "file" &&
      previousStore.path !== targetStore.path)
  ) {
    await deleteAccessToken(previousStore);
  }

  process.stdout.write(`Rotated token for profile ${name} using ${targetStore.type}.\n`);
}
