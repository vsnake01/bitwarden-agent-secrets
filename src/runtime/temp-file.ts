import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";

import { getRuntimeTempRoot } from "../config/paths.js";
import { chmodSafe } from "../security/permissions.js";

export async function createSecretFile(value: string): Promise<{
  filePath: string;
  cleanup: () => Promise<void>;
}> {
  const runtimeRoot = getRuntimeTempRoot();
  await mkdir(runtimeRoot, { recursive: true, mode: 0o700 });
  await chmodSafe(runtimeRoot, 0o700);

  const dir = await mkdtemp(path.join(runtimeRoot, "run-"));
  await chmodSafe(dir, 0o700);
  const filePath = path.join(dir, "secret");
  await writeFile(filePath, value, { mode: 0o600 });
  await chmodSafe(filePath, 0o600);

  return {
    filePath,
    cleanup: async () => {
      await rm(dir, { recursive: true, force: true });
    },
  };
}
