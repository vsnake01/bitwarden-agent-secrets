import { mkdir, writeFile } from "node:fs/promises";

import type { ConfigFile } from "../schemas/config-schema.js";
import { chmodSafe } from "../security/permissions.js";
import { getConfigDir, getConfigPath } from "./paths.js";

export async function saveConfig(config: ConfigFile): Promise<void> {
  const dir = getConfigDir();
  await mkdir(dir, { recursive: true, mode: 0o700 });
  await chmodSafe(dir, 0o700);
  await writeFile(getConfigPath(), `${JSON.stringify(config, null, 2)}\n`, {
    mode: 0o600,
  });
  await chmodSafe(getConfigPath(), 0o600);
}
