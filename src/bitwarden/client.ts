import { mkdir } from "node:fs/promises";

import type { ClientSettings } from "@bitwarden/sdk-napi";

import {
  getBitwardenStateDir,
  getBitwardenStatePath,
} from "../config/paths.js";
import type { ResolvedProfileConfig } from "../schemas/config-schema.js";
import { chmodSafe } from "../security/permissions.js";

type SdkModule = typeof import("@bitwarden/sdk-napi");
type SdkClientInstance = InstanceType<SdkModule["BitwardenClient"]>;

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
