import { normalizeBitrixUser } from "./normalize-user";
import { parseBitrixUserId } from "./parse-id";
import { SAFE_READ_MESSAGES } from "./safe-errors";
import { callBitrix24Method, createOperationContext } from "./transport";
import { validateUsersTransportPage } from "./validate-envelope";
import type {
  Bitrix24NormalizedUser,
  Bitrix24OperationContext,
  Bitrix24WebhookConfig,
} from "./types";

export { parseBitrixUserId } from "./parse-id";

export type ReadBitrixUserResult =
  | { ok: true; user: Bitrix24NormalizedUser }
  | { ok: false; code: string; message: string };

export type ReadBitrixUserOptions = {
  operation?: Bitrix24OperationContext;
  startedAtMs?: number;
};

export async function readBitrixUserById(
  config: Bitrix24WebhookConfig,
  bitrixUserId: string,
  options: ReadBitrixUserOptions = {},
): Promise<ReadBitrixUserResult> {
  const parsedId = parseBitrixUserId(bitrixUserId);
  if (!parsedId) {
    return {
      ok: false,
      code: "INVALID_USER_ID",
      message: SAFE_READ_MESSAGES.INVALID_USER_ID,
    };
  }

  const operation =
    options.operation ?? createOperationContext(config, options.startedAtMs);

  const transport = await callBitrix24Method(
    config,
    "user.get",
    {
      filter: { ID: parsedId },
      select: ["ID", "ACTIVE"],
    },
    { operation },
  );

  if (!transport.ok) {
    return {
      ok: false,
      code: transport.code,
      message: transport.message,
    };
  }

  const page = validateUsersTransportPage(transport);
  if (!page.ok) {
    return {
      ok: false,
      code: "INVALID_ENVELOPE",
      message: SAFE_READ_MESSAGES.INVALID_ENVELOPE,
    };
  }

  const users = page.users
    .map((entry) => normalizeBitrixUser(config.portalHost, entry))
    .filter((entry): entry is Bitrix24NormalizedUser => entry !== null);

  const user = users.find((entry) => entry.bitrixUserId === parsedId);
  if (!user) {
    return {
      ok: false,
      code: "USER_NOT_FOUND",
      message: SAFE_READ_MESSAGES.USER_NOT_FOUND,
    };
  }

  return { ok: true, user };
}
