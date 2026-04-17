import test from "node:test";
import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

import { loadConfig } from "../dist/config/load-config.js";
import {
  buildCredentialStoreRef,
  deleteAccessToken,
  loadAccessToken,
  resetCredentialCommandRunnersForTests,
  saveAccessToken,
  setCredentialCommandRunnersForTests,
} from "../dist/credentials/store.js";
import { getConfigPath, getCredentialFilePath } from "../dist/config/paths.js";

import { cleanupTempHome, makeTempHome, pathInHome } from "./helpers.js";

test("file credential backend saves, loads, and deletes token", { concurrency: false }, async () => {
  const homePath = await makeTempHome();
  const previousHome = process.env.HOME;
  process.env.HOME = homePath;

  try {
    const store = buildCredentialStoreRef("default", "file");
    assert.equal(store.type, "file");

    await saveAccessToken(store, "abc123");
    assert.equal(await loadAccessToken(store), "abc123");

    await deleteAccessToken(store);
    await assert.rejects(() => loadAccessToken(store), /Failed to load credential/);
  } finally {
    process.env.HOME = previousHome;
    await cleanupTempHome(homePath);
  }
});

test("loadConfig validates missing credentialStore", { concurrency: false }, async () => {
  const homePath = await makeTempHome();
  const previousHome = process.env.HOME;
  process.env.HOME = homePath;

  try {
    const configPath = getConfigPath();
    await mkdir(path.dirname(configPath), { recursive: true });
    await writeFile(
      configPath,
      JSON.stringify({
        version: 1,
        defaultProfile: "default",
        profiles: {
          default: {
            apiUrl: "https://api.bitwarden.com",
          },
        },
      }),
    );

    await assert.rejects(() => loadConfig(), /missing credentialStore/);
  } finally {
    process.env.HOME = previousHome;
    await cleanupTempHome(homePath);
  }
});

test(
  "loadConfig validates malformed keychain and file credential stores",
  { concurrency: false },
  async () => {
  const homePath = await makeTempHome();
  const previousHome = process.env.HOME;
  process.env.HOME = homePath;

  try {
    await mkdir(path.dirname(getConfigPath()), { recursive: true });
    await writeFile(
      getConfigPath(),
      JSON.stringify({
        version: 1,
        defaultProfile: "default",
        profiles: {
          default: {
            credentialStore: {
              type: "keychain",
              service: "",
              account: "",
            },
          },
        },
      }),
    );
    await assert.rejects(() => loadConfig(), /invalid keychain credentialStore/);

    await writeFile(
      getConfigPath(),
      JSON.stringify({
        version: 1,
        defaultProfile: "default",
        profiles: {
          default: {
            credentialStore: {
              type: "file",
              path: "",
            },
          },
        },
      }),
    );
    await assert.rejects(() => loadConfig(), /invalid file credentialStore/);
  } finally {
    process.env.HOME = previousHome;
    await cleanupTempHome(homePath);
  }
});

test(
  "buildCredentialStoreRef for file uses config credentials directory",
  { concurrency: false },
  async () => {
  const homePath = await makeTempHome();
  const previousHome = process.env.HOME;
  process.env.HOME = homePath;

  try {
    const store = buildCredentialStoreRef("prod", "file");
    assert.equal(store.type, "file");
    assert.equal(store.path, getCredentialFilePath("prod"));
    assert.equal(
      store.path,
      pathInHome(homePath, ".config", "bitwarden-agent-secrets", "credentials", "prod.token"),
    );
  } finally {
    process.env.HOME = previousHome;
    await cleanupTempHome(homePath);
  }
  },
);

test("keychain backend surfaces actionable missing-tool guidance", { concurrency: false }, async () => {
  const store = {
    type: "keychain",
    service: "bitwarden-agent-secrets",
    account: "default",
  };

  try {
    setCredentialCommandRunnersForTests({
      execFileRunner: async () => {
        const error = new Error("spawn tool ENOENT");
        Object.assign(error, { code: "ENOENT" });
        throw error;
      },
    });

    await assert.rejects(
      () => loadAccessToken(store),
      /not available|use --credential-store file/i,
    );
  } finally {
    resetCredentialCommandRunnersForTests();
  }
});

test(
  "linux secret service locked errors are mapped clearly",
  { concurrency: false, skip: process.platform !== "linux" },
  async () => {
    const store = {
      type: "keychain",
      service: "bitwarden-agent-secrets",
      account: "default",
    };

    try {
      setCredentialCommandRunnersForTests({
        execFileRunner: async () => {
          throw new Error("Cannot create an item in a locked collection");
        },
      });

      await assert.rejects(
        () => loadAccessToken(store),
        /Secret Service is unavailable or locked/i,
      );
    } finally {
      resetCredentialCommandRunnersForTests();
    }
  },
);
