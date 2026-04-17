import { readFile, stat } from "node:fs/promises";
import process from "node:process";

import { loadConfig } from "../config/load-config.js";
import { getConfigPath, getPolicyPath } from "../config/paths.js";
import { saveConfig } from "../config/save-config.js";
import {
  buildCredentialStoreRef,
  getDefaultCredentialStoreType,
  saveAccessToken,
} from "../credentials/store.js";
import { CliError } from "../errors/cli-error.js";
import type { ConfigFile, CredentialStoreType } from "../schemas/config-schema.js";
import { chmodSafe } from "../security/permissions.js";
import { readFlagValue, readTokenFromArgsOrEnv } from "../utils/args.js";

const CLOUD_API_URL = "https://api.bitwarden.com";
const CLOUD_IDENTITY_URL = "https://identity.bitwarden.com";

export async function runInit(args: string[]): Promise<void> {
  const profileName = readFlagValue(args, "--profile") ?? "default";
  const accessToken = await readTokenFromArgsOrEnv(args);
  const credentialStoreType =
    (readFlagValue(args, "--credential-store") as CredentialStoreType | undefined) ??
    getDefaultCredentialStoreType();

  if (!accessToken) {
    throw new CliError(
      2,
      "Missing access token. Use BWS_ACCESS_TOKEN for now or `--access-token-stdin`.",
    );
  }

  const apiUrl = readFlagValue(args, "--api-url") ?? CLOUD_API_URL;
  const identityUrl = readFlagValue(args, "--identity-url") ?? CLOUD_IDENTITY_URL;
  const credentialStore = buildCredentialStoreRef(profileName, credentialStoreType);

  await saveAccessToken(credentialStore, accessToken);
  const existingConfig = await loadExistingConfig();

  const config: ConfigFile = {
    version: 1,
    defaultProfile: profileName,
    profiles: {
      ...existingConfig?.profiles,
      [profileName]: {
        ...(existingConfig?.profiles[profileName] ?? {}),
        apiUrl,
        identityUrl,
        credentialStore,
      },
    },
  };

  await saveConfig(config);
  await ensurePolicyTemplate();
  process.stdout.write(
    `Initialized profile ${profileName} using credential store ${credentialStore.type}.\n`,
  );
}

async function ensurePolicyTemplate(): Promise<void> {
  try {
    await readFile(getPolicyPath(), "utf8");
  } catch {
    const template = {
      version: 1,
      allowReveal: false,
      secrets: {},
    };
    await import("node:fs/promises").then(({ writeFile }) =>
      writeFile(getPolicyPath(), `${JSON.stringify(template, null, 2)}\n`, {
        mode: 0o600,
      }),
    );
    await chmodSafe(getPolicyPath(), 0o600);
  }
}

async function loadExistingConfig(): Promise<ConfigFile | undefined> {
  try {
    await stat(getConfigPath());
  } catch {
    return undefined;
  }

  return loadConfig();
}
