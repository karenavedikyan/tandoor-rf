import type { AccessContext } from "../access/types";
import { V3_CLIENT_OTHER_INVENTORY_KEYS } from "./other-fields";
import { otherFieldsBagCompleteForSource } from "./other-fields-presence";
import {
  canViewRestrictedLegalOtherFields,
  presentLegalOtherFieldsForApi,
  sanitizeClientOtherFields,
} from "./sanitize-client-other";

export type LegalOtherFieldState = "shown" | "empty_1c" | "not_ingested" | "restricted";

const RESTRICTED_KEYS = new Set(["ГруппаДоступа", "ДатаРождения", "Пол"]);

function valueIsEmpty(value: unknown): boolean {
  return value === null || value === undefined || value === "";
}

export function computeLegalOtherFieldStates(
  raw: Record<string, unknown> | null | undefined,
  context: AccessContext,
  lastSourceSha256: string | null | undefined,
): Record<string, LegalOtherFieldState> {
  const sanitized = sanitizeClientOtherFields(raw);
  const presented = presentLegalOtherFieldsForApi(raw, context);
  const complete = otherFieldsBagCompleteForSource(raw, lastSourceSha256);
  const privileged = canViewRestrictedLegalOtherFields(context);
  const states: Record<string, LegalOtherFieldState> = {};

  for (const key of V3_CLIENT_OTHER_INVENTORY_KEYS) {
    if (!privileged && RESTRICTED_KEYS.has(key) && Object.prototype.hasOwnProperty.call(sanitized, key)) {
      states[key] = "restricted";
      continue;
    }
    if (Object.prototype.hasOwnProperty.call(presented, key)) {
      states[key] = valueIsEmpty(presented[key]) ? "empty_1c" : "shown";
      continue;
    }
    if (complete) {
      states[key] = "empty_1c";
      continue;
    }
    states[key] = "not_ingested";
  }
  return states;
}
