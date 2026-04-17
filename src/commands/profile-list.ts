import { loadConfig } from "../config/load-config.js";
import { writeStdout } from "../utils/io.js";

export async function runProfileList(_args: string[]): Promise<void> {
  const config = await loadConfig();
  const lines = Object.keys(config.profiles).map((name) =>
    name === config.defaultProfile
      ? `* ${name} (${config.profiles[name].credentialStore.type})`
      : `  ${name} (${config.profiles[name].credentialStore.type})`,
  );
  await writeStdout(`${lines.join("\n")}\n`);
}
