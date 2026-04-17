import { CliError } from "../errors/cli-error.js";

export interface ParsedRuntimeArgs {
  mappings: Array<{ alias: string; envName: string }>;
  command: string[];
}

export function parseRuntimeArgs(
  args: string[],
  flagName: "--map" | "--mount",
): ParsedRuntimeArgs {
  const separatorIndex = args.indexOf("--");
  if (separatorIndex === -1) {
    throw new CliError(64, "Runtime commands require `-- <command...>`.");
  }

  const optionArgs = args.slice(0, separatorIndex);
  const command = args.slice(separatorIndex + 1);

  if (command.length === 0) {
    throw new CliError(64, "Missing child command.");
  }

  const mappings: Array<{ alias: string; envName: string }> = [];
  for (let index = 0; index < optionArgs.length; index += 1) {
    const token = optionArgs[index];
    if (token !== flagName) {
      throw new CliError(64, `Unsupported argument: ${token}`);
    }

    const pair = optionArgs[index + 1];
    if (!pair) {
      throw new CliError(64, `Missing value for ${flagName}.`);
    }

    const [alias, envName] = pair.split(":");
    if (!alias || !envName) {
      throw new CliError(64, `Expected ${flagName} <alias:ENV>.`);
    }

    mappings.push({ alias, envName });
    index += 1;
  }

  if (mappings.length === 0) {
    throw new CliError(64, `At least one ${flagName} is required.`);
  }

  return { mappings, command };
}
