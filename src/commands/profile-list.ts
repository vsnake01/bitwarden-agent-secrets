import { loadConfig } from "../config/load-config.js";

export async function runProfileList(_args: string[]): Promise<void> {
  const config = await loadConfig();
  const lines = Object.keys(config.profiles).map((name) =>
    name === config.defaultProfile ? `* ${name}` : `  ${name}`,
  );
  process.stdout.write(`${lines.join("\n")}\n`);
}
