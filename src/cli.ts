#!/usr/bin/env node

import { runAuditTail } from "./commands/audit-tail.js";
import { runDoctor } from "./commands/doctor.js";
import { runExec } from "./commands/exec.js";
import { runFile } from "./commands/file.js";
import { runInit } from "./commands/init.js";
import { runPolicyAdd } from "./commands/policy-add.js";
import { runPolicyList } from "./commands/policy-list.js";
import { runPolicyRemove } from "./commands/policy-remove.js";
import { runPolicyValidate } from "./commands/policy-validate.js";
import { runProfileAdd } from "./commands/profile-add.js";
import { runProfileList } from "./commands/profile-list.js";
import { runProfileRemove } from "./commands/profile-remove.js";
import { runProfileRotateToken } from "./commands/profile-rotate-token.js";
import { runProfileUse } from "./commands/profile-use.js";
import { runReveal } from "./commands/reveal.js";
import { CliError, formatError } from "./errors/cli-error.js";
import { writeStderr, writeStdout } from "./utils/io.js";

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const [command, subcommand] = args;

  if (!command || command === "--help" || command === "-h") {
    await printHelp();
    return;
  }

  try {
    switch (command) {
      case "init":
        await runInit(args.slice(1));
        return;
      case "doctor":
        await runDoctor(args.slice(1));
        return;
      case "exec":
        await runExec(args.slice(1));
        return;
      case "file":
        await runFile(args.slice(1));
        return;
      case "reveal":
        await runReveal(args.slice(1));
        return;
      case "audit":
        if (subcommand === "tail") {
          await runAuditTail(args.slice(2));
          return;
        }
        throw new CliError(64, "Unsupported audit subcommand.");
      case "profile":
        await runProfileCommand(subcommand, args.slice(2));
        return;
      case "policy":
        await runPolicyCommand(subcommand, args.slice(2));
        return;
      default:
        throw new CliError(64, `Unknown command: ${command}`);
    }
  } catch (error) {
    const cliError = formatError(error);
    await writeStderr(`${cliError.message}\n`);
    process.exitCode = cliError.exitCode;
  }
}

async function runProfileCommand(
  subcommand: string | undefined,
  args: string[],
): Promise<void> {
  switch (subcommand) {
    case "list":
      await runProfileList(args);
      return;
    case "add":
      await runProfileAdd(args);
      return;
    case "use":
      await runProfileUse(args);
      return;
    case "remove":
      await runProfileRemove(args);
      return;
    case "rotate-token":
      await runProfileRotateToken(args);
      return;
    default:
      throw new CliError(64, "Supported profile commands: list, add, use, remove, rotate-token.");
  }
}

async function runPolicyCommand(
  subcommand: string | undefined,
  args: string[],
): Promise<void> {
  switch (subcommand) {
    case "list":
      await runPolicyList(args);
      return;
    case "add":
      await runPolicyAdd(args);
      return;
    case "remove":
      await runPolicyRemove(args);
      return;
    case "validate":
      await runPolicyValidate(args);
      return;
    default:
      throw new CliError(64, "Supported policy commands: list, add, remove, validate.");
  }
}

async function printHelp(): Promise<void> {
  const lines = [
    "bitwarden-agent-secrets",
    "",
    "Usage:",
    "  bitwarden-agent-secrets init [--credential-store keychain|file]",
    "  bitwarden-agent-secrets doctor [--profile <name>]",
    "  bitwarden-agent-secrets exec [--profile <name>] --map <alias:ENV> -- <command...>",
    "  bitwarden-agent-secrets file [--profile <name>] --mount <alias:ENV> -- <command...>",
    "  bitwarden-agent-secrets reveal <alias>",
    "  bitwarden-agent-secrets audit tail",
    "  bitwarden-agent-secrets profile list",
    "  bitwarden-agent-secrets profile add <name> [--credential-store keychain|file]",
    "  bitwarden-agent-secrets profile rotate-token <name> [--credential-store keychain|file]",
    "  bitwarden-agent-secrets profile use <name>",
    "  bitwarden-agent-secrets profile remove <name>",
    "  bitwarden-agent-secrets policy list",
    "  bitwarden-agent-secrets policy add <alias> --secret-id <id> --mode <env|file> --env <ENV> --profile <name>",
    "  bitwarden-agent-secrets policy remove <alias>",
    "  bitwarden-agent-secrets policy validate",
  ];

  await writeStdout(`${lines.join("\n")}\n`);
}

void main();
