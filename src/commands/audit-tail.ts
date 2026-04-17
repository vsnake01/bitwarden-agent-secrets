import { readFile } from "node:fs/promises";

import { getAuditLogPath } from "../config/paths.js";
import { writeStdout } from "../utils/io.js";

export async function runAuditTail(_args: string[]): Promise<void> {
  const contents = await readFile(getAuditLogPath(), "utf8");
  await writeStdout(contents);
}
