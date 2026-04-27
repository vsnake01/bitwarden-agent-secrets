import { emitKeypressEvents } from "node:readline";
import { createInterface } from "node:readline/promises";

import { writeStderr, writeStdout } from "./io.js";

type TokenPromptRunner = (label: string) => Promise<string>;
type ConfirmPromptRunner = (label: string) => Promise<boolean>;
type LinePromptRunner = (label: string) => Promise<string>;

let tokenPromptRunner: TokenPromptRunner = promptHiddenLine;
let confirmPromptRunner: ConfirmPromptRunner = promptConfirmLine;
let linePromptRunner: LinePromptRunner = promptLineRaw;

export function setTokenPromptForTests(runner: TokenPromptRunner): void {
  tokenPromptRunner = runner;
}

export function resetTokenPromptForTests(): void {
  tokenPromptRunner = promptHiddenLine;
}

export function setConfirmPromptForTests(runner: ConfirmPromptRunner): void {
  confirmPromptRunner = runner;
}

export function resetConfirmPromptForTests(): void {
  confirmPromptRunner = promptConfirmLine;
}

export function setLinePromptForTests(runner: LinePromptRunner): void {
  linePromptRunner = runner;
}

export function resetLinePromptForTests(): void {
  linePromptRunner = promptLineRaw;
}

export async function promptAccessToken(): Promise<string> {
  return tokenPromptRunner("Bitwarden Secrets Manager machine account token: ");
}

export async function confirmPrompt(label: string): Promise<boolean> {
  return confirmPromptRunner(label);
}

export async function promptLine(label: string): Promise<string> {
  return linePromptRunner(label);
}

async function promptLineRaw(label: string): Promise<string> {
  const readline = createInterface({
    input: process.stdin,
    output: process.stderr,
  });

  try {
    return (await readline.question(label)).trim();
  } finally {
    readline.close();
  }
}

async function promptConfirmLine(label: string): Promise<boolean> {
  const answer = (await promptLine(`${label} [y/N] `)).trim().toLowerCase();
  return answer === "y" || answer === "yes";
}

async function promptHiddenLine(label: string): Promise<string> {
  if (!process.stdin.isTTY || !process.stdin.setRawMode) {
    throw new Error("Interactive token prompt requires a TTY. Use --access-token-stdin for automation.");
  }

  await writeStderr(label);
  process.stdin.resume();
  process.stdin.setEncoding("utf8");
  process.stdin.setRawMode(true);

  let value = "";
  let onData: ((chunk: string) => void) | undefined;

  try {
    return await new Promise<string>((resolve, reject) => {
      onData = (chunk: string) => {
        for (const char of chunk) {
          if (char === "\u0003") {
            reject(new Error("Token prompt cancelled."));
            return;
          }

          if (char === "\r" || char === "\n") {
            resolve(value.trim());
            return;
          }

          if (char === "\u007f" || char === "\b") {
            value = value.slice(0, -1);
            continue;
          }

          value += char;
        }
      };

      process.stdin.on("data", onData);
    });
  } finally {
    process.stdin.setRawMode(false);
    await writeStderr("\n");
    process.stdin.pause();
    if (onData) {
      process.stdin.off("data", onData);
    }
  }
}

export interface CheckboxItem<T extends string> {
  value: T;
  label: string;
  selected: boolean;
}

export async function checkboxPrompt<T extends string>(
  title: string,
  items: CheckboxItem<T>[],
): Promise<T[]> {
  if (!process.stdin.isTTY || !process.stdin.setRawMode) {
    const answer = await promptLine(`${title}\nSelect numbers separated by comma: `);
    const indexes = new Set(
      answer
        .split(",")
        .map((part) => Number.parseInt(part.trim(), 10) - 1)
        .filter((index) => Number.isInteger(index) && index >= 0 && index < items.length),
    );
    return items.filter((_, index) => indexes.has(index)).map((item) => item.value);
  }

  emitKeypressEvents(process.stdin);
  process.stdin.resume();
  process.stdin.setRawMode(true);

  const selected = new Set(items.filter((item) => item.selected).map((item) => item.value));
  let cursor = 0;

  const render = async () => {
    await writeStdout("\x1b[2J\x1b[H");
    await writeStdout(`${title}\n\n`);
    await writeStdout("Use Up/Down, Space to toggle, Enter to continue.\n\n");
    for (let index = 0; index < items.length; index += 1) {
      const item = items[index];
      const pointer = index === cursor ? ">" : " ";
      const checkbox = selected.has(item.value) ? "[x]" : "[ ]";
      await writeStdout(`${pointer} ${checkbox} ${item.label}\n`);
    }
  };

  try {
    await render();
    let onKeypress: ((_str: string, key: { name?: string; ctrl?: boolean }) => Promise<void>) | undefined;
    return await new Promise<T[]>((resolve, reject) => {
      onKeypress = async (_str: string, key: { name?: string; ctrl?: boolean }) => {
        if (key.ctrl && key.name === "c") {
          reject(new Error("Selection cancelled."));
          return;
        }

        if (key.name === "up") {
          cursor = Math.max(0, cursor - 1);
          await render();
          return;
        }

        if (key.name === "down") {
          cursor = Math.min(items.length - 1, cursor + 1);
          await render();
          return;
        }

        if (key.name === "space") {
          const value = items[cursor].value;
          if (selected.has(value)) {
            selected.delete(value);
          } else {
            selected.add(value);
          }
          await render();
          return;
        }

        if (key.name === "return") {
          resolve(items.filter((item) => selected.has(item.value)).map((item) => item.value));
        }
      };

      process.stdin.on("keypress", onKeypress);
    }).finally(() => {
      if (onKeypress) {
        process.stdin.off("keypress", onKeypress);
      }
    });
  } finally {
    process.stdin.setRawMode(false);
    process.stdin.pause();
    await writeStdout("\n");
  }
}
