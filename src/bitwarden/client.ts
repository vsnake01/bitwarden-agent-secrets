import type { ResolvedProfileConfig } from "../schemas/config-schema.js";

export class BitwardenClient {
  constructor(private readonly profile: ResolvedProfileConfig) {}

  async ping(): Promise<void> {
    if (!this.profile.accessToken) {
      throw new Error("Missing Bitwarden access token.");
    }
  }

  async getSecret(secretId: string): Promise<string> {
    void secretId;
    throw new Error("Bitwarden API integration is not implemented yet.");
  }
}
