import readline from "readline";

export async function askLine(label: string): Promise<string> {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
    terminal: true,
  });

  try {
    return await new Promise<string>((resolve) => {
      rl.question(label, (value) => resolve(value.trim()));
    });
  } finally {
    rl.close();
  }
}

export async function askHidden(label: string): Promise<string> {
  const stdin = process.stdin;
  const stdout = process.stdout;

  if (!stdin.isTTY || !stdout.isTTY) {
    throw new Error("Interactive password input requires a TTY.");
  }

  stdout.write(label);

  const previousRawMode = stdin.isRaw ?? false;
  stdin.setRawMode?.(true);
  stdin.resume();
  stdin.setEncoding("utf8");

  let password = "";

  try {
    return await new Promise<string>((resolve, reject) => {
      const cleanup = (): void => {
        stdin.removeListener("data", onData);
        stdin.setRawMode?.(previousRawMode);
        stdin.pause();
      };

      const onData = (chunk: string): void => {
        for (const char of chunk) {
          switch (char) {
            case "\n":
            case "\r":
            case "\u0004":
              cleanup();
              stdout.write("\n");
              resolve(password);
              return;
            case "\u0003":
              cleanup();
              stdout.write("\n");
              reject(Object.assign(new Error("Interrupted."), { code: "INT" }));
              return;
            case "\u007f":
            case "\b":
              password = password.slice(0, -1);
              break;
            default:
              if (char >= " " || char > "\u007f") {
                password += char;
              }
              break;
          }
        }
      };

      stdin.on("data", onData);
    });
  } catch (error) {
    stdin.setRawMode?.(previousRawMode);
    stdin.pause();
    throw error;
  }
}
