import { spawn } from "node:child_process";

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
        resolve(1);
        return;
      }

      resolve(code ?? 0);
    });
  });
}
