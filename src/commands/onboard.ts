import { stat } from "node:fs/promises";

import { loadConfig } from "../config/load-config.js";
import { getConfigPath } from "../config/paths.js";
import { saveConfig } from "../config/save-config.js";
import {
  buildCredentialStoreRef,
  getDefaultCredentialStoreType,
} from "../credentials/store.js";
import { CliError } from "../errors/cli-error.js";
import type { ConfigFile, CredentialStoreType } from "../schemas/config-schema.js";
import { readFlagValue } from "../utils/args.js";
import { writeStdout } from "../utils/io.js";
import { confirmPrompt, promptLine } from "../utils/prompts.js";
import { runInit } from "./init.js";
import { runPolicySetup } from "./policy-setup.js";

const CLOUD_API_URL = "https://api.bitwarden.com";
const CLOUD_IDENTITY_URL = "https://identity.bitwarden.com";

export async function runOnboard(args: string[]): Promise<void> {
  const existingConfig = await loadExistingConfig();
  const profileName =
    readFlagValue(args, "--profile") ?? existingConfig?.defaultProfile ?? "default";
  const existingProfile = existingConfig?.profiles[profileName];
  const credentialStoreType =
    (readFlagValue(args, "--credential-store") as CredentialStoreType | undefined) ??
    existingProfile?.credentialStore.type ??
    getDefaultCredentialStoreType();
  const organizationId = await resolveOnboardingOrganizationId(
    readFlagValue(args, "--organization-id"),
    existingProfile?.organizationId,
    args.includes("--skip-policy"),
  );
  const skipToken = args.includes("--skip-token");
  const skipPolicy = args.includes("--skip-policy");
  const dryRun = args.includes("--dry-run");
  const yes = args.includes("--yes");

  await writeStdout(`Onboarding profile ${profileName}\n\n`);

  const shouldInitialize = await shouldInitializeProfile(args, !!existingProfile, skipToken);
  if (shouldInitialize) {
    await runInit(buildInitArgs(args, profileName, credentialStoreType, organizationId));
  } else if (!existingProfile) {
    throw new CliError(64, "Cannot use --skip-token before the profile is initialized.");
  } else {
    await updateExistingProfile({
      config: existingConfig,
      profileName,
      credentialStoreType,
      organizationId,
      args,
    });
    await writeStdout(`Using existing profile ${profileName}.\n`);
  }

  if (skipPolicy) {
    await writeStdout("\nOnboarding complete.\n");
    return;
  }

  await runPolicySetup(buildPolicySetupArgs(profileName, organizationId, dryRun, yes));
  await writeStdout("Onboarding complete.\n");
}

async function resolveOnboardingOrganizationId(
  argumentOrganizationId: string | undefined,
  profileOrganizationId: string | undefined,
  skipPolicy: boolean,
): Promise<string | undefined> {
  if (argumentOrganizationId) {
    return argumentOrganizationId;
  }

  if (profileOrganizationId) {
    return profileOrganizationId;
  }

  if (skipPolicy) {
    return undefined;
  }

  const answer = await promptLine("Bitwarden organization ID: ");
  return answer.trim() || undefined;
}

async function shouldInitializeProfile(
  args: string[],
  profileExists: boolean,
  skipToken: boolean,
): Promise<boolean> {
  if (skipToken) {
    return false;
  }

  if (!profileExists) {
    return true;
  }

  if (
    args.includes("--access-token-stdin") ||
    args.includes("--access-token-prompt") ||
    process.env.BWS_ACCESS_TOKEN
  ) {
    return true;
  }

  if (args.includes("--yes") || !process.stdin.isTTY) {
    return false;
  }

  return confirmPrompt("Replace stored Bitwarden access token?");
}

function buildInitArgs(
  args: string[],
  profileName: string,
  credentialStoreType: CredentialStoreType,
  organizationId: string | undefined,
): string[] {
  const initArgs = [
    "--profile",
    profileName,
    "--credential-store",
    credentialStoreType,
  ];

  appendFlagValue(initArgs, "--organization-id", organizationId);
  appendFlagValue(initArgs, "--api-url", readFlagValue(args, "--api-url"));
  appendFlagValue(initArgs, "--identity-url", readFlagValue(args, "--identity-url"));

  if (args.includes("--set-default")) {
    initArgs.push("--set-default");
  }

  if (args.includes("--access-token-stdin")) {
    initArgs.push("--access-token-stdin");
  } else if (args.includes("--access-token-prompt") || !process.env.BWS_ACCESS_TOKEN) {
    initArgs.push("--access-token-prompt");
  }

  return initArgs;
}

async function updateExistingProfile({
  config,
  profileName,
  credentialStoreType,
  organizationId,
  args,
}: {
  config: ConfigFile | undefined;
  profileName: string;
  credentialStoreType: CredentialStoreType;
  organizationId: string | undefined;
  args: string[];
}): Promise<void> {
  if (!config?.profiles[profileName]) {
    return;
  }

  config.profiles[profileName] = {
    ...config.profiles[profileName],
    apiUrl: readFlagValue(args, "--api-url") ?? config.profiles[profileName].apiUrl ?? CLOUD_API_URL,
    identityUrl:
      readFlagValue(args, "--identity-url") ??
      config.profiles[profileName].identityUrl ??
      CLOUD_IDENTITY_URL,
    ...(organizationId ? { organizationId } : {}),
    credentialStore: buildCredentialStoreRef(profileName, credentialStoreType),
  };

  if (args.includes("--set-default")) {
    config.defaultProfile = profileName;
  }

  await saveConfig(config);
}

function buildPolicySetupArgs(
  profileName: string,
  organizationId: string | undefined,
  dryRun: boolean,
  yes: boolean,
): string[] {
  const policyArgs = ["--profile", profileName, "--interactive"];
  appendFlagValue(policyArgs, "--organization-id", organizationId);

  if (dryRun) {
    policyArgs.push("--dry-run");
    return policyArgs;
  }

  if (yes) {
    policyArgs.push("--apply", "--yes");
  }

  return policyArgs;
}

function appendFlagValue(args: string[], flagName: string, value: string | undefined): void {
  if (value) {
    args.push(flagName, value);
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
