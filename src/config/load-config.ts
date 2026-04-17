import { readFile } from "node:fs/promises";

import { CliError } from "../errors/cli-error.js";
import type { ConfigFile } from "../schemas/config-schema.js";
import { getConfigPath } from "./paths.js";

export async function loadConfig(): Promise<ConfigFile> {
  try {
    const raw = await readFile(getConfigPath(), "utf8");
    const config = JSON.parse(raw) as ConfigFile;
    validateConfig(config);
    return config;
  } catch (error) {
    if (error instanceof CliError) {
      throw error;
    }
    throw new CliError(1, `Failed to load config from ${getConfigPath()}.`);
  }
}

function validateConfig(config: ConfigFile): void {
  if (!config || typeof config !== "object") {
    throw new CliError(2, "Invalid config file.");
  }
  if (!config.defaultProfile) {
    throw new CliError(2, "Config is missing defaultProfile.");
  }
  if (!config.profiles || typeof config.profiles !== "object") {
    throw new CliError(2, "Config is missing profiles.");
  }
}
