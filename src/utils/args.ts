export function readFlagValue(args: string[], flagName: string): string | undefined {
  const index = args.indexOf(flagName);
  if (index === -1) {
    return undefined;
  }

  return args[index + 1];
}

export function readRepeatedFlagValues(args: string[], flagName: string): string[] {
  const values: string[] = [];

  for (let index = 0; index < args.length; index += 1) {
    if (args[index] === flagName && args[index + 1]) {
      values.push(args[index + 1]);
      index += 1;
    }
  }

  return values;
}

export function stripFlagWithValue(args: string[], flagName: string): string[] {
  const stripped: string[] = [];

  for (let index = 0; index < args.length; index += 1) {
    if (args[index] === flagName) {
      index += 1;
      continue;
    }

    stripped.push(args[index]);
  }

  return stripped;
}

export async function readTokenFromArgsOrEnv(args: string[]): Promise<string | undefined> {
  if (args.includes("--access-token-stdin")) {
    return readStdin();
  }

  return process.env.BWS_ACCESS_TOKEN;
}

async function readStdin(): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) {
    chunks.push(Buffer.from(chunk));
  }

  return Buffer.concat(chunks).toString("utf8").trim();
}
