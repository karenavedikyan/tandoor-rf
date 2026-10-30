import { readBoundedResponseBytes } from "./bounded-body";

const DEFAULT_TIMEOUT_MS = 30_000;

export type BoundedBinaryFetchResult =
  | { ok: true; buffer: Buffer }
  | { ok: false; code: "TIMEOUT" | "REDIRECT" | "HTTP_ERROR" | "TOO_LARGE" | "READ_FAILED" | "NOT_IMAGE" };

export async function fetchBoundedBinary(
  url: string,
  maxBytes: number,
  timeoutMs: number = DEFAULT_TIMEOUT_MS,
): Promise<BoundedBinaryFetchResult> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      method: "GET",
      redirect: "error",
      signal: controller.signal,
    });
    if (res.status >= 300 && res.status < 400) {
      return { ok: false, code: "REDIRECT" };
    }
    if (!res.ok) {
      return { ok: false, code: "HTTP_ERROR" };
    }
    const body = await readBoundedResponseBytes(res, maxBytes);
    if (!body.ok) {
      return { ok: false, code: body.code === "RESPONSE_TOO_LARGE" ? "TOO_LARGE" : "READ_FAILED" };
    }
    const buffer = body.buffer;
    const mime = detectImageMimeFromMagic(buffer);
    if (!mime) {
      return { ok: false, code: "NOT_IMAGE" };
    }
    return { ok: true, buffer };
  } catch (err: unknown) {
    if (err instanceof Error && err.name === "AbortError") {
      return { ok: false, code: "TIMEOUT" };
    }
    const cause = err as { cause?: { code?: string } };
    if (cause.cause?.code === "ERR_UNHANDLED_REDIRECT") {
      return { ok: false, code: "REDIRECT" };
    }
    return { ok: false, code: "READ_FAILED" };
  } finally {
    clearTimeout(timer);
  }
}

export function detectImageMimeFromMagic(buffer: Buffer): string | null {
  if (buffer.length < 4) return null;
  if (buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) return "image/jpeg";
  if (
    buffer[0] === 0x89 &&
    buffer[1] === 0x50 &&
    buffer[2] === 0x4e &&
    buffer[3] === 0x47 &&
    buffer[4] === 0x0d &&
    buffer[5] === 0x0a &&
    buffer[6] === 0x1a &&
    buffer[7] === 0x0a
  ) {
    return "image/png";
  }
  if (buffer[0] === 0x47 && buffer[1] === 0x49 && buffer[2] === 0x46 && buffer[3] === 0x38) {
    return "image/gif";
  }
  if (
    buffer.length >= 12 &&
    buffer.slice(0, 4).toString("ascii") === "RIFF" &&
    buffer.slice(8, 12).toString("ascii") === "WEBP"
  ) {
    return "image/webp";
  }
  return null;
}
