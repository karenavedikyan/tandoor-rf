import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import { readRemoteFileFromFtp } from "../onec-clients/ftp-read";
import { loadOnecFtpConfig } from "../onec-ftp/config";
import { validateTrustedOnecFtpConfig } from "../onec-import/trusted-config";
import { FILES, hash, MAX_BUNDLE_BYTES, MAX_FILE_BYTES, type FileKey, type ManualFiles } from "./model";

export type ManualReader = (relativePath: string) => Promise<Buffer>;
export async function readManualFiles(input: {
  env?: NodeJS.ProcessEnv; directory?: string; reader?: ManualReader;
}): Promise<ManualFiles> {
  const env = input.env ?? process.env;
  let read = input.reader;
  if (!read && input.directory) {
    const directory = input.directory;
    read = async relative => {
      const filename = path.join(directory, relative);
      if ((await stat(filename)).size > MAX_FILE_BYTES) throw new Error("FILE_TOO_LARGE");
      return readFile(filename);
    };
  }
  if (!read) {
    const loaded = loadOnecFtpConfig(env);
    if (!loaded.ok) throw new Error("CONFIG_ERROR");
    const trusted = validateTrustedOnecFtpConfig(env);
    if (!trusted.ok) throw new Error("CONFIG_INVALID");
    const config = loaded.config;
    read = async relative => {
      const result = await readRemoteFileFromFtp(config, config.basePath.replace(/\/+$/, "") + "/" + relative,
        MAX_FILE_BYTES, 30_000);
      if (!result.ok) throw new Error(result.code);
      return result.bytes;
    };
  }
  const files = {} as ManualFiles;
  const deadline = Date.now() + 240_000;
  let total = 0;
  for (const key of Object.keys(FILES) as FileKey[]) {
    let failure: unknown;
    for (const relative of FILES[key].paths) {
      if (Date.now() > deadline) throw new Error("TIMEOUT");
      try {
        const bytes = await read(relative);
        if (bytes.length > MAX_FILE_BYTES) throw new Error("FILE_TOO_LARGE");
        files[key] = { bytes, sourceName: relative }; break;
      } catch (error) {
        failure = error;
        if (error instanceof Error && /FILE_TOO_LARGE|TIMEOUT/.test(error.message)) throw error;
      }
    }
    if (!files[key]) throw new Error(`SOURCE_UNREADABLE:${key}`);
    total += files[key].bytes.length;
    if (total > MAX_BUNDLE_BYTES) throw new Error("FILE_TOO_LARGE");
    void failure;
  }
  // Second full pass, pinned names: no fallback to another generation/path.
  for (const key of Object.keys(FILES) as FileKey[]) {
    if (Date.now() > deadline) throw new Error("TIMEOUT");
    const bytes = await read(files[key].sourceName);
    if (hash(bytes) !== hash(files[key].bytes)) throw new Error("BUNDLE_UNSTABLE");
  }
  return files;
}
