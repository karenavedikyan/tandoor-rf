import type { PoolClient } from "pg";
import { upsertVerifiedPerson, type ExternalPersonRow } from "../../tan-tracker/external-person/person-service";

type RegistrationResult =
  | { ok: true; person: ExternalPersonRow }
  | { ok: false; text: string };

/** Own-contact authenticity is checked by each messenger before this call.
 * Permit approved self-registration through the canonical external-party resolver.
 * Employee collisions, duplicates and identity conflicts remain rejected.
 * Unexpected/database errors must still roll back the webhook transaction.
 */
export async function registerVerifiedBotContact(
  client: PoolClient,
  input: Omit<Parameters<typeof upsertVerifiedPerson>[1], "allowSelfRegistration">,
): Promise<RegistrationResult> {
  try {
    return { ok: true, person: await upsertVerifiedPerson(client, { ...input, allowSelfRegistration: true }) };
  } catch (error) {
    if (error instanceof Error && "http" in error && typeof error.http === "number" &&
      [400, 403, 409].includes(error.http)) {
      return { ok: false, text: `Не удалось подтвердить номер.\n\n${error.message}` };
    }
    throw error;
  }
}
