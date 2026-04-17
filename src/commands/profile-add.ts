import { loadConfig } from "../config/load-config.js";
import { saveConfig } from "../config/save-config.js";
import {
  buildCredentialStoreRef,
  getDefaultCredentialStoreType,
  saveAccessToken,
} from "../credentials/store.js";
import { CliError } from "../errors/cli-error.js";
import type { CredentialStoreType } from "../schemas/config-schema.js";
import { readFlagValue, readTokenFromArgsOrEnv } from "../utils/args.js";

export async function runProfileAdd(args: string[]): Promise<void> {
  const name = args[0];
  if (!name) {
    throw new CliError(64, "Usage: bitwarden-agent-secrets profile add <name>");
  }

  const accessToken = await readTokenFromArgsOrEnv(args);
  if (!accessToken) {
    throw new CliError(
      2,
      "Missing access token. Use BWS_ACCESS_TOKEN for now or `--access-token-stdin`.",
    );
  }
  const credentialStoreType =
    (readFlagValue(args, "--credential-store") as CredentialStoreType | undefined) ??
    getDefaultCredentialStoreType();
  const credentialStore = buildCredentialStoreRef(name, credentialStoreType);

  const config = await loadConfig();
  if (config.profiles[name]) {
    throw new CliError(2, `Profile ${name} already exists. Use profile rotate-token or init instead.`);
  }
  await saveAccessToken(credentialStore, accessToken);
  config.profiles[name] = {
    apiUrl: "https://api.bitwarden.com",
    identityUrl: "https://identity.bitwarden.com",
    credentialStore,
  };
  await saveConfig(config);
  process.stdout.write(`Added profile ${name} using credential store ${credentialStore.type}.\n`);
}
