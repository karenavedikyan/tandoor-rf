export type BoundedBodyReadResult =
  | { ok: true; text: string; bytesRead: number }
  | { ok: false; code: "RESPONSE_TOO_LARGE" | "BODY_READ_FAILED" };

/**
 * Reads response body with a hard byte ceiling. Cancels the stream as soon as the limit is exceeded.
 */
export async function readBoundedResponseBody(
  response: Response,
  maxBytes: number,
): Promise<BoundedBodyReadResult> {
  if (!response.body) {
    const fallback = Buffer.from(await response.arrayBuffer());
    if (fallback.byteLength > maxBytes) {
      return { ok: false, code: "RESPONSE_TOO_LARGE" };
    }
    return { ok: true, text: fallback.toString("utf8"), bytesRead: fallback.byteLength };
  }

  const reader = response.body.getReader();
  const chunks: Buffer[] = [];
  let bytesRead = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!value?.byteLength) continue;
      bytesRead += value.byteLength;
      if (bytesRead > maxBytes) {
        try {
          await reader.cancel();
        } catch {
          /* ignore cancel errors */
        }
        return { ok: false, code: "RESPONSE_TOO_LARGE" };
      }
      chunks.push(Buffer.from(value));
    }
  } catch {
    return { ok: false, code: "BODY_READ_FAILED" };
  } finally {
    try {
      reader.releaseLock();
    } catch {
      /* ignore */
    }
  }

  const buffer = Buffer.concat(chunks);
  return { ok: true, text: buffer.toString("utf8"), bytesRead: buffer.byteLength };
}
