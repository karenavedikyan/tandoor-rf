import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import path from "node:path";
import { MAX_SOURCE_BYTES } from "../onec-clients/constants";

export async function readBoundedBundleFile(
  bundleDir: string,
  relativePath: string,
  maxBytes: number = MAX_SOURCE_BYTES,
): Promise<Buffer> {
  const absolutePath = path.join(bundleDir, relativePath);
  let fileSize: number;
  try {
    const info = await stat(absolutePath);
    if (!info.isFile()) {
      throw Object.assign(new Error(`Required bundle file is missing or unreadable: ${relativePath}.`), {
        code: "BUNDLE_FILE_MISSING",
      });
    }
    fileSize = info.size;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      throw Object.assign(new Error(`Required bundle file is missing or unreadable: ${relativePath}.`), {
        code: "BUNDLE_FILE_MISSING",
      });
    }
    throw error;
  }

  if (fileSize > maxBytes) {
    throw Object.assign(
      new Error(`Bundle file ${relativePath} exceeds ${maxBytes} bytes (${fileSize} bytes on disk).`),
      { code: "FILE_TOO_LARGE" },
    );
  }

  const chunks: Buffer[] = [];
  let total = 0;

  await new Promise<void>((resolve, reject) => {
    const stream = createReadStream(absolutePath);
    stream.on("data", (chunk: Buffer | string) => {
      const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      total += buffer.length;
      if (total > maxBytes) {
        stream.destroy(
          Object.assign(new Error(`Bundle file ${relativePath} exceeds ${maxBytes} bytes while reading.`), {
            code: "FILE_TOO_LARGE",
          }),
        );
        return;
      }
      chunks.push(buffer);
    });
    stream.on("error", (error) => {
      if ((error as { code?: string }).code === "FILE_TOO_LARGE") {
        reject(error);
        return;
      }
      reject(
        Object.assign(new Error(`Required bundle file is missing or unreadable: ${relativePath}.`), {
          code: "BUNDLE_FILE_MISSING",
          cause: error,
        }),
      );
    });
    stream.on("end", () => resolve());
  });

  return Buffer.concat(chunks);
}
