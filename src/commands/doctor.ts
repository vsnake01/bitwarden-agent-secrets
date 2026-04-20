import { stat } from "node:fs/promises";

import { BitwardenClient } from "../bitwarden/client.js";
import { loadConfig } from "../config/load-config.js";
import { loadPolicy } from "../config/load-policy.js";
import {
  getAuditLogPath,
  getConfigDir,
  getConfigPath,
  getPolicyPath,
  getStateDir,
} from "../config/paths.js";
import { CliError } from "../errors/cli-error.js";
import { checkMode } from "../security/permissions.js";
import { resolveProfileCredentials } from "../runtime/resolve-profile-credentials.js";
import { resolveProfile } from "../runtime/resolve-profile.js";
import { readFlagValue } from "../utils/args.js";
import { writeStdout } from "../utils/io.js";

type DoctorSeverity = "error" | "warn";
type DoctorStatus = "pass" | "fail" | "skip";

interface DoctorCheck {
  id: string;
  description: string;
  severity: DoctorSeverity;
  status: DoctorStatus;
  message?: string;
}

interface DoctorReport {
  profile: string;
  checks: DoctorCheck[];
  summary: {
    passed: number;
    failed: number;
    warned: number;
    skipped: number;
  };
}

export async function runDoctor(args: string[]): Promise<void> {
  const asJson = args.includes("--json");
  const skipSecrets = args.includes("--skip-secrets");
  const config = await loadConfig();
  const policy = await loadPolicy();
  const requestedProfile = readFlagValue(args, "--profile");
  const { profileName, profile } = resolveProfile(config, requestedProfile);
  const report: DoctorReport = {
    profile: profileName,
    checks: [],
    summary: {
      passed: 0,
      failed: 0,
      warned: 0,
      skipped: 0,
    },
  };

  const addCheck = (
    id: string,
    description: string,
    severity: DoctorSeverity,
    status: DoctorStatus,
    message?: string,
  ) => {
    report.checks.push({ id, description, severity, status, ...(message ? { message } : {}) });
  };

  addCheck(
    "C1",
    "config.json exists",
    "error",
    (await pathExists(getConfigPath())) ? "pass" : "fail",
    (await pathExists(getConfigPath())) ? undefined : `Missing ${getConfigPath()}`,
  );
  addCheck(
    "C2",
    "config.json mode must be 0600",
    "error",
    "pass",
  );
  const configMode = await checkMode(getConfigPath(), 0o600);
  updateModeCheck(report.checks[report.checks.length - 1], configMode, 0o600, getConfigPath());

  addCheck(
    "C3",
    "defaultProfile exists in profiles",
    "error",
    config.profiles[config.defaultProfile] ? "pass" : "fail",
    config.profiles[config.defaultProfile]
      ? undefined
      : `defaultProfile '${config.defaultProfile}' is not defined in profiles`,
  );

  addCheck("C4", "config directory mode must be 0700", "error", "pass");
  const configDirMode = await checkMode(getConfigDir(), 0o700);
  updateModeCheck(report.checks[report.checks.length - 1], configDirMode, 0o700, getConfigDir());

  addCheck(
    "P1",
    "policy.json exists",
    "error",
    (await pathExists(getPolicyPath())) ? "pass" : "fail",
    (await pathExists(getPolicyPath())) ? undefined : `Missing ${getPolicyPath()}`,
  );
  addCheck("P2", "policy.json mode must be 0600", "error", "pass");
  const policyMode = await checkMode(getPolicyPath(), 0o600);
  updateModeCheck(report.checks[report.checks.length - 1], policyMode, 0o600, getPolicyPath());

  addCheck("A1", "audit.log mode should be 0600 if present", "warn", "skip");
  if (await pathExists(getAuditLogPath())) {
    const auditMode = await checkMode(getAuditLogPath(), 0o600);
    updateModeCheck(report.checks[report.checks.length - 1], auditMode, 0o600, getAuditLogPath());
  }

  addCheck("S1", "state directory mode should be 0700 if present", "warn", "skip");
  if (await pathExists(getStateDir())) {
    const stateMode = await checkMode(getStateDir(), 0o700);
    updateModeCheck(report.checks[report.checks.length - 1], stateMode, 0o700, getStateDir());
  }

  const hardFailures = report.checks.some(
    (check) => check.severity === "error" && check.status === "fail",
  );

  if (hardFailures) {
    addCheck("B1", "credential store loads the access token", "error", "skip");
    addCheck("B2", "Bitwarden authentication succeeds", "error", "skip");
    for (const alias of Object.keys(policy.secrets).filter((name) =>
      policy.secrets[name].profiles.includes(profileName),
    )) {
      addCheck("B3", `alias ${alias} can be fetched`, "warn", "skip");
    }
  } else {
    let resolvedProfile;

    try {
      resolvedProfile = await resolveProfileCredentials(profile);
      addCheck("B1", "credential store loads the access token", "error", "pass");
    } catch (error) {
      addCheck(
        "B1",
        "credential store loads the access token",
        "error",
        "fail",
        error instanceof Error ? error.message : "Unknown credential-store failure",
      );
    }

    if (resolvedProfile) {
      const client = new BitwardenClient(profileName, resolvedProfile);

      try {
        await client.ping();
        addCheck("B2", "Bitwarden authentication succeeds", "error", "pass");
      } catch (error) {
        addCheck(
          "B2",
          "Bitwarden authentication succeeds",
          "error",
          "fail",
          error instanceof Error ? error.message : "Unknown Bitwarden authentication failure",
        );
      }

      const aliasNames = Object.keys(policy.secrets).filter((alias) =>
        policy.secrets[alias].profiles.includes(profileName),
      );
      for (const alias of aliasNames) {
        if (skipSecrets) {
          addCheck("B3", `alias ${alias} can be fetched`, "warn", "skip");
          continue;
        }

        try {
          await client.getSecret(policy.secrets[alias].secretId);
          addCheck("B3", `alias ${alias} can be fetched`, "warn", "pass");
        } catch (error) {
          addCheck(
            "B3",
            `alias ${alias} can be fetched`,
            "warn",
            "fail",
            error instanceof Error ? error.message : "Unknown Bitwarden fetch failure",
          );
        }
      }
    } else {
      addCheck("B2", "Bitwarden authentication succeeds", "error", "skip");
      for (const alias of Object.keys(policy.secrets).filter((name) =>
        policy.secrets[name].profiles.includes(profileName),
      )) {
        addCheck("B3", `alias ${alias} can be fetched`, "warn", "skip");
      }
    }
  }

  report.summary = summarizeChecks(report.checks);

  if (asJson) {
    await writeStdout(`${JSON.stringify(report, null, 2)}\n`);
    process.exitCode = report.summary.failed > 0 ? 1 : 0;
    return;
  }

  await writeStdout(renderDoctorReport(report));

  if (report.summary.failed > 0) {
    const firstFailure = report.checks.find((check) => check.severity === "error" && check.status === "fail");
    throw new CliError(1, `${firstFailure?.id} ${firstFailure?.description}${firstFailure?.message ? `: ${firstFailure.message}` : ""}`);
  }
}

function updateModeCheck(
  check: DoctorCheck,
  modeResult: { ok: boolean; actual?: number },
  expected: number,
  targetPath: string,
): void {
  if (modeResult.ok) {
    check.status = "pass";
    return;
  }

  check.status = "fail";
  const actual = modeResult.actual === undefined ? "missing" : formatMode(modeResult.actual);
  check.message = `${check.id === "A1" || check.id === "S1" ? targetPath : check.description.split(" mode ")[0]} expected ${formatMode(expected)}, got ${actual}`;
}

function summarizeChecks(checks: DoctorCheck[]): DoctorReport["summary"] {
  return checks.reduce(
    (summary, check) => {
      if (check.status === "pass") {
        summary.passed += 1;
      } else if (check.status === "skip") {
        summary.skipped += 1;
      } else {
        summary.failed += 1;
        if (check.severity === "warn") {
          summary.warned += 1;
        }
      }

      return summary;
    },
    { passed: 0, failed: 0, warned: 0, skipped: 0 },
  );
}

function renderDoctorReport(report: DoctorReport): string {
  const lines = [
    `Doctor summary: ${report.summary.failed === 0 ? "PASS" : "FAIL"}`,
    `Profile: ${report.profile}`,
    ...report.checks.map((check) => {
      const suffix = check.message ? ` (${check.message})` : "";
      return `[${check.status}] ${check.id} ${check.description}${suffix}`;
    }),
  ];

  return `${lines.join("\n")}\n`;
}

function formatMode(mode: number): string {
  return `0${mode.toString(8).padStart(3, "0")}`;
}

async function pathExists(targetPath: string): Promise<boolean> {
  try {
    await stat(targetPath);
    return true;
  } catch {
    return false;
  }
}
