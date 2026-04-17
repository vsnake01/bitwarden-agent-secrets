import { loadConfig } from "../config/load-config.js";
import { saveConfig } from "../config/save-config.js";
import { deleteAccessToken } from "../credentials/store.js";
import { CliError } from "../errors/cli-error.js";

export async function runProfileRemove(args: string[]): Promise<void> {
  const name = args[0];
  if (!name) {
    throw new CliError(64, "Usage: bitwarden-agent-secrets profile remove <name>");
  }

  const config = await loadConfig();
  if (name === config.defaultProfile) {
    throw new CliError(2, "Cannot remove the default profile. Switch first.");
  }
  if (!config.profiles[name]) {
    throw new CliError(2, `Unknown profile: ${name}`);
  }

  const credentialStore = config.profiles[name].credentialStore;
  delete config.profiles[name];
  await saveConfig(config);
  await deleteAccessToken(credentialStore);
  process.stdout.write(`Removed profile ${name}.\n`);
}
