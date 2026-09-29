import { normalizeBitrixUser } from "./normalize-user";
import { callBitrix24Method, type Bitrix24TransportOptions } from "./transport";
import type { Bitrix24NormalizedUser, Bitrix24TransportResult, Bitrix24WebhookConfig } from "./types";

export function parseBitrixUserId(raw: string): string | null {
  const trimmed = raw.trim();
  if (!/^\d+$/.test(trimmed)) {
    return null;
  }
  if (trimmed === "0") {
    return null;
  }
  return trimmed;
}

function extractUserList(result: unknown): unknown[] {
  if (Array.isArray(result)) {
    return result;
  }
  if (result && typeof result === "object") {
    const record = result as Record<string, unknown>;
    if (Array.isArray(record.users)) {
      return record.users;
    }
  }
  return [];
}

export type ReadBitrixUserResult =
  | { ok: true; user: Bitrix24NormalizedUser }
  | { ok: false; code: string; message: string; transport: Bitrix24TransportResult };

export async function readBitrixUserById(
  config: Bitrix24WebhookConfig,
  bitrixUserId: string,
  options: Bitrix24TransportOptions = {},
): Promise<ReadBitrixUserResult> {
  const parsedId = parseBitrixUserId(bitrixUserId);
  if (!parsedId) {
    return {
      ok: false,
      code: "INVALID_USER_ID",
      message: "Bitrix24 user ID must be a positive integer.",
      transport: {
        ok: false,
        code: "API_ERROR",
        message: "Invalid Bitrix24 user ID.",
        retryable: false,
      },
    };
  }

  const transport = await callBitrix24Method(
    config,
    "user.get",
    {
      filter: { ID: parsedId },
      select: ["ID", "ACTIVE"],
    },
    options,
  );

  if (!transport.ok) {
    return {
      ok: false,
      code: transport.code,
      message: transport.message,
      transport,
    };
  }

  const users = extractUserList(transport.result)
    .map((entry) => normalizeBitrixUser(config.portalHost, entry))
    .filter((entry): entry is Bitrix24NormalizedUser => entry !== null);

  const user = users.find((entry) => entry.bitrixUserId === parsedId);
  if (!user) {
    return {
      ok: false,
      code: "USER_NOT_FOUND",
      message: "Bitrix24 user was not found for the requested ID.",
      transport,
    };
  }

  return { ok: true, user };
}
