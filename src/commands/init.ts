import { readFile } from "node:fs/promises";
import process from "node:process";

import { saveConfig } from "../config/save-config.js";
import { getPolicyPath } from "../config/paths.js";
import { CliError } from "../errors/cli-error.js";
import type { ConfigFile } from "../schemas/config-schema.js";
import { chmodSafe } from "../security/permissions.js";

const CLOUD_API_URL = "https://api.bitwarden.com";
const CLOUD_IDENTITY_URL = "https://identity.bitwarden.com";

export async function runInit(args: string[]): Promise<void> {
  const profileName = readFlagValue(args, "--profile") ?? "default";
  const tokenFromStdin = args.includes("--access-token-stdin");
  const accessToken = tokenFromStdin ? await readStdin() : readEnvToken();

  if (!accessToken) {
    throw new CliError(
      2,
      "Missing access token. Use BWS_ACCESS_TOKEN for now or `--access-token-stdin`.",
    );
  }

  const apiUrl = readFlagValue(args, "--api-url") ?? CLOUD_API_URL;
  const identityUrl = readFlagValue(args, "--identity-url") ?? CLOUD_IDENTITY_URL;

  const config: ConfigFile = {
    version: 1,
    defaultProfile: profileName,
    profiles: {
      [profileName]: {
        accessToken,
        apiUrl,
        identityUrl,
      },
    },
  };

  await saveConfig(config);
  await ensurePolicyTemplate();
  process.stdout.write(`Initialized profile ${profileName}.\n`);
}

function readFlagValue(args: string[], flagName: string): string | undefined {
  const index = args.indexOf(flagName);
  if (index === -1) {
    return undefined;
  }

  return args[index + 1];
}

function readEnvToken(): string | undefined {
  return process.env.BWS_ACCESS_TOKEN;
}

async function readStdin(): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) {
    chunks.push(Buffer.from(chunk));
  }
  return Buffer.concat(chunks).toString("utf8").trim();
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
