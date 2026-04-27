import { mkdir, readFile, writeFile } from "node:fs/promises";

import { BitwardenClient, type BitwardenSecretMetadata } from "../bitwarden/client.js";
import { loadConfig } from "../config/load-config.js";
import { loadPolicy } from "../config/load-policy.js";
import { getPolicySourceDir, getPolicySourcePath } from "../config/paths.js";
import { savePolicy } from "../config/save-policy.js";
import { CliError } from "../errors/cli-error.js";
import { resolveProfileCredentials } from "../runtime/resolve-profile-credentials.js";
import { resolveProfile } from "../runtime/resolve-profile.js";
import type { PolicyFile, SecretMode, SecretPolicy } from "../schemas/policy-schema.js";
import { chmodSafe } from "../security/permissions.js";
import { readFlagValue, readRepeatedFlagValues } from "../utils/args.js";
import { writeStdout } from "../utils/io.js";
import { checkboxPrompt, confirmPrompt, promptLine } from "../utils/prompts.js";

interface PolicySourceSecret {
  bitwardenName: string;
  mode: SecretMode;
  env: string;
  allowedCommands: string[];
  requiresApproval: boolean;
  disabled: boolean;
}

interface PolicySourceFile {
  version: 1;
  profile: string;
  secrets: Record<string, PolicySourceSecret>;
}

interface SetupEntry {
  alias: string;
  source: PolicySourceSecret;
  secretId: string;
}

interface DiffEntry {
  kind: "ADD" | "UPDATE" | "REMOVE" | "KEEP";
  alias: string;
  before?: SecretPolicy;
  after?: SecretPolicy;
  source?: PolicySourceSecret;
}

interface PolicySetupTuiInput {
  bitwardenSecrets: BitwardenSecretMetadata[];
  existingSource: PolicySourceFile;
}

interface PolicySetupTuiResult {
  selectedNames: string[];
  allowedCommandsByAlias: Map<string, string[]>;
}

type PolicySetupTuiRunner = (input: PolicySetupTuiInput) => Promise<PolicySetupTuiResult>;

const DANGEROUS_ALLOWED_COMMANDS = new Set([
  "sh",
  "bash",
  "zsh",
  "fish",
  "python",
  "python3",
  "node",
  "ruby",
  "perl",
  "env",
]);

let policySetupTuiRunner: PolicySetupTuiRunner = runPolicySetupTui;

export function setPolicySetupTuiForTests(runner: PolicySetupTuiRunner): void {
  policySetupTuiRunner = runner;
}

export function resetPolicySetupTuiForTests(): void {
  policySetupTuiRunner = runPolicySetupTui;
}

export async function runPolicySetup(args: string[]): Promise<void> {
  const config = await loadConfig();
  const requestedProfile = readFlagValue(args, "--profile");
  const organizationIdFromArgs = readFlagValue(args, "--organization-id");
  const { profileName, profile } = resolveProfile(config, requestedProfile);
  const asDryRun = args.includes("--dry-run");
  const shouldApply = args.includes("--apply");
  const selectedNames = parseCsvFlag(readFlagValue(args, "--select"));
  const interactive = args.includes("--interactive") || (selectedNames.length === 0 && process.stdin.isTTY);

  if (asDryRun && shouldApply) {
    throw new CliError(64, "Use either --dry-run or --apply, not both.");
  }

  const organizationId = await resolveOrganizationId(profile.organizationId, organizationIdFromArgs, interactive);
  const resolvedProfile = await resolveProfileCredentials({
    ...profile,
    ...(organizationId ? { organizationId } : {}),
  });
  const client = new BitwardenClient(profileName, resolvedProfile);
  const bitwardenSecrets = await client.listSecrets();
  const existingPolicy = await loadPolicy();
  const existingSource = await loadPolicySource(profileName, bitwardenSecrets, existingPolicy);
  const tuiResult = interactive
    ? await policySetupTuiRunner({ bitwardenSecrets, existingSource })
    : undefined;
  const finalSelectedNames = tuiResult?.selectedNames ?? selectedNames;
  const allowedCommands =
    tuiResult?.allowedCommandsByAlias ?? parseAllowedCommands(args);
  const desiredSource =
    finalSelectedNames.length > 0
      ? buildDesiredSource(profileName, finalSelectedNames, existingSource, allowedCommands)
      : existingSource;
  const entries = resolveSourceEntries(desiredSource, bitwardenSecrets);
  const nextPolicy = compilePolicyForProfile(existingPolicy, profileName, entries);
  const diff = buildDiff(existingPolicy, nextPolicy, profileName, desiredSource);
  const output = renderSetupPlan(profileName, bitwardenSecrets, desiredSource, diff);

  await writeStdout(output);

  const confirmedInteractiveApply =
    interactive && !asDryRun && !shouldApply
      ? await confirmPrompt("Apply this policy?")
      : false;

  if (!shouldApply && !confirmedInteractiveApply) {
    return;
  }

  if (shouldApply && !args.includes("--yes")) {
    throw new CliError(64, "Refusing to apply without --yes in non-interactive mode.");
  }

  await savePolicySource(desiredSource);
  await savePolicy(nextPolicy);
  await writeStdout(
    `Policy updated.\n\n  aliases: ${entries.length}\n  profile: ${profileName}\n  source: ${getPolicySourcePath(profileName)}\n\n`,
  );
}

async function resolveOrganizationId(
  profileOrganizationId: string | undefined,
  argumentOrganizationId: string | undefined,
  interactive: boolean,
): Promise<string | undefined> {
  if (argumentOrganizationId) {
    return argumentOrganizationId;
  }

  if (profileOrganizationId) {
    return profileOrganizationId;
  }

  if (!interactive) {
    return undefined;
  }

  const answer = await promptLine("Bitwarden organization ID: ");
  return answer.trim() || undefined;
}

async function runPolicySetupTui({
  bitwardenSecrets,
  existingSource,
}: PolicySetupTuiInput): Promise<PolicySetupTuiResult> {
  const existingByName = new Map(
    Object.values(existingSource.secrets).map((secret) => [secret.bitwardenName, secret]),
  );
  const selectedNames = await checkboxPrompt(
    "Expose Bitwarden secrets to agents",
    [...bitwardenSecrets]
      .sort((left, right) => left.name.localeCompare(right.name))
      .map((secret) => {
        const source = existingByName.get(secret.name);
        const mode = source?.mode ?? suggestMode(secret.name);
        const alias = aliasFromBitwardenName(secret.name);
        const env = source?.env ?? suggestEnvName(secret.name, mode);
        const commands = source?.allowedCommands ?? suggestAllowedCommands(secret.name);
        return {
          value: secret.name,
          label: `${secret.name}  alias=${alias}  ${mode}:${env}  commands=${renderCommands(commands)}`,
          selected: !!source && !source.disabled,
        };
      }),
  );

  const allowedCommandsByAlias = new Map<string, string[]>();
  for (const bitwardenName of selectedNames) {
    const alias = aliasFromBitwardenName(bitwardenName);
    const existing = existingSource.secrets[alias];
    const defaults = existing?.allowedCommands ?? suggestAllowedCommands(bitwardenName);
    const presetCommands = commandPresetForSecret(bitwardenName, defaults);
    const selectedCommands = await checkboxPrompt(
      `Allowed commands for ${alias}`,
      presetCommands.map((command) => ({
        value: command,
        label: riskLabelForCommand(command),
        selected: defaults.includes(command),
      })),
    );
    const additional = await promptLine(`Additional commands for ${alias} (comma-separated, blank for none): `);
    allowedCommandsByAlias.set(
      alias,
      normalizeCommands([...selectedCommands, ...additional.split(",")]),
    );
  }

  return {
    selectedNames,
    allowedCommandsByAlias,
  };
}

async function loadPolicySource(
  profileName: string,
  bitwardenSecrets: BitwardenSecretMetadata[],
  policy: PolicyFile,
): Promise<PolicySourceFile> {
  try {
    const raw = await readFile(getPolicySourcePath(profileName), "utf8");
    return normalizePolicySource(JSON.parse(raw), profileName);
  } catch (error) {
    if (isNodeError(error) && error.code === "ENOENT") {
      return importSourceFromCompiledPolicy(profileName, bitwardenSecrets, policy);
    }

    throw new CliError(2, `Failed to load policy source from ${getPolicySourcePath(profileName)}.`);
  }
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error;
}

function normalizePolicySource(raw: unknown, profileName: string): PolicySourceFile {
  const source = raw && typeof raw === "object" ? raw as Partial<PolicySourceFile> : {};
  const secrets = source.secrets && typeof source.secrets === "object" ? source.secrets : {};

  return {
    version: 1,
    profile: typeof source.profile === "string" && source.profile ? source.profile : profileName,
    secrets: Object.fromEntries(
      Object.entries(secrets).map(([alias, secret]) => [
        alias,
        normalizeSourceSecret(secret as Partial<PolicySourceSecret>),
      ]),
    ),
  };
}

function normalizeSourceSecret(secret: Partial<PolicySourceSecret>): PolicySourceSecret {
  return {
    bitwardenName: String(secret.bitwardenName ?? ""),
    mode: secret.mode === "file" ? "file" : "env",
    env: String(secret.env ?? ""),
    allowedCommands: Array.isArray(secret.allowedCommands)
      ? normalizeCommands(secret.allowedCommands)
      : [],
    requiresApproval: secret.requiresApproval === true,
    disabled: secret.disabled === true,
  };
}

function importSourceFromCompiledPolicy(
  profileName: string,
  bitwardenSecrets: BitwardenSecretMetadata[],
  policy: PolicyFile,
): PolicySourceFile {
  const namesById = new Map(bitwardenSecrets.map((secret) => [secret.id, secret.name]));
  const secrets: Record<string, PolicySourceSecret> = {};

  for (const [alias, secret] of Object.entries(policy.secrets)) {
    if (!secret.profiles.includes(profileName)) {
      continue;
    }

    secrets[alias] = {
      bitwardenName: namesById.get(secret.secretId) ?? secret.secretId,
      mode: secret.mode,
      env: secret.envName,
      allowedCommands: secret.allowedCommands ?? [],
      requiresApproval: secret.requiresApproval,
      disabled: false,
    };
  }

  return {
    version: 1,
    profile: profileName,
    secrets,
  };
}

function buildDesiredSource(
  profileName: string,
  selectedNames: string[],
  existingSource: PolicySourceFile,
  allowedCommands: Map<string, string[]>,
): PolicySourceFile {
  const secrets: Record<string, PolicySourceSecret> = {};

  for (const bitwardenName of selectedNames) {
    const alias = aliasFromBitwardenName(bitwardenName);
    const existing = existingSource.secrets[alias];
    const mode = existing?.mode ?? suggestMode(bitwardenName);
    secrets[alias] = {
      bitwardenName,
      mode,
      env: existing?.env || suggestEnvName(bitwardenName, mode),
      allowedCommands:
        allowedCommands.get(alias) ?? existing?.allowedCommands ?? suggestAllowedCommands(bitwardenName),
      requiresApproval: existing?.requiresApproval ?? false,
      disabled: false,
    };
  }

  return {
    version: 1,
    profile: profileName,
    secrets,
  };
}

function parseAllowedCommands(args: string[]): Map<string, string[]> {
  const parsed = new Map<string, string[]>();

  for (const value of readRepeatedFlagValues(args, "--allow")) {
    const separator = value.indexOf(":");
    if (separator === -1) {
      throw new CliError(64, `Invalid --allow value '${value}'. Use alias:cmd,cmd.`);
    }

    const alias = value.slice(0, separator).trim();
    const commands = normalizeCommands(value.slice(separator + 1).split(","));
    if (!alias) {
      throw new CliError(64, `Invalid --allow value '${value}'. Alias is missing.`);
    }
    parsed.set(alias, commands);
  }

  return parsed;
}

function parseCsvFlag(value: string | undefined): string[] {
  if (!value) {
    return [];
  }

  return value.split(",").map((item) => item.trim()).filter(Boolean);
}

function normalizeCommands(commands: string[]): string[] {
  const normalized = commands
    .map((command) => command.trim())
    .filter(Boolean)
    .map((command) => command.split("/").filter(Boolean).at(-1) ?? command);

  return [...new Set(normalized)];
}

function resolveSourceEntries(
  source: PolicySourceFile,
  bitwardenSecrets: BitwardenSecretMetadata[],
): SetupEntry[] {
  const secretsByName = new Map<string, BitwardenSecretMetadata[]>();
  for (const secret of bitwardenSecrets) {
    secretsByName.set(secret.name, [...(secretsByName.get(secret.name) ?? []), secret]);
  }

  return Object.entries(source.secrets)
    .filter(([, secret]) => !secret.disabled)
    .map(([alias, secret]) => {
      const matches = secretsByName.get(secret.bitwardenName) ?? [];
      if (matches.length === 0) {
        throw new CliError(2, `Bitwarden secret '${secret.bitwardenName}' for alias ${alias} was not found.`);
      }
      if (matches.length > 1) {
        throw new CliError(2, `Bitwarden secret name '${secret.bitwardenName}' is ambiguous.`);
      }

      return {
        alias,
        source: secret,
        secretId: matches[0].id,
      };
    });
}

function compilePolicyForProfile(
  existingPolicy: PolicyFile,
  profileName: string,
  entries: SetupEntry[],
): PolicyFile {
  const next: PolicyFile = {
    version: 2,
    secrets: {},
  };
  const nextAliases = new Set(entries.map((entry) => entry.alias));

  for (const [alias, secret] of Object.entries(existingPolicy.secrets)) {
    if (!secret.profiles.includes(profileName) || nextAliases.has(alias)) {
      next.secrets[alias] = { ...secret, profiles: [...secret.profiles] };
      continue;
    }

    const profiles = secret.profiles.filter((profile) => profile !== profileName);
    if (profiles.length > 0) {
      next.secrets[alias] = { ...secret, profiles };
    }
  }

  for (const entry of entries) {
    const existingProfiles =
      existingPolicy.secrets[entry.alias]?.profiles.filter((profile) => profile !== profileName) ?? [];
    next.secrets[entry.alias] = {
      secretId: entry.secretId,
      mode: entry.source.mode,
      envName: entry.source.env,
      profiles: [...existingProfiles, profileName],
      requiresApproval: entry.source.requiresApproval,
      ...(entry.source.allowedCommands.length > 0
        ? { allowedCommands: entry.source.allowedCommands }
        : {}),
    };
  }

  return next;
}

function buildDiff(
  before: PolicyFile,
  after: PolicyFile,
  profileName: string,
  source: PolicySourceFile,
): DiffEntry[] {
  const aliases = new Set([
    ...Object.keys(before.secrets).filter((alias) => before.secrets[alias].profiles.includes(profileName)),
    ...Object.keys(after.secrets).filter((alias) => after.secrets[alias].profiles.includes(profileName)),
  ]);

  return [...aliases].sort().map((alias) => {
    const beforeSecret = before.secrets[alias]?.profiles.includes(profileName)
      ? before.secrets[alias]
      : undefined;
    const afterSecret = after.secrets[alias]?.profiles.includes(profileName)
      ? after.secrets[alias]
      : undefined;

    if (!beforeSecret && afterSecret) {
      return { kind: "ADD", alias, after: afterSecret, source: source.secrets[alias] };
    }
    if (beforeSecret && !afterSecret) {
      return { kind: "REMOVE", alias, before: beforeSecret };
    }
    if (beforeSecret && afterSecret && JSON.stringify(beforeSecret) !== JSON.stringify(afterSecret)) {
      return { kind: "UPDATE", alias, before: beforeSecret, after: afterSecret, source: source.secrets[alias] };
    }

    return { kind: "KEEP", alias, before: beforeSecret, after: afterSecret, source: source.secrets[alias] };
  });
}

function renderSetupPlan(
  profileName: string,
  bitwardenSecrets: BitwardenSecretMetadata[],
  source: PolicySourceFile,
  diff: DiffEntry[],
): string {
  const lines = [
    `Policy setup for profile: ${profileName}`,
    "",
    "No secret values were read.",
    "",
    "Bitwarden secrets",
    "",
    ...renderSecretChecklist(bitwardenSecrets, source),
    "",
    "Policy changes",
    "",
  ];

  if (diff.length === 0) {
    lines.push("  No aliases selected.");
    return `${lines.join("\n")}\n`;
  }

  for (const entry of diff) {
    lines.push(`${entry.kind} ${entry.alias}`);
    if (entry.after && entry.source) {
      lines.push(`  Bitwarden:  ${entry.source.bitwardenName}`);
      lines.push(`  Delivery:   ${entry.source.bitwardenName} -> ${entry.after.mode}:${entry.after.envName}`);
      lines.push(`  Profile:    ${profileName}`);
      lines.push(`  Commands:   ${renderCommands(entry.after.allowedCommands)}`);
      const warnings = warningsForCommands(entry.after.allowedCommands ?? []);
      for (const warning of warnings) {
        lines.push(`  Warning:    ${warning}`);
      }
    } else if (entry.before) {
      lines.push(`  Secret ID:  ${entry.before.secretId}`);
      lines.push(`  Profile:    ${profileName}`);
    }
    lines.push("");
  }

  return `${lines.join("\n")}`;
}

function renderSecretChecklist(
  bitwardenSecrets: BitwardenSecretMetadata[],
  source: PolicySourceFile,
): string[] {
  const sourceByName = new Map(
    Object.entries(source.secrets).map(([alias, secret]) => [secret.bitwardenName, { alias, secret }]),
  );

  if (bitwardenSecrets.length === 0) {
    return ["  No Bitwarden secrets found for this profile."];
  }

  return [...bitwardenSecrets]
    .sort((left, right) => left.name.localeCompare(right.name))
    .map((secret) => {
      const configured = sourceByName.get(secret.name);
      const alias = configured?.alias ?? aliasFromBitwardenName(secret.name);
      const sourceSecret = configured?.secret;
      const mode = sourceSecret?.mode ?? suggestMode(secret.name);
      const env = sourceSecret?.env ?? suggestEnvName(secret.name, mode);
      const commands = sourceSecret?.allowedCommands ?? suggestAllowedCommands(secret.name);
      const marker = configured && !sourceSecret?.disabled ? "[x]" : "[ ]";
      return `  ${marker} ${secret.name.padEnd(24)} alias=${alias.padEnd(20)} ${mode}:${env} commands=${renderCommands(commands)}`;
    });
}

function renderCommands(commands: string[] | undefined): string {
  return commands && commands.length > 0 ? commands.join(", ") : "(any child command)";
}

function warningsForCommands(commands: string[]): string[] {
  return commands
    .filter((command) => DANGEROUS_ALLOWED_COMMANDS.has(command))
    .map((command) => `${command} effectively allows arbitrary execution`);
}

function commandPresetForSecret(name: string, defaults: string[]): string[] {
  const commonCommands = [
    "gh",
    "git",
    "glab",
    "sentry-cli",
    "npm",
    "pnpm",
    "yarn",
    "docker",
    "kubectl",
    "helm",
    "ssh",
    "scp",
    "rsync",
    "curl",
    "node",
    "python",
    "sh",
    "bash",
  ];

  return normalizeCommands([...defaults, ...suggestAllowedCommands(name), ...commonCommands]);
}

function riskLabelForCommand(command: string): string {
  return DANGEROUS_ALLOWED_COMMANDS.has(command)
    ? `${command}  high risk`
    : command;
}

async function savePolicySource(source: PolicySourceFile): Promise<void> {
  await mkdir(getPolicySourceDir(), { recursive: true, mode: 0o700 });
  await chmodSafe(getPolicySourceDir(), 0o700);
  await writeFile(getPolicySourcePath(source.profile), `${JSON.stringify(source, null, 2)}\n`, {
    mode: 0o600,
  });
  await chmodSafe(getPolicySourcePath(source.profile), 0o600);
}

function aliasFromBitwardenName(name: string): string {
  return name
    .replace(/([a-z0-9])([A-Z])/g, "$1_$2")
    .replace(/[^A-Za-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .toLowerCase();
}

function suggestEnvName(name: string, mode: SecretMode): string {
  const envName = name
    .replace(/[^A-Za-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .toUpperCase();
  return mode === "file" && !envName.endsWith("_FILE") ? `${envName}_FILE` : envName;
}

function suggestMode(name: string): SecretMode {
  return /SSH_KEY|PRIVATE_KEY|KUBECONFIG|CERT|PEM/i.test(name) ? "file" : "env";
}

function suggestAllowedCommands(name: string): string[] {
  if (/^(GITHUB_TOKEN|GH_TOKEN)$/i.test(name)) {
    return ["gh", "git"];
  }
  if (/^(SENTRY_AUTH_TOKEN|SENTRY_TOKEN)$/i.test(name)) {
    return ["sentry-cli"];
  }
  if (/^(NPM_TOKEN|NODE_AUTH_TOKEN)$/i.test(name)) {
    return ["npm", "pnpm", "yarn"];
  }
  if (/SSH_KEY|PRIVATE_KEY/i.test(name)) {
    return ["ssh", "scp", "rsync"];
  }
  if (/KUBECONFIG/i.test(name)) {
    return ["kubectl", "helm"];
  }

  return [];
}
