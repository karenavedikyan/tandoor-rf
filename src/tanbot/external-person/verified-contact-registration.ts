import type { PoolClient } from "pg";
import { upsertVerifiedPerson, type ExternalPersonRow } from "../../tan-tracker/external-person/person-service";
import { EmployeePhoneCollisionError } from "../../tan-tracker/phone-party-resolver";
import { getAppOrigin } from "../../config";

type RegistrationResult =
  | { ok: true; person: ExternalPersonRow }
  | { ok: false; text: string; requestContact?: false; profileUrl?: string };

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
    if (error instanceof EmployeePhoneCollisionError) {
      const channelLabel = input.channel === "max" ? "MAX" : "Telegram";
      const origin = getAppOrigin();
      const profileUrl = origin ? `${origin}/profile` : undefined;
      return {
        ok: false,
        requestContact: false,
        profileUrl,
        text: `Этот номер принадлежит сотруднику. Создавать передачи можно и в личном кабинете, и в ${channelLabel}.\n\n` +
          `Чтобы работать в боте от своего аккаунта сотрудника, войдите в личный кабинет, откройте «Мой профиль» ` +
          `и нажмите «Подключить ${channelLabel}». Откройте бота по полученной ссылке и нажмите Start.\n\n` +
          `После подключения вернитесь в меню бота и нажмите «Создать передачу». ` +
          `Созданные ранее передачи сохранятся; создавать их повторно не нужно.` +
          (profileUrl ? `\n\nМой профиль: ${profileUrl}` : ""),
      };
    }
    if (error instanceof Error && "http" in error && typeof error.http === "number" &&
      [400, 403, 409].includes(error.http)) {
      return { ok: false, text: `Не удалось подтвердить номер.\n\n${error.message}` };
    }
    throw error;
  }
}
