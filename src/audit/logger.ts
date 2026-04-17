import { appendFile, mkdir } from "node:fs/promises";

import { chmodSafe } from "../security/permissions.js";
import { getAuditLogPath, getConfigDir } from "../config/paths.js";

export interface AuditRecord {
  ts: string;
  profile: string;
  alias: string;
  mode: "env" | "file";
  command: string;
  result: "success" | "failure";
  exitCode: number;
}

export async function writeAuditRecord(record: AuditRecord): Promise<void> {
  const dir = getConfigDir();
  const logPath = getAuditLogPath();
  await mkdir(dir, { recursive: true, mode: 0o700 });
  await chmodSafe(dir, 0o700);
  await appendFile(logPath, `${JSON.stringify(record)}\n`, { mode: 0o600 });
  await chmodSafe(logPath, 0o600);
}
