import { execFile, spawn } from "node:child_process";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import process from "node:process";
import { promisify } from "node:util";

import { getCredentialDir, getCredentialFilePath } from "../config/paths.js";
import { CliError } from "../errors/cli-error.js";
import type {
  CredentialStoreRef,
  CredentialStoreType,
  FileCredentialStore,
  KeychainCredentialStore,
} from "../schemas/config-schema.js";
import { chmodSafe } from "../security/permissions.js";

const execFileAsync = promisify(execFile);
const KEYCHAIN_SERVICE = "bitwarden-agent-secrets";

export function getDefaultCredentialStoreType(): CredentialStoreType {
  if (process.platform === "darwin" || process.platform === "linux") {
    return "keychain";
  }

  return "file";
}

export function buildCredentialStoreRef(
  profileName: string,
  storeType: CredentialStoreType,
): CredentialStoreRef {
  if (storeType === "keychain") {
    return {
      type: "keychain",
      service: KEYCHAIN_SERVICE,
      account: profileName,
    };
  }

  return {
    type: "file",
    path: getCredentialFilePath(profileName),
  };
}

export async function saveAccessToken(
  store: CredentialStoreRef,
  accessToken: string,
): Promise<void> {
  if (store.type === "file") {
    await saveFileCredential(store, accessToken);
    return;
  }

  await saveKeychainCredential(store, accessToken);
}

export async function loadAccessToken(store: CredentialStoreRef): Promise<string> {
  if (store.type === "file") {
    return loadFileCredential(store);
  }

  return loadKeychainCredential(store);
}

export async function deleteAccessToken(store: CredentialStoreRef): Promise<void> {
  if (store.type === "file") {
    await rm(store.path, { force: true });
    return;
  }

  await deleteKeychainCredential(store);
}

async function saveFileCredential(
  store: FileCredentialStore,
  accessToken: string,
): Promise<void> {
  await mkdir(getCredentialDir(), { recursive: true, mode: 0o700 });
  await chmodSafe(getCredentialDir(), 0o700);
  await writeFile(store.path, `${accessToken}\n`, { mode: 0o600 });
  await chmodSafe(store.path, 0o600);
}

async function loadFileCredential(store: FileCredentialStore): Promise<string> {
  try {
    return (await readFile(store.path, "utf8")).trim();
  } catch {
    throw new CliError(1, `Failed to load credential from ${store.path}.`);
  }
}

async function saveKeychainCredential(
  store: KeychainCredentialStore,
  accessToken: string,
): Promise<void> {
  try {
    if (process.platform === "darwin") {
      await execFileAsync("security", [
        "add-generic-password",
        "-U",
        "-s",
        store.service,
        "-a",
        store.account,
        "-w",
        accessToken,
      ]);
      return;
    }

    if (process.platform === "linux") {
      await runCommandWithInput(
        "secret-tool",
        ["store", "--label", `${store.service}:${store.account}`, "service", store.service, "account", store.account],
        `${accessToken}\n`,
      );
      return;
    }
  } catch {
    throw new CliError(
      1,
      "Failed to save access token in secure credential storage. Use --credential-store file if needed.",
    );
  }

  throw new CliError(2, "Keychain backend is not supported on this platform.");
}

async function runCommandWithInput(
  command: string,
  args: string[],
  input: string,
): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const child = spawn(command, args, {
      stdio: ["pipe", "pipe", "pipe"],
    });

    let stderr = "";
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });

    child.on("error", reject);
    child.on("exit", (code) => {
      if (code === 0) {
        resolve();
        return;
      }

      reject(new Error(stderr || `${command} exited with code ${code ?? "unknown"}`));
    });

    child.stdin.write(input);
    child.stdin.end();
  });
}

async function loadKeychainCredential(store: KeychainCredentialStore): Promise<string> {
  try {
    if (process.platform === "darwin") {
      const result = await execFileAsync("security", [
        "find-generic-password",
        "-s",
        store.service,
        "-a",
        store.account,
        "-w",
      ]);
      return result.stdout.trim();
    }

    if (process.platform === "linux") {
      const result = await execFileAsync("secret-tool", [
        "lookup",
        "service",
        store.service,
        "account",
        store.account,
      ]);
      return result.stdout.trim();
    }
  } catch {
    throw new CliError(1, "Failed to load access token from secure credential storage.");
  }

  throw new CliError(2, "Keychain backend is not supported on this platform.");
}

async function deleteKeychainCredential(store: KeychainCredentialStore): Promise<void> {
  try {
    if (process.platform === "darwin") {
      await execFileAsync("security", [
        "delete-generic-password",
        "-s",
        store.service,
        "-a",
        store.account,
      ]);
      return;
    }

    if (process.platform === "linux") {
      await execFileAsync("secret-tool", [
        "clear",
        "service",
        store.service,
        "account",
        store.account,
      ]);
      return;
    }
  } catch {
    throw new CliError(1, "Failed to delete access token from secure credential storage.");
  }

  throw new CliError(2, "Keychain backend is not supported on this platform.");
}
