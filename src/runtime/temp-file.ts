import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { chmodSafe } from "../security/permissions.js";

export async function createSecretFile(value: string): Promise<{
  filePath: string;
  cleanup: () => Promise<void>;
}> {
  const dir = await mkdtemp(path.join(os.tmpdir(), "bas-"));
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
