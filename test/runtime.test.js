import test from "node:test";
import assert from "node:assert/strict";
import { stat } from "node:fs/promises";

import { parseRuntimeArgs } from "../dist/runtime/parse-runtime-args.js";
import { runCommand } from "../dist/runtime/run-command.js";
import { createSecretFile } from "../dist/runtime/temp-file.js";

import { cleanupTempHome, makeTempHome } from "./helpers.js";

test("parseRuntimeArgs parses mappings and optional profile", { concurrency: false }, () => {
  const parsed = parseRuntimeArgs(
    ["--profile", "prod", "--map", "token:API_TOKEN", "--", "echo", "ok"],
    "--map",
  );

  assert.equal(parsed.profileName, "prod");
  assert.deepEqual(parsed.mappings, [{ alias: "token", envName: "API_TOKEN" }]);
  assert.deepEqual(parsed.command, ["echo", "ok"]);
});

test("parseRuntimeArgs preserves child command arguments after --", { concurrency: false }, () => {
  const parsed = parseRuntimeArgs(
    ["--profile", "prod", "--map", "token:API_TOKEN", "--", "cmd", "--profile", "child"],
    "--map",
  );

  assert.deepEqual(parsed.command, ["cmd", "--profile", "child"]);
});

test(
  "createSecretFile writes into user-private runtime directory and cleanup removes it",
  { concurrency: false },
  async () => {
  const homePath = await makeTempHome();
  const previousHome = process.env.HOME;
  process.env.HOME = homePath;

  try {
    const secretFile = await createSecretFile("top-secret");
    assert.match(
      secretFile.filePath,
      /\/\.local\/state\/bitwarden-agent-secrets\/tmp\/run-[^/]+\/secret$/,
    );

    const fileStats = await stat(secretFile.filePath);
    assert.ok(fileStats.isFile());

    await secretFile.cleanup();
    await assert.rejects(() => stat(secretFile.filePath));
  } finally {
    process.env.HOME = previousHome;
    await cleanupTempHome(homePath);
  }
  },
);

test("runCommand returns 128 plus signal number for signaled exits", { concurrency: false }, async () => {
  const exitCode = await runCommand(
    [process.execPath, "-e", "process.kill(process.pid, 'SIGTERM')"],
    {},
  );

  assert.equal(exitCode, 143);
});
