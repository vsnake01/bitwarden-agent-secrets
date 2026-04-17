import { mkdir, writeFile } from "node:fs/promises";

import type { PolicyFile } from "../schemas/policy-schema.js";
import { chmodSafe } from "../security/permissions.js";
import { getConfigDir, getPolicyPath } from "./paths.js";

export async function savePolicy(policy: PolicyFile): Promise<void> {
  const dir = getConfigDir();
  await mkdir(dir, { recursive: true, mode: 0o700 });
  await chmodSafe(dir, 0o700);
  await writeFile(getPolicyPath(), `${JSON.stringify(policy, null, 2)}\n`, {
    mode: 0o600,
  });
  await chmodSafe(getPolicyPath(), 0o600);
}
