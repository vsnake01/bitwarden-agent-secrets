import { writeSync } from "node:fs";

const originalStdoutWrite = process.stdout.write;
const originalStderrWrite = process.stderr.write;

export async function writeStdout(message: string): Promise<void> {
  await writeStream(process.stdout, message);
}

export async function writeStderr(message: string): Promise<void> {
  await writeStream(process.stderr, message);
}

async function writeStream(
  stream: NodeJS.WriteStream,
  message: string,
): Promise<void> {
  const originalWrite =
    stream === process.stdout
      ? originalStdoutWrite
      : stream === process.stderr
        ? originalStderrWrite
        : undefined;
  if (originalWrite && stream.write !== originalWrite) {
    stream.write(message);
    return;
  }

  const fd = (stream as NodeJS.WriteStream & { fd?: number }).fd;
  if (typeof fd === "number") {
    writeSync(fd, message);
    return;
  }

  await new Promise<void>((resolve, reject) => {
    stream.write(message, (error) => {
      if (error) {
        reject(error);
        return;
      }

      resolve();
    });
  });
}
