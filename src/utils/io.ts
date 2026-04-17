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
