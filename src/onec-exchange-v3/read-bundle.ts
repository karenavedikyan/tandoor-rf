import fs from "node:fs/promises";
import path from "node:path";
import { readRemoteFileFromFtp } from "../onec-clients/ftp-read";
import type { OnecFtpConfig } from "../onec-ftp/types";
import { V3_BUNDLE_FILES, V3_FTP_CLIENTS_DIR, V3_MAX_FILE_BYTES } from "./constants";

export type V3BundleBytes = {
  holdingsBytes: Buffer;
  clientsBytes: Buffer;
  retailBytes: Buffer;
  employeesBytes: Buffer;
};

async function readBoundedFile(readFile: () => Promise<Buffer>, label: string): Promise<{ ok: true; bytes: Buffer } | { ok: false; message: string }> {
  try {
    const bytes = await readFile();
    if (bytes.length > V3_MAX_FILE_BYTES) {
      return { ok: false, message: `${label}: файл слишком большой` };
    }
    return { ok: true, bytes };
  } catch (error) {
    return { ok: false, message: `${label}: ${error instanceof Error ? error.message : String(error)}` };
  }
}

export async function readV3BundleFromDirectory(bundleDir: string): Promise<{ ok: true; bundle: V3BundleBytes } | { ok: false; message: string }> {
  const holdings = await readBoundedFile(
    () => fs.readFile(path.join(bundleDir, V3_BUNDLE_FILES.holdings)),
    V3_BUNDLE_FILES.holdings,
  );
  if (!holdings.ok) return { ok: false, message: holdings.message };
  const clients = await readBoundedFile(
    () => fs.readFile(path.join(bundleDir, V3_BUNDLE_FILES.clients)),
    V3_BUNDLE_FILES.clients,
  );
  if (!clients.ok) return { ok: false, message: clients.message };
  const retail = await readBoundedFile(
    () => fs.readFile(path.join(bundleDir, V3_BUNDLE_FILES.retail)),
    V3_BUNDLE_FILES.retail,
  );
  if (!retail.ok) return { ok: false, message: retail.message };
  const employees = await readBoundedFile(
    () => fs.readFile(path.join(bundleDir, V3_BUNDLE_FILES.employees)),
    V3_BUNDLE_FILES.employees,
  );
  if (!employees.ok) return { ok: false, message: employees.message };
  return {
    ok: true,
    bundle: {
      holdingsBytes: holdings.bytes,
      clientsBytes: clients.bytes,
      retailBytes: retail.bytes,
      employeesBytes: employees.bytes,
    },
  };
}

export async function readV3BundleFromFtp(
  config: OnecFtpConfig,
): Promise<{ ok: true; bundle: V3BundleBytes } | { ok: false; message: string; code?: string }> {
  const prefix = `${config.basePath.replace(/\/$/, "")}/${V3_FTP_CLIENTS_DIR}`;
  const readRemote = async (fileName: string) => {
    const remotePath = `${prefix}/${fileName}`;
    const result = await readRemoteFileFromFtp(config, remotePath, V3_MAX_FILE_BYTES);
    if (!result.ok) {
      return { ok: false as const, message: `${fileName}: ${result.message}`, code: result.code };
    }
    return readBoundedFile(async () => result.bytes, fileName);
  };

  const holdings = await readRemote(V3_BUNDLE_FILES.holdings);
  if (!holdings.ok) return holdings;
  const clients = await readRemote(V3_BUNDLE_FILES.clients);
  if (!clients.ok) return clients;
  const retail = await readRemote(V3_BUNDLE_FILES.retail);
  if (!retail.ok) return retail;
  const employees = await readRemote(V3_BUNDLE_FILES.employees);
  if (!employees.ok) return employees;

  return {
    ok: true,
    bundle: {
      holdingsBytes: holdings.bytes,
      clientsBytes: clients.bytes,
      retailBytes: retail.bytes,
      employeesBytes: employees.bytes,
    },
  };
}
