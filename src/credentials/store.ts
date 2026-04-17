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

const defaultExecFileAsync = promisify(execFile);
const KEYCHAIN_SERVICE = "bitwarden-agent-secrets";

let execFileRunner: typeof defaultExecFileAsync = defaultExecFileAsync;
let commandWithInputRunner = runCommandWithInput;

export function setCredentialCommandRunnersForTests(runners: {
  execFileRunner?: typeof defaultExecFileAsync;
  commandWithInputRunner?: typeof runCommandWithInput;
}): void {
  execFileRunner = runners.execFileRunner ?? defaultExecFileAsync;
  commandWithInputRunner = runners.commandWithInputRunner ?? runCommandWithInput;
}

export function resetCredentialCommandRunnersForTests(): void {
  execFileRunner = defaultExecFileAsync;
  commandWithInputRunner = runCommandWithInput;
}

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
      await execFileRunner("security", [
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
      await commandWithInputRunner(
        "secret-tool",
        ["store", "--label", `${store.service}:${store.account}`, "service", store.service, "account", store.account],
        `${accessToken}\n`,
      );
      return;
    }
  } catch (error) {
    throw mapCredentialStoreError(error, "save");
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
      const result = await execFileRunner("security", [
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
      const result = await execFileRunner("secret-tool", [
        "lookup",
        "service",
        store.service,
        "account",
        store.account,
      ]);
      return result.stdout.trim();
    }
  } catch (error) {
    throw mapCredentialStoreError(error, "load");
  }

  throw new CliError(2, "Keychain backend is not supported on this platform.");
}

async function deleteKeychainCredential(store: KeychainCredentialStore): Promise<void> {
  try {
    if (process.platform === "darwin") {
      await execFileRunner("security", [
        "delete-generic-password",
        "-s",
        store.service,
        "-a",
        store.account,
      ]);
      return;
    }

    if (process.platform === "linux") {
      await execFileRunner("secret-tool", [
        "clear",
        "service",
        store.service,
        "account",
        store.account,
      ]);
      return;
    }
  } catch (error) {
    throw mapCredentialStoreError(error, "delete");
  }

  throw new CliError(2, "Keychain backend is not supported on this platform.");
}

function mapCredentialStoreError(
  error: unknown,
  operation: "save" | "load" | "delete",
): CliError {
  const details = getErrorDetails(error);

  if (process.platform === "darwin") {
    if (details.code === "ENOENT") {
      return new CliError(
        1,
        "macOS Keychain tool `security` is not available. Use --credential-store file if needed.",
      );
    }

    return new CliError(
      1,
      `Failed to ${operation} access token in macOS Keychain.${details.message ? ` ${details.message}` : ""}`,
    );
  }

  if (process.platform === "linux") {
    if (details.code === "ENOENT") {
      return new CliError(
        1,
        "Linux Secret Service tool `secret-tool` is not available. Install libsecret/gnome-keyring or use --credential-store file.",
      );
    }

    if (details.message && /No such secret collection|Cannot create an item|is locked/i.test(details.message)) {
      return new CliError(
        1,
        `Linux Secret Service is unavailable or locked. Unlock your keyring/session or use --credential-store file.${details.message ? ` ${details.message}` : ""}`,
      );
    }

    return new CliError(
      1,
      `Failed to ${operation} access token in Linux Secret Service.${details.message ? ` ${details.message}` : ""}`,
    );
  }

  return new CliError(
    1,
    `Failed to ${operation} access token in secure credential storage.${details.message ? ` ${details.message}` : ""}`,
  );
}

function getErrorDetails(error: unknown): { code?: string; message?: string } {
  if (error instanceof Error) {
    return {
      code: "code" in error && typeof error.code === "string" ? error.code : undefined,
      message: error.message,
    };
  }

  return {};
}
