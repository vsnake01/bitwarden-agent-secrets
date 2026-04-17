import { loadConfig } from "../config/load-config.js";
import { saveConfig } from "../config/save-config.js";
import { CliError } from "../errors/cli-error.js";

export async function runProfileUse(args: string[]): Promise<void> {
  const name = args[0];
  if (!name) {
    throw new CliError(64, "Usage: bitwarden-agent-secrets profile use <name>");
  }

  const config = await loadConfig();
  if (!config.profiles[name]) {
    throw new CliError(2, `Unknown profile: ${name}`);
  }

  config.defaultProfile = name;
  await saveConfig(config);
  process.stdout.write(`Default profile set to ${name}.\n`);
}
