import test from "node:test";
import assert from "node:assert/strict";
import { access } from "node:fs/promises";

import {
  BitwardenClient,
  resetBitwardenSdkLoaderForTests,
  setBitwardenSdkLoaderForTests,
} from "../dist/bitwarden/client.js";

import { cleanupTempHome, makeTempHome, pathInHome, withPatchedEnv } from "./helpers.js";

function installSdkMock() {
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
          return { value: `mocked:${id}` };
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

test("BitwardenClient authenticates with SDK and caches the session", { concurrency: false }, async () => {
  const homePath = await makeTempHome();
  const calls = installSdkMock();

  try {
    await withPatchedEnv({ HOME: homePath }, async () => {
      const client = new BitwardenClient("default", {
        accessToken: "bws-token",
        apiUrl: "https://api.bitwarden.com",
        identityUrl: "https://identity.bitwarden.com",
        credentialStore: {
          type: "file",
          path: "/unused",
        },
      });

      await client.ping();
      assert.equal(await client.getSecret("secret-1"), "mocked:secret-1");
      assert.equal(await client.getSecret("secret-2"), "mocked:secret-2");
    });

    assert.equal(calls.constructions.length, 1);
    assert.equal(calls.logins.length, 1);
    assert.equal(calls.logins[0].accessToken, "bws-token");
    assert.match(calls.logins[0].stateFile, /bitwarden\/default\.json$/);
    assert.deepEqual(calls.gets, ["secret-1", "secret-2"]);
  } finally {
    resetBitwardenSdkLoaderForTests();
    await cleanupTempHome(homePath);
  }
});

test("BitwardenClient creates a profile state path under user state directory", { concurrency: false }, async () => {
  const homePath = await makeTempHome();
  const calls = installSdkMock();

  try {
    await withPatchedEnv({ HOME: homePath }, async () => {
      const client = new BitwardenClient("prod", {
        accessToken: "bws-token",
        apiUrl: undefined,
        identityUrl: undefined,
        credentialStore: {
          type: "file",
          path: "/unused",
        },
      });

      await client.ping();
    });

    assert.equal(
      calls.logins[0].stateFile,
      pathInHome(homePath, ".local", "state", "bitwarden-agent-secrets", "bitwarden", "prod.json"),
    );
    await access(pathInHome(homePath, ".local", "state", "bitwarden-agent-secrets", "bitwarden"));
  } finally {
    resetBitwardenSdkLoaderForTests();
    await cleanupTempHome(homePath);
  }
});
