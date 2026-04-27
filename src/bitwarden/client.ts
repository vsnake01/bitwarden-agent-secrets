import { mkdir } from "node:fs/promises";

import type { ClientSettings } from "@bitwarden/sdk-napi";

import {
  getBitwardenStateDir,
  getBitwardenStatePath,
} from "../config/paths.js";
import type { ResolvedProfileConfig } from "../schemas/config-schema.js";
import { CliError } from "../errors/cli-error.js";
import { chmodSafe } from "../security/permissions.js";

type SdkModule = typeof import("@bitwarden/sdk-napi");
type SdkClientInstance = InstanceType<SdkModule["BitwardenClient"]>;

export interface BitwardenSecretMetadata {
  id: string;
  name: string;
}

let loadSdkModule: () => Promise<SdkModule> = () => import("@bitwarden/sdk-napi");

export function setBitwardenSdkLoaderForTests(
  loader: () => Promise<SdkModule>,
): void {
  loadSdkModule = loader;
}

export function resetBitwardenSdkLoaderForTests(): void {
  loadSdkModule = () => import("@bitwarden/sdk-napi");
}

export class BitwardenClient {
  private sdkClientPromise?: Promise<SdkClientInstance>;

  constructor(
    private readonly profileName: string,
    private readonly profile: ResolvedProfileConfig,
  ) {}

  async ping(): Promise<void> {
    await this.getAuthenticatedClient();
  }

  async getSecret(secretId: string): Promise<string> {
    try {
      const client = await this.getAuthenticatedClient();
      const secret = await client.secrets().get(secretId);
      return secret.value;
    } catch (error) {
      throw mapBitwardenError(
        error,
        `Failed to retrieve Bitwarden secret ${secretId} for profile ${this.profileName}.`,
      );
    }
  }

  async listSecrets(): Promise<BitwardenSecretMetadata[]> {
    if (!this.profile.organizationId) {
      throw new CliError(
        2,
        `Profile ${this.profileName} is missing organizationId. Run init with --organization-id <id> or pass --organization-id to policy setup.`,
      );
    }

    try {
      const client = await this.getAuthenticatedClient();
      const secretsApi = client.secrets() as unknown as {
        list: (organizationId: string) => Promise<unknown>;
      };
      const response = await secretsApi.list(this.profile.organizationId);
      const secrets = normalizeSecretListResponse(response);
      return secrets.map(normalizeSecretMetadata);
    } catch (error) {
      throw mapBitwardenError(
        error,
        `Failed to list Bitwarden secrets for profile ${this.profileName}.`,
      );
    }
  }

  private async getAuthenticatedClient(): Promise<SdkClientInstance> {
    if (!this.sdkClientPromise) {
      this.sdkClientPromise = this.authenticate();
    }

    return this.sdkClientPromise;
  }

  private async authenticate(): Promise<SdkClientInstance> {
    const sdk = await loadSdkModule();
    const settings: ClientSettings = {
      apiUrl: this.profile.apiUrl,
      identityUrl: this.profile.identityUrl,
      userAgent: "bitwarden-agent-secrets",
      deviceType: sdk.DeviceType.SDK,
    };

    await mkdir(getBitwardenStateDir(), { recursive: true, mode: 0o700 });
    await chmodSafe(getBitwardenStateDir(), 0o700);

    const client = new sdk.BitwardenClient(settings, sdk.LogLevel.Error);
    const statePath = getBitwardenStatePath(this.profileName);
    try {
      await client.auth().loginAccessToken(this.profile.accessToken, statePath);
    } catch (error) {
      throw mapBitwardenError(
        error,
        `Bitwarden authentication failed for profile ${this.profileName}. Verify the access token and Bitwarden URLs.`,
      );
    }
    await chmodSafe(statePath, 0o600);

    return client;
  }
}

function normalizeSecretListResponse(response: unknown): unknown[] {
  if (Array.isArray(response)) {
    return response;
  }

  const record = response && typeof response === "object" ? response as Record<string, unknown> : {};
  if (Array.isArray(record.data)) {
    return record.data;
  }

  throw new Error("Bitwarden secret metadata response is not a list.");
}

function normalizeSecretMetadata(secret: unknown): BitwardenSecretMetadata {
  const record = secret && typeof secret === "object" ? secret as Record<string, unknown> : {};
  const id = record.id;
  const name = record.key ?? record.name;

  if (typeof id !== "string" || !id.trim()) {
    throw new Error("Bitwarden secret metadata is missing id.");
  }
  if (typeof name !== "string" || !name.trim()) {
    throw new Error(`Bitwarden secret metadata ${id} is missing name.`);
  }

  return {
    id,
    name,
  };
}

function mapBitwardenError(error: unknown, fallbackMessage: string): Error {
  if (!(error instanceof Error)) {
    return new Error(fallbackMessage);
  }

  const message = error.message.trim();

  if (/unauthorized|authentication|forbidden|invalid access token|invalid token/i.test(message)) {
    return new Error(`${fallbackMessage} ${message}`);
  }

  if (/dns|network|timed out|timeout|connect|connection|socket|tls/i.test(message)) {
    return new Error(`${fallbackMessage} Bitwarden connection error: ${message}`);
  }

  return new Error(`${fallbackMessage} ${message}`);
}
