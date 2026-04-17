import { readFile } from "node:fs/promises";

import { getAuditLogPath } from "../config/paths.js";

export async function runAuditTail(_args: string[]): Promise<void> {
  const contents = await readFile(getAuditLogPath(), "utf8");
  process.stdout.write(contents);
}
