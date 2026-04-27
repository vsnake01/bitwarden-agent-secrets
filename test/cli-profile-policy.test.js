import test from "node:test";
import assert from "node:assert/strict";
import { access, chmod, readFile, readdir } from "node:fs/promises";

import {
  resetBitwardenSdkLoaderForTests,
  setBitwardenSdkLoaderForTests,
} from "../dist/bitwarden/client.js";
import { runDoctor } from "../dist/commands/doctor.js";
import { runExec } from "../dist/commands/exec.js";
import { runFile } from "../dist/commands/file.js";
import { runInit } from "../dist/commands/init.js";
import { runPolicyAdd } from "../dist/commands/policy-add.js";
import { runPolicyList } from "../dist/commands/policy-list.js";
import { runPolicyRemove } from "../dist/commands/policy-remove.js";
import {
  resetPolicySetupTuiForTests,
  runPolicySetup,
  setPolicySetupTuiForTests,
} from "../dist/commands/policy-setup.js";
import { runPolicyValidate } from "../dist/commands/policy-validate.js";
import { runProfileAdd } from "../dist/commands/profile-add.js";
import { runProfileList } from "../dist/commands/profile-list.js";
import { runProfileRemove } from "../dist/commands/profile-remove.js";
import { runProfileRotateToken } from "../dist/commands/profile-rotate-token.js";
import { runProfileUse } from "../dist/commands/profile-use.js";
import {
  resetConfirmPromptForTests,
  resetLinePromptForTests,
  resetTokenPromptForTests,
  setConfirmPromptForTests,
  setLinePromptForTests,
  setTokenPromptForTests,
} from "../dist/utils/prompts.js";

import {
  captureStderr,
  captureStdout,
  cleanupTempHome,
  makeTempHome,
  pathInHome,
  readJson,
  runCli,
  withPatchedEnv,
} from "./helpers.js";

function installFakeBitwardenSdk() {
  const calls = {
    constructions: [],
    logins: [],
    gets: [],
    lists: [],
  };

  class FakeSdkClient {
    constructor(settings, logLevel) {
      calls.constructions.push({ settings, logLevel });
    }

    auth() {
      return {
        loginAccessToken: async (accessToken, stateFile) => {
          calls.logins.push({ accessToken, stateFile });
        },
      };
    }

    secrets() {
      return {
        list: async (organizationId) => {
          calls.lists.push(organizationId);
          return [
            { id: "secret-github", key: "GITHUB_TOKEN" },
            { id: "secret-sentry", key: "SENTRY_AUTH_TOKEN" },
            { id: "secret-ssh", key: "PROD_SSH_KEY" },
          ];
        },
        get: async (id) => {
          calls.gets.push(id);
          return { value: `secret:${id}` };
        },
      };
    }
  }

  setBitwardenSdkLoaderForTests(async () => ({
    BitwardenClient: FakeSdkClient,
    DeviceType: { SDK: "SDK" },
    LogLevel: { Error: 4 },
  }));

  return calls;
}

function installFakeBitwardenSdkWithOrganizationList() {
  const calls = {
    lists: [],
    gets: [],
  };

  class FakeSdkClient {
    auth() {
      return {
        loginAccessToken: async () => {},
      };
    }

    secrets() {
      return {
        list: async (organizationId) => {
          calls.lists.push(organizationId);
          return {
            data: [
              { id: "secret-github", key: "GITHUB_TOKEN", organizationId },
            ],
          };
        },
        get: async (id) => {
          calls.gets.push(id);
          return { value: `secret:${id}` };
        },
      };
    }
  }

  setBitwardenSdkLoaderForTests(async () => ({
    BitwardenClient: FakeSdkClient,
    DeviceType: { SDK: "SDK" },
    LogLevel: { Error: 4 },
  }));

  return calls;
}

function installFailingBitwardenSdk(failure) {
  setBitwardenSdkLoaderForTests(async () => ({
    BitwardenClient: class FakeSdkClient {
      auth() {
        return {
          loginAccessToken: async () => {},
        };
      }

      secrets() {
        return {
          get: async () => {
            throw failure;
          },
        };
      }
    },
    DeviceType: { SDK: "SDK" },
    LogLevel: { Error: 4 },
  }));
}

test(
  "init with file backend creates config, policy, and credential file",
  { concurrency: false },
  async () => {
    const homePath = await makeTempHome();

    try {
      const stdout = await withPatchedEnv(
        {
          HOME: homePath,
          BWS_ACCESS_TOKEN: "init-token",
        },
        () =>
          captureStdout(() =>
            runInit(["--credential-store", "file", "--profile", "default"]),
          ),
      );

      assert.match(stdout, /Initialized profile default using credential store file/);

      const config = await readJson(
        pathInHome(homePath, ".config", "bitwarden-agent-secrets", "config.json"),
      );
      const policy = await readJson(
        pathInHome(homePath, ".config", "bitwarden-agent-secrets", "policy.json"),
      );
      const credentialContents = await readFile(
        pathInHome(
          homePath,
          ".config",
          "bitwarden-agent-secrets",
          "credentials",
          "default.token",
        ),
        "utf8",
      );

      assert.equal(config.defaultProfile, "default");
      assert.equal(config.profiles.default.credentialStore.type, "file");
      assert.deepEqual(policy.secrets, {});
      assert.equal(credentialContents.trim(), "init-token");
    } finally {
      await cleanupTempHome(homePath);
    }
  },
);

test(
  "init can prompt for access token without requiring env or stdin token",
  { concurrency: false },
  async () => {
    const homePath = await makeTempHome();

    try {
      setTokenPromptForTests(async (label) => {
        assert.match(label, /Bitwarden Secrets Manager machine account token/);
        return "prompt-token";
      });

      const stdout = await withPatchedEnv(
        {
          HOME: homePath,
          BWS_ACCESS_TOKEN: undefined,
        },
        () =>
          captureStdout(() =>
            runInit([
              "--credential-store",
              "file",
              "--profile",
              "default",
              "--access-token-prompt",
            ]),
          ),
      );

      assert.match(stdout, /Initialized profile default using credential store file/);

      const credentialContents = await readFile(
        pathInHome(
          homePath,
          ".config",
          "bitwarden-agent-secrets",
          "credentials",
          "default.token",
        ),
        "utf8",
      );
      assert.equal(credentialContents.trim(), "prompt-token");
    } finally {
      resetTokenPromptForTests();
      await cleanupTempHome(homePath);
    }
  },
);

test(
  "init preserves existing profiles and can add another profile",
  { concurrency: false },
  async () => {
    const homePath = await makeTempHome();

    try {
      await withPatchedEnv(
        { HOME: homePath, BWS_ACCESS_TOKEN: "token-1" },
        () =>
          runInit([
            "--credential-store",
            "file",
            "--profile",
            "default",
            "--organization-id",
            "org-123",
          ]),
      );
      await withPatchedEnv(
        { HOME: homePath, BWS_ACCESS_TOKEN: "token-2" },
        () => runInit(["--credential-store", "file", "--profile", "prod"]),
      );

      const config = await readJson(
        pathInHome(homePath, ".config", "bitwarden-agent-secrets", "config.json"),
      );
      assert.ok(config.profiles.default);
      assert.ok(config.profiles.prod);
      assert.equal(config.defaultProfile, "default");

      await withPatchedEnv(
        { HOME: homePath, BWS_ACCESS_TOKEN: "token-3" },
        () => runInit(["--credential-store", "file", "--profile", "prod", "--set-default"]),
      );

      const updatedConfig = await readJson(
        pathInHome(homePath, ".config", "bitwarden-agent-secrets", "config.json"),
      );
      assert.equal(updatedConfig.defaultProfile, "prod");
    } finally {
      await cleanupTempHome(homePath);
    }
  },
);

test(
  "profile add/list/rotate-token/remove work with file backend",
  { concurrency: false },
  async () => {
    const homePath = await makeTempHome();

    try {
      await withPatchedEnv(
        { HOME: homePath, BWS_ACCESS_TOKEN: "token-1" },
        () =>
          runInit([
            "--credential-store",
            "file",
            "--profile",
            "default",
            "--organization-id",
            "org-123",
          ]),
      );

      await withPatchedEnv(
        { HOME: homePath, BWS_ACCESS_TOKEN: "token-2" },
        () => runProfileAdd(["prod", "--credential-store", "file"]),
      );

      await assert.rejects(
        () =>
          withPatchedEnv(
            { HOME: homePath, BWS_ACCESS_TOKEN: "token-3" },
            () => runProfileAdd(["prod", "--credential-store", "file"]),
          ),
        /already exists/,
      );

      const listOutput = await withPatchedEnv({ HOME: homePath }, () =>
        captureStdout(() => runProfileList([])),
      );
      assert.match(listOutput, /\* default \(file\)/);
      assert.match(listOutput, /prod \(file\)/);

      await withPatchedEnv(
        { HOME: homePath, BWS_ACCESS_TOKEN: "rotated" },
        () => runProfileRotateToken(["prod", "--credential-store", "file"]),
      );

      const rotatedToken = await readFile(
        pathInHome(homePath, ".config", "bitwarden-agent-secrets", "credentials", "prod.token"),
        "utf8",
      );
      assert.equal(rotatedToken.trim(), "rotated");

      await withPatchedEnv({ HOME: homePath }, () => runProfileUse(["prod"]));
      await assert.rejects(
        () => withPatchedEnv({ HOME: homePath }, () => runProfileRemove(["prod"])),
        /Cannot remove the default profile/,
      );

      await withPatchedEnv({ HOME: homePath }, () => runProfileUse(["default"]));
      await withPatchedEnv({ HOME: homePath }, () => runProfileRemove(["prod"]));

      await assert.rejects(() =>
        access(
          pathInHome(homePath, ".config", "bitwarden-agent-secrets", "credentials", "prod.token"),
        ),
      );
    } finally {
      await cleanupTempHome(homePath);
    }
  },
);

test(
  "policy add/list/validate/remove and doctor work on local file backend",
  { concurrency: false },
  async () => {
    const homePath = await makeTempHome();
    const calls = installFakeBitwardenSdk();

    try {
      await withPatchedEnv(
        { HOME: homePath, BWS_ACCESS_TOKEN: "token-1" },
        () =>
          runInit([
            "--credential-store",
            "file",
            "--profile",
            "default",
            "--organization-id",
            "org-123",
          ]),
      );

      await withPatchedEnv({ HOME: homePath }, () =>
        runPolicyAdd([
          "github_token",
          "--secret-id",
          "secret-123",
          "--mode",
          "env",
          "--env",
          "GITHUB_TOKEN",
          "--profile",
          "default",
          "--allowed-command",
          "gh",
          "--allowed-command",
          "git",
        ]),
      );

      const policyList = await withPatchedEnv({ HOME: homePath }, () =>
        captureStdout(() => runPolicyList([])),
      );
      assert.match(policyList, /github_token/);
      assert.match(policyList, /mode=env/);
      assert.match(policyList, /allowed=gh,git/);

      const doctorOutput = await withPatchedEnv({ HOME: homePath }, () =>
        captureStdout(() => runDoctor(["--profile", "default"])),
      );
      assert.match(doctorOutput, /Doctor summary: PASS/);
      assert.match(doctorOutput, /\[pass\] C1 config.json exists/);
      assert.match(doctorOutput, /\[pass\] B3 alias github_token can be fetched/);

      const doctorJson = await withPatchedEnv({ HOME: homePath }, () =>
        captureStdout(() => runDoctor(["--profile", "default", "--json"])),
      );
      const report = JSON.parse(doctorJson);
      assert.equal(report.profile, "default");
      assert.equal(report.summary.failed, 0);
      assert.ok(report.checks.some((check) => check.id === "B3" && check.status === "pass"));
      assert.equal(calls.logins.length, 2);
      assert.equal(calls.logins[0].accessToken, "token-1");
      assert.equal(calls.logins[1].accessToken, "token-1");
      assert.match(calls.logins[0].stateFile, /bitwarden\/default\.json$/);
      assert.match(calls.logins[1].stateFile, /bitwarden\/default\.json$/);
      assert.deepEqual(calls.gets, ["secret-123", "secret-123"]);

      const validateOutput = await withPatchedEnv({ HOME: homePath }, () =>
        captureStdout(() => runPolicyValidate([])),
      );
      assert.match(validateOutput, /Policy is valid\. Aliases: 1/);

      await withPatchedEnv({ HOME: homePath }, () => runPolicyRemove(["github_token"]));

      const policy = await readJson(
        pathInHome(homePath, ".config", "bitwarden-agent-secrets", "policy.json"),
      );
      assert.deepEqual(policy.secrets, {});
    } finally {
      resetBitwardenSdkLoaderForTests();
      await cleanupTempHome(homePath);
    }
  },
);

test(
  "policy setup compiles selected Bitwarden names into policy without reading values",
  { concurrency: false },
  async () => {
    const homePath = await makeTempHome();
    const calls = installFakeBitwardenSdk();

    try {
      await withPatchedEnv(
        { HOME: homePath, BWS_ACCESS_TOKEN: "token-1" },
        () =>
          runInit([
            "--credential-store",
            "file",
            "--profile",
            "default",
            "--organization-id",
            "org-123",
          ]),
      );

      const firstPlan = await withPatchedEnv({ HOME: homePath }, () =>
        captureStdout(() =>
          runPolicySetup([
            "--profile",
            "default",
            "--select",
            "GITHUB_TOKEN",
            "--allow",
            "github_token:gh,git",
            "--apply",
            "--yes",
          ]),
        ),
      );

      assert.match(firstPlan, /Policy setup for profile: default/);
      assert.match(firstPlan, /ADD github_token/);
      assert.match(firstPlan, /GITHUB_TOKEN -> env:GITHUB_TOKEN/);
      assert.match(firstPlan, /Commands:\s+gh, git/);
      assert.match(firstPlan, /No secret values were read/);

      const policy = await readJson(
        pathInHome(homePath, ".config", "bitwarden-agent-secrets", "policy.json"),
      );
      assert.deepEqual(policy.secrets.github_token, {
        secretId: "secret-github",
        mode: "env",
        envName: "GITHUB_TOKEN",
        profiles: ["default"],
        requiresApproval: false,
        allowedCommands: ["gh", "git"],
      });

      const source = await readJson(
        pathInHome(
          homePath,
          ".config",
          "bitwarden-agent-secrets",
          "policy.sources",
          "default.json",
        ),
      );
      assert.deepEqual(source.secrets.github_token, {
        bitwardenName: "GITHUB_TOKEN",
        mode: "env",
        env: "GITHUB_TOKEN",
        allowedCommands: ["gh", "git"],
        requiresApproval: false,
        disabled: false,
      });
      assert.deepEqual(calls.gets, []);

      const secondPlan = await withPatchedEnv({ HOME: homePath }, () =>
        captureStdout(() =>
          runPolicySetup([
            "--profile",
            "default",
            "--select",
            "SENTRY_AUTH_TOKEN",
            "--allow",
            "sentry_auth_token:sentry-cli,curl",
            "--dry-run",
          ]),
        ),
      );

      assert.match(secondPlan, /ADD sentry_auth_token/);
      assert.match(secondPlan, /REMOVE github_token/);
      assert.match(secondPlan, /SENTRY_AUTH_TOKEN -> env:SENTRY_AUTH_TOKEN/);
      assert.match(secondPlan, /Commands:\s+sentry-cli, curl/);

      const unchangedPolicy = await readJson(
        pathInHome(homePath, ".config", "bitwarden-agent-secrets", "policy.json"),
      );
      assert.deepEqual(unchangedPolicy, policy);
      assert.deepEqual(calls.gets, []);
      assert.equal(calls.lists.length, 2);
    } finally {
      resetBitwardenSdkLoaderForTests();
      await cleanupTempHome(homePath);
    }
  },
);

test(
  "policy setup interactive TUI selection writes selected aliases and commands",
  { concurrency: false },
  async () => {
    const homePath = await makeTempHome();
    const calls = installFakeBitwardenSdk();

    try {
      await withPatchedEnv(
        { HOME: homePath, BWS_ACCESS_TOKEN: "token-1" },
        () =>
          runInit([
            "--credential-store",
            "file",
            "--profile",
            "default",
            "--organization-id",
            "org-123",
          ]),
      );

      setPolicySetupTuiForTests(async ({ bitwardenSecrets, existingSource }) => {
        assert.deepEqual(
          bitwardenSecrets.map((secret) => secret.name),
          ["GITHUB_TOKEN", "SENTRY_AUTH_TOKEN", "PROD_SSH_KEY"],
        );
        assert.deepEqual(existingSource.secrets, {});
        return {
          selectedNames: ["PROD_SSH_KEY"],
          allowedCommandsByAlias: new Map([["prod_ssh_key", ["ssh", "scp"]]]),
        };
      });

      const output = await withPatchedEnv({ HOME: homePath }, () =>
        captureStdout(() =>
          runPolicySetup([
            "--profile",
            "default",
            "--interactive",
            "--apply",
            "--yes",
          ]),
        ),
      );

      assert.match(output, /\[x\] PROD_SSH_KEY/);
      assert.match(output, /ADD prod_ssh_key/);
      assert.match(output, /Commands:\s+ssh, scp/);

      const policy = await readJson(
        pathInHome(homePath, ".config", "bitwarden-agent-secrets", "policy.json"),
      );
      assert.deepEqual(policy.secrets.prod_ssh_key, {
        secretId: "secret-ssh",
        mode: "file",
        envName: "PROD_SSH_KEY_FILE",
        profiles: ["default"],
        requiresApproval: false,
        allowedCommands: ["ssh", "scp"],
      });
      assert.deepEqual(calls.gets, []);
    } finally {
      resetPolicySetupTuiForTests();
      resetBitwardenSdkLoaderForTests();
      await cleanupTempHome(homePath);
    }
  },
);

test(
  "policy setup interactive asks for confirmation and applies without --apply flag",
  { concurrency: false },
  async () => {
    const homePath = await makeTempHome();
    installFakeBitwardenSdk();

    try {
      await withPatchedEnv(
        { HOME: homePath, BWS_ACCESS_TOKEN: "token-1" },
        () =>
          runInit([
            "--credential-store",
            "file",
            "--profile",
            "default",
            "--organization-id",
            "org-123",
          ]),
      );

      setPolicySetupTuiForTests(async () => ({
        selectedNames: ["GITHUB_TOKEN"],
        allowedCommandsByAlias: new Map([["github_token", ["gh"]]]),
      }));
      setConfirmPromptForTests(async (label) => {
        assert.match(label, /Apply this policy/);
        return true;
      });

      const output = await withPatchedEnv({ HOME: homePath }, () =>
        captureStdout(() =>
          runPolicySetup([
            "--profile",
            "default",
            "--interactive",
          ]),
        ),
      );

      assert.match(output, /ADD github_token/);
      assert.match(output, /Policy updated/);

      const policy = await readJson(
        pathInHome(homePath, ".config", "bitwarden-agent-secrets", "policy.json"),
      );
      assert.equal(policy.secrets.github_token.secretId, "secret-github");
      assert.deepEqual(policy.secrets.github_token.allowedCommands, ["gh"]);
    } finally {
      resetConfirmPromptForTests();
      resetPolicySetupTuiForTests();
      resetBitwardenSdkLoaderForTests();
      await cleanupTempHome(homePath);
    }
  },
);

test(
  "policy setup interactive prompts for organization id when profile does not define one",
  { concurrency: false },
  async () => {
    const homePath = await makeTempHome();
    const calls = installFakeBitwardenSdkWithOrganizationList();

    try {
      await withPatchedEnv(
        { HOME: homePath, BWS_ACCESS_TOKEN: "token-1" },
        () => runInit(["--credential-store", "file", "--profile", "default"]),
      );

      setLinePromptForTests(async (label) => {
        assert.match(label, /Bitwarden organization ID/);
        return "org-from-prompt";
      });
      setPolicySetupTuiForTests(async () => ({
        selectedNames: ["GITHUB_TOKEN"],
        allowedCommandsByAlias: new Map([["github_token", ["gh"]]]),
      }));
      setConfirmPromptForTests(async () => false);

      const output = await withPatchedEnv({ HOME: homePath }, () =>
        captureStdout(() =>
          runPolicySetup([
            "--profile",
            "default",
            "--interactive",
            "--dry-run",
          ]),
        ),
      );

      assert.match(output, /ADD github_token/);
      assert.deepEqual(calls.lists, ["org-from-prompt"]);
    } finally {
      resetLinePromptForTests();
      resetConfirmPromptForTests();
      resetPolicySetupTuiForTests();
      resetBitwardenSdkLoaderForTests();
      await cleanupTempHome(homePath);
    }
  },
);

test(
  "policy setup requires and passes organization id for Bitwarden metadata listing",
  { concurrency: false },
  async () => {
    const homePath = await makeTempHome();
    const calls = installFakeBitwardenSdkWithOrganizationList();

    try {
      await withPatchedEnv(
        { HOME: homePath, BWS_ACCESS_TOKEN: "token-1" },
        () => runInit(["--credential-store", "file", "--profile", "default"]),
      );

      await assert.rejects(
        () =>
          withPatchedEnv({ HOME: homePath }, () =>
            runPolicySetup(["--profile", "default", "--select", "GITHUB_TOKEN", "--dry-run"]),
          ),
        /missing organizationId/i,
      );

      const output = await withPatchedEnv({ HOME: homePath }, () =>
        captureStdout(() =>
          runPolicySetup([
            "--profile",
            "default",
            "--organization-id",
            "org-123",
            "--select",
            "GITHUB_TOKEN",
            "--dry-run",
          ]),
        ),
      );

      assert.match(output, /ADD github_token/);
      assert.deepEqual(calls.lists, ["org-123"]);
      assert.deepEqual(calls.gets, []);
    } finally {
      resetBitwardenSdkLoaderForTests();
      await cleanupTempHome(homePath);
    }
  },
);

test(
  "runtime commands reject invalid usage before contacting Bitwarden",
  { concurrency: false },
  async () => {
    const homePath = await makeTempHome();

    try {
      await assert.rejects(
        () => withPatchedEnv({ HOME: homePath }, () => runExec(["--map", "token:API_TOKEN"])),
        /Runtime commands require/,
      );

      await assert.rejects(
        () =>
          withPatchedEnv(
            { HOME: homePath },
            () => runFile(["--mount", "ssh_key:SSH_KEY_FILE", "--"]),
          ),
        /Missing child command/,
      );
    } finally {
      await cleanupTempHome(homePath);
    }
  },
);

test(
  "policy add warns about dangerous shell interpreters in allowedCommands",
  { concurrency: false },
  async () => {
    const homePath = await makeTempHome();

    try {
      await withPatchedEnv(
        { HOME: homePath, BWS_ACCESS_TOKEN: "token-1" },
        () => runInit(["--credential-store", "file", "--profile", "default"]),
      );

      const stderr = await withPatchedEnv({ HOME: homePath }, () =>
        captureStderr(() =>
          runPolicyAdd([
            "github_token",
            "--secret-id",
            "secret-123",
            "--mode",
            "env",
            "--env",
            "GITHUB_TOKEN",
            "--profile",
            "default",
            "--allowed-command",
            "sh",
          ]),
        ),
      );

      assert.match(stderr, /Warning: allowed command 'sh' effectively allows arbitrary execution/);
    } finally {
      await cleanupTempHome(homePath);
    }
  },
);

test(
  "doctor reports failing permission checks in json mode",
  { concurrency: false },
  async () => {
    const homePath = await makeTempHome();

    try {
      await withPatchedEnv(
        { HOME: homePath, BWS_ACCESS_TOKEN: "token-1" },
        () => runInit(["--credential-store", "file", "--profile", "default"]),
      );

      await chmod(
        pathInHome(homePath, ".config", "bitwarden-agent-secrets", "config.json"),
        0o644,
      );

      await assert.rejects(
        () =>
          withPatchedEnv({ HOME: homePath }, () => runDoctor(["--profile", "default"])),
        /C2 config\.json mode must be 0600/,
      );

      const doctorJson = await withPatchedEnv({ HOME: homePath }, () =>
        captureStdout(() => runDoctor(["--profile", "default", "--json"])),
      );
      const report = JSON.parse(doctorJson);
      const modeCheck = report.checks.find((check) => check.id === "C2");
      assert.equal(modeCheck.status, "fail");
      assert.equal(modeCheck.severity, "error");
      assert.match(modeCheck.message, /expected 0600, got 0644/);
      assert.equal(report.summary.failed, 1);
    } finally {
      await cleanupTempHome(homePath);
    }
  },
);

test(
  "exec injects env secrets and file injects temporary secret files with mocked Bitwarden SDK",
  { concurrency: false },
  async () => {
    const homePath = await makeTempHome();
    const calls = installFakeBitwardenSdk();

    try {
      await withPatchedEnv(
        { HOME: homePath, BWS_ACCESS_TOKEN: "token-1" },
        () => runInit(["--credential-store", "file", "--profile", "default"]),
      );

      await withPatchedEnv({ HOME: homePath }, () =>
        runPolicyAdd([
          "api_token",
          "--secret-id",
          "secret-123",
          "--mode",
          "env",
          "--env",
          "API_TOKEN",
          "--profile",
          "default",
        ]),
      );

      await withPatchedEnv({ HOME: homePath }, () =>
        runPolicyAdd([
          "ssh_key",
          "--secret-id",
          "secret-file",
          "--mode",
          "file",
          "--env",
          "SSH_KEY_FILE",
          "--profile",
          "default",
        ]),
      );

      process.exitCode = undefined;
      await withPatchedEnv({ HOME: homePath }, () =>
        runExec([
          "--map",
          "api_token:API_TOKEN",
          "--",
          "sh",
          "-c",
          'test "$API_TOKEN" = "secret:secret-123"',
        ]),
      );
      assert.equal(process.exitCode, 0);

      process.exitCode = undefined;
      await withPatchedEnv({ HOME: homePath }, () =>
        runFile([
          "--mount",
          "ssh_key:SSH_KEY_FILE",
          "--",
          "sh",
          "-c",
          'test -f "$SSH_KEY_FILE" && grep -q "secret:secret-file" "$SSH_KEY_FILE"',
        ]),
      );
      assert.equal(process.exitCode, 0);

      const runtimeEntries = await readdir(
        pathInHome(homePath, ".local", "state", "bitwarden-agent-secrets", "tmp"),
      );
      assert.deepEqual(runtimeEntries, []);
      assert.deepEqual(calls.gets, ["secret-123", "secret-file"]);
    } finally {
      resetBitwardenSdkLoaderForTests();
      process.exitCode = undefined;
      await cleanupTempHome(homePath);
    }
  },
);

test(
  "exec and file enforce allowedCommands before fetching secrets",
  { concurrency: false },
  async () => {
    const homePath = await makeTempHome();
    const calls = installFakeBitwardenSdk();

    try {
      await withPatchedEnv(
        { HOME: homePath, BWS_ACCESS_TOKEN: "token-1" },
        () => runInit(["--credential-store", "file", "--profile", "default"]),
      );

      await withPatchedEnv({ HOME: homePath }, () =>
        runPolicyAdd([
          "api_token",
          "--secret-id",
          "secret-env",
          "--mode",
          "env",
          "--env",
          "API_TOKEN",
          "--profile",
          "default",
          "--allowed-command",
          "git",
        ]),
      );

      await withPatchedEnv({ HOME: homePath }, () =>
        runPolicyAdd([
          "ssh_key",
          "--secret-id",
          "secret-file",
          "--mode",
          "file",
          "--env",
          "SSH_KEY_FILE",
          "--profile",
          "default",
          "--allowed-command",
          "ssh",
        ]),
      );

      await assert.rejects(
        () =>
          withPatchedEnv({ HOME: homePath }, () =>
            runExec(["--map", "api_token:API_TOKEN", "--", "curl", "https://example.com"]),
          ),
        /Alias api_token is not allowed for command 'curl'/,
      );

      await assert.rejects(
        () =>
          withPatchedEnv({ HOME: homePath }, () =>
            runFile(["--mount", "ssh_key:SSH_KEY_FILE", "--", "scp", "file", "host:dest"]),
          ),
        /Alias ssh_key is not allowed for command 'scp'/,
      );

      assert.deepEqual(calls.gets, []);
    } finally {
      resetBitwardenSdkLoaderForTests();
      await cleanupTempHome(homePath);
    }
  },
);

test(
  "exec writes audit records for policy violations and fetch errors",
  { concurrency: false },
  async () => {
    const homePath = await makeTempHome();

    try {
      await withPatchedEnv(
        { HOME: homePath, BWS_ACCESS_TOKEN: "token-1" },
        () => runInit(["--credential-store", "file", "--profile", "default"]),
      );

      await withPatchedEnv({ HOME: homePath }, () =>
        runPolicyAdd([
          "api_token",
          "--secret-id",
          "secret-env",
          "--mode",
          "env",
          "--env",
          "API_TOKEN",
          "--profile",
          "default",
          "--allowed-command",
          "git",
        ]),
      );

      await assert.rejects(
        () =>
          withPatchedEnv({ HOME: homePath }, () =>
            runExec(["--map", "api_token:API_TOKEN", "--", "curl", "https://example.com"]),
          ),
        /Alias api_token is not allowed for command 'curl'/,
      );

      const firstAuditLog = await readFile(
        pathInHome(homePath, ".config", "bitwarden-agent-secrets", "audit.log"),
        "utf8",
      );
      const firstRecord = JSON.parse(firstAuditLog.trim());
      assert.equal(firstRecord.alias, "api_token");
      assert.deepEqual(firstRecord.aliases, ["api_token"]);
      assert.equal(firstRecord.result, "policy_violation");
      assert.equal(firstRecord.exitCode, 65);
      assert.equal(firstRecord.errorKind, "CliError");
      assert.equal(firstRecord.allowedCommand, "fail");

      installFailingBitwardenSdk(new Error("network timeout"));

      await assert.rejects(
        () =>
          withPatchedEnv({ HOME: homePath }, () =>
            runExec(["--map", "api_token:API_TOKEN", "--", "git", "status"]),
          ),
        /Bitwarden connection error: network timeout/,
      );

      const auditLog = await readFile(
        pathInHome(homePath, ".config", "bitwarden-agent-secrets", "audit.log"),
        "utf8",
      );
      const records = auditLog
        .trim()
        .split("\n")
        .map((line) => JSON.parse(line));
      const secondRecord = records[1];
      assert.equal(secondRecord.result, "fetch_error");
      assert.equal(secondRecord.exitCode, 1);
      assert.equal(secondRecord.errorKind, "Error");
      assert.equal(secondRecord.allowedCommand, "pass");
    } finally {
      resetBitwardenSdkLoaderForTests();
      await cleanupTempHome(homePath);
    }
  },
);

test(
  "cli no longer exposes reveal",
  { concurrency: false },
  async () => {
    const homePath = await makeTempHome();

    try {
      const help = await runCli(homePath, ["--help"]);
      assert.equal(help.exitCode, 0);
      assert.doesNotMatch(help.stdout, /\breveal\b/);

      const reveal = await runCli(homePath, ["reveal", "github_token"]);
      assert.equal(reveal.exitCode, 64);
      assert.match(reveal.stderr, /Unknown command: reveal/);
    } finally {
      await cleanupTempHome(homePath);
    }
  },
);
