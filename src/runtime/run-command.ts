import { spawn } from "node:child_process";
import os from "node:os";

export async function runCommand(
  command: string[],
  extraEnv: Record<string, string>,
): Promise<number> {
  const [cmd, ...argv] = command;

  return new Promise<number>((resolve, reject) => {
    const child = spawn(cmd, argv, {
      stdio: "inherit",
      env: {
        ...process.env,
        ...extraEnv,
      },
    });

    child.on("error", reject);
    child.on("exit", (code, signal) => {
      if (signal) {
        const signalNumber = os.constants.signals[signal] ?? 0;
        resolve(128 + signalNumber);
        return;
      }

      resolve(code ?? 0);
    });
  });
}
