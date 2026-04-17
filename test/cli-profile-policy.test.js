import test from "node:test";
import assert from "node:assert/strict";
import { access, readFile, readdir } from "node:fs/promises";

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
import { runPolicyValidate } from "../dist/commands/policy-validate.js";
import { runProfileAdd } from "../dist/commands/profile-add.js";
import { runProfileList } from "../dist/commands/profile-list.js";
import { runProfileRemove } from "../dist/commands/profile-remove.js";
import { runProfileRotateToken } from "../dist/commands/profile-rotate-token.js";
import { runProfileUse } from "../dist/commands/profile-use.js";

import {
  captureStdout,
  cleanupTempHome,
  makeTempHome,
  pathInHome,
  readJson,
  withPatchedEnv,
} from "./helpers.js";

function installFakeBitwardenSdk() {
  const calls = {
    constructions: [],
    logins: [],
    gets: [],
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
  "init preserves existing profiles and can add another profile",
  { concurrency: false },
  async () => {
    const homePath = await makeTempHome();

    try {
      await withPatchedEnv(
        { HOME: homePath, BWS_ACCESS_TOKEN: "token-1" },
        () => runInit(["--credential-store", "file", "--profile", "default"]),
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
      assert.equal(config.defaultProfile, "prod");
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
        () => runInit(["--credential-store", "file", "--profile", "default"]),
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
        () => runInit(["--credential-store", "file", "--profile", "default"]),
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
        ]),
      );

      const policyList = await withPatchedEnv({ HOME: homePath }, () =>
        captureStdout(() => runPolicyList([])),
      );
      assert.match(policyList, /github_token/);
      assert.match(policyList, /mode=env/);

      const doctorOutput = await withPatchedEnv({ HOME: homePath }, () =>
        captureStdout(() => runDoctor(["--profile", "default"])),
      );
      assert.match(doctorOutput, /Credential store: file/);
      assert.match(doctorOutput, /Configured aliases: 1/);
      assert.equal(calls.logins.length, 1);
      assert.equal(calls.logins[0].accessToken, "token-1");
      assert.match(calls.logins[0].stateFile, /bitwarden\/default\.json$/);

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
