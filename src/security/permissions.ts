import { chmod } from "node:fs/promises";

export async function chmodSafe(targetPath: string, mode: number): Promise<void> {
  try {
    await chmod(targetPath, mode);
  } catch {
    // Best-effort only. Some filesystems or platforms may not support chmod semantics.
  }
}
