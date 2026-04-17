import { loadConfig } from "../config/load-config.js";
import { saveConfig } from "../config/save-config.js";
import { CliError } from "../errors/cli-error.js";

export async function runProfileAdd(args: string[]): Promise<void> {
  const name = args[0];
  if (!name) {
    throw new CliError(64, "Usage: bitwarden-agent-secrets profile add <name>");
  }

  const accessToken = process.env.BWS_ACCESS_TOKEN;
  if (!accessToken) {
    throw new CliError(2, "Set BWS_ACCESS_TOKEN before adding a profile.");
  }

  const config = await loadConfig();
  config.profiles[name] = {
    accessToken,
    apiUrl: "https://api.bitwarden.com",
    identityUrl: "https://identity.bitwarden.com",
  };
  await saveConfig(config);
  process.stdout.write(`Added profile ${name}.\n`);
}
