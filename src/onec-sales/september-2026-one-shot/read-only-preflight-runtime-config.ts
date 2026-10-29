import { EXPECTED_SOURCE_FILES } from "./scope-pins";
import type { SeptemberSourceBuffers } from "./source-pins";

export type SeptemberReadOnlyRuntimeConfigV1 = {
  v: 1;
  databaseUrl: string;
  sources: Record<
    keyof typeof EXPECTED_SOURCE_FILES,
    { path: string; contentBase64: string }
  >;
};

const SOURCE_KEYS = Object.keys(EXPECTED_SOURCE_FILES) as (keyof typeof EXPECTED_SOURCE_FILES)[];

export function parseSeptemberReadOnlyRuntimeConfig(
  raw: unknown,
): { ok: true; config: SeptemberReadOnlyRuntimeConfigV1; buffers: SeptemberSourceBuffers } | { ok: false; code: string; message: string } {
  if (!raw || typeof raw !== "object") {
    return { ok: false, code: "RUNTIME_CONFIG_INVALID", message: "Runtime config must be a JSON object." };
  }
  const obj = raw as Record<string, unknown>;
  if (obj.v !== 1) {
    return { ok: false, code: "RUNTIME_CONFIG_VERSION", message: "Expected runtime config v: 1." };
  }
  const databaseUrl = typeof obj.databaseUrl === "string" ? obj.databaseUrl.trim() : "";
  if (!databaseUrl) {
    return { ok: false, code: "DATABASE_URL_MISSING", message: "databaseUrl required in runtime config." };
  }
  if (!obj.sources || typeof obj.sources !== "object") {
    return { ok: false, code: "SOURCES_MISSING", message: "sources object required with all four FTP inputs." };
  }
  const sourcesObj = obj.sources as Record<string, unknown>;
  const buffers = {} as SeptemberSourceBuffers;
  for (const key of SOURCE_KEYS) {
    const entry = sourcesObj[key];
    if (!entry || typeof entry !== "object") {
      return { ok: false, code: "SOURCE_INPUT_MISSING", message: `Missing source config: ${key}` };
    }
    const path = typeof (entry as { path?: string }).path === "string" ? (entry as { path: string }).path : "";
    const contentBase64 =
      typeof (entry as { contentBase64?: string }).contentBase64 === "string"
        ? (entry as { contentBase64: string }).contentBase64
        : "";
    if (path !== EXPECTED_SOURCE_FILES[key].path) {
      return {
        ok: false,
        code: "SOURCE_PATH_PIN_MISMATCH",
        message: `Source path for ${key} must be pinned FTP path ${EXPECTED_SOURCE_FILES[key].path}.`,
      };
    }
    if (!contentBase64) {
      return { ok: false, code: "SOURCE_CONTENT_MISSING", message: `contentBase64 required for ${key}.` };
    }
    buffers[key] = Buffer.from(contentBase64, "base64");
    if (buffers[key].length === 0) {
      return { ok: false, code: "SOURCE_CONTENT_EMPTY", message: `Empty buffer for ${key}.` };
    }
  }
  const config: SeptemberReadOnlyRuntimeConfigV1 = {
    v: 1,
    databaseUrl,
    sources: SOURCE_KEYS.reduce(
      (acc, key) => {
        acc[key] = {
          path: EXPECTED_SOURCE_FILES[key].path,
          contentBase64: (sourcesObj[key] as { contentBase64: string }).contentBase64,
        };
        return acc;
      },
      {} as SeptemberReadOnlyRuntimeConfigV1["sources"],
    ),
  };
  return { ok: true, config, buffers };
}
