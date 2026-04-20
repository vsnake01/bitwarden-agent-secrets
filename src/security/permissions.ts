import { chmod, stat } from "node:fs/promises";

export async function chmodSafe(targetPath: string, mode: number): Promise<void> {
  try {
    await chmod(targetPath, mode);
  } catch {
    // Best-effort only. Some filesystems or platforms may not support chmod semantics.
  }
}

export async function checkMode(
  targetPath: string,
  expected: number,
): Promise<{ ok: boolean; actual?: number }> {
  try {
    const targetStat = await stat(targetPath);
    const actual = targetStat.mode & 0o777;
    return { ok: actual === expected, actual };
  } catch {
    return { ok: false };
  }
}
