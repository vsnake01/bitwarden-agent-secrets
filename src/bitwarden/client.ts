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
    const client = await this.getAuthenticatedClient();
    const secret = await client.secrets().get(secretId);
    return secret.value;
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
    await client.auth().loginAccessToken(this.profile.accessToken, statePath);
    await chmodSafe(statePath, 0o600);

    return client;
  }
}
