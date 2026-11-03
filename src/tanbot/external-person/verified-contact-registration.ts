import type { PoolClient } from "pg";
import { upsertVerifiedPerson, type ExternalPersonRow } from "../../tan-tracker/external-person/person-service";

type RegistrationResult =
  | { ok: true; person: ExternalPersonRow }
  | { ok: false; text: string };

/** Own-contact authenticity is checked by each messenger before this call.
 * Keep canonical registration restrictions, but explain business rejections in chat.
 * Unexpected/database errors must still roll back the webhook transaction.
 */
export async function registerVerifiedBotContact(
  client: PoolClient,
  input: Parameters<typeof upsertVerifiedPerson>[1],
): Promise<RegistrationResult> {
  try {
    return { ok: true, person: await upsertVerifiedPerson(client, input) };
  } catch (error) {
    if (error instanceof Error && "http" in error && typeof error.http === "number" &&
      [400, 403, 409].includes(error.http)) {
      return { ok: false, text: `Не удалось подтвердить номер.\n\n${error.message}` };
    }
    throw error;
  }
}
