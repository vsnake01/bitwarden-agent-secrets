import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export const repoRoot = path.resolve(__dirname, "..");

export async function makeTempHome() {
  return mkdtemp(path.join(os.tmpdir(), "bas-test-home-"));
}

export async function cleanupTempHome(homePath) {
  await rm(homePath, { recursive: true, force: true });
}

export async function readJson(filePath) {
  return JSON.parse(await readFile(filePath, "utf8"));
}

export async function withPatchedEnv(patch, fn) {
  const previous = new Map();

  for (const [key, value] of Object.entries(patch)) {
    previous.set(key, process.env[key]);
    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }

  try {
    return await fn();
  } finally {
    for (const [key, value] of previous.entries()) {
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
  }
}

export async function captureStdout(fn) {
  let output = "";
  const originalWrite = process.stdout.write.bind(process.stdout);

  process.stdout.write = ((chunk, encoding, callback) => {
    output += chunk instanceof Buffer ? chunk.toString("utf8") : String(chunk);

    if (typeof encoding === "function") {
      encoding();
    } else if (typeof callback === "function") {
      callback();
    }

    return true;
  });

  try {
    await fn();
    return output;
  } finally {
    process.stdout.write = originalWrite;
  }
}

export async function captureStderr(fn) {
  let output = "";
  const originalWrite = process.stderr.write.bind(process.stderr);

  process.stderr.write = ((chunk, encoding, callback) => {
    output += chunk instanceof Buffer ? chunk.toString("utf8") : String(chunk);

    if (typeof encoding === "function") {
      encoding();
    } else if (typeof callback === "function") {
      callback();
    }

    return true;
  });

  try {
    await fn();
    return output;
  } finally {
    process.stderr.write = originalWrite;
  }
}

export function pathInHome(homePath, ...segments) {
  return path.join(homePath, ...segments);
}
