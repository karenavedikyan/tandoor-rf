import { constants, promises as fs } from "node:fs";
import path from "node:path";

export type PasswordDeliverySpec =
  | { kind: "file"; filePath: string }
  | { kind: "tty" };

export function parsePasswordDeliverySpec(raw: string | undefined): PasswordDeliverySpec | null {
  if (!raw) {
    return process.stdout.isTTY ? { kind: "tty" } : null;
  }
  if (raw.startsWith("file:")) {
    const filePath = raw.slice("file:".length).trim();
    return filePath ? { kind: "file", filePath: path.resolve(filePath) } : null;
  }
  return null;
}

/** Verify delivery channel before creating an account (no password written). */
export async function verifyPasswordDeliveryChannel(spec: PasswordDeliverySpec): Promise<void> {
  if (spec.kind === "tty") {
    if (!process.stdout.isTTY) {
      throw new Error(
        "Password delivery channel unavailable: stdout is not a TTY. Use --password-delivery file:<path>.",
      );
    }
    return;
  }

  const targetPath = spec.filePath;
  if (targetPath.includes("\0")) {
    throw new Error("Invalid password delivery path.");
  }

  let pathStat;
  try {
    pathStat = await fs.lstat(targetPath);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      pathStat = null;
    } else {
      throw error;
    }
  }

  if (pathStat) {
    if (pathStat.isSymbolicLink()) {
      throw new Error("Password delivery path must not be a symlink.");
    }
    throw new Error("Password delivery file already exists; refusing to overwrite.");
  }

  const parentPath = path.dirname(targetPath);
  let parentStat;
  try {
    parentStat = await fs.lstat(parentPath);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
      throw error;
    }
  }

  if (parentStat?.isSymbolicLink()) {
    throw new Error("Password delivery directory must not be a symlink.");
  }

  await fs.mkdir(parentPath, { recursive: true });

  const reopenedParent = await fs.lstat(parentPath);
  if (reopenedParent.isSymbolicLink()) {
    throw new Error("Password delivery directory must not be a symlink.");
  }
}

export async function deliverTemporaryPasswordToChannel(
  password: string,
  spec: PasswordDeliverySpec,
): Promise<void> {
  if (spec.kind === "file") {
    const content = [
      "# Временный пароль ЛК Tandoor (одноразовая выдача)",
      "# Передайте получателю по защищённому каналу и удалите файл.",
      password,
      "",
    ].join("\n");
    const handle = await fs.open(
      spec.filePath,
      constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL,
      0o600,
    );
    try {
      await handle.writeFile(content, "utf8");
    } finally {
      await handle.close();
    }
    console.log(`Temporary password written to ${spec.filePath} (exclusive, mode 0600).`);
    return;
  }

  console.log("---");
  console.log("Временный пароль (показывается один раз; не логируйте и не коммитьте):");
  console.log(password);
  console.log("---");
  console.log("Передайте пароль получателю по защищённому каналу. Смена обязательна при первом входе.");
}
