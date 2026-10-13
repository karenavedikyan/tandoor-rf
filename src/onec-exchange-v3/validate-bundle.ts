import { parseWholesaleEmployeeRosterBytes } from "../onec-clients/employee-roster";
import { V3_BUNDLE_FILES, V3_MAX_RECORDS } from "./constants";
import { computeBundleFingerprint, sha256Buffer } from "./bundle-fingerprint";
import { parseHoldingRecord, parseLegalRecord, parseRetailRecord } from "./parse-records";
import type { V3ValidatedBundle } from "./types";

function parseJsonArray(bytes: Buffer, label: string): { ok: true; rows: unknown[] } | { ok: false; message: string } {
  let parsed: unknown;
  try {
    parsed = JSON.parse(bytes.toString("utf8"));
  } catch {
    return { ok: false, message: `${label}: невалидный JSON` };
  }
  if (!Array.isArray(parsed)) {
    return { ok: false, message: `${label}: ожидается JSON-массив в корне` };
  }
  if (parsed.length > V3_MAX_RECORDS) {
    return { ok: false, message: `${label}: слишком много записей` };
  }
  return { ok: true, rows: parsed };
}

export type ValidateBundleInput = {
  holdingsBytes: Buffer;
  clientsBytes: Buffer;
  retailBytes: Buffer;
  employeesBytes: Buffer;
};

export function validateExchangeV3Bundle(input: ValidateBundleInput):
  | { ok: true; bundle: V3ValidatedBundle }
  | { ok: false; errorCode: string; message: string } {
  const fileSha256 = {
    [V3_BUNDLE_FILES.holdings]: sha256Buffer(input.holdingsBytes),
    [V3_BUNDLE_FILES.clients]: sha256Buffer(input.clientsBytes),
    [V3_BUNDLE_FILES.retail]: sha256Buffer(input.retailBytes),
    [V3_BUNDLE_FILES.employees]: sha256Buffer(input.employeesBytes),
  };
  const bundleFingerprint = computeBundleFingerprint(fileSha256);

  const holdingsParsed = parseJsonArray(input.holdingsBytes, V3_BUNDLE_FILES.holdings);
  if (!holdingsParsed.ok) {
    return { ok: false, errorCode: "INVALID_HOLDINGS", message: holdingsParsed.message };
  }
  const clientsParsed = parseJsonArray(input.clientsBytes, V3_BUNDLE_FILES.clients);
  if (!clientsParsed.ok) {
    return { ok: false, errorCode: "INVALID_CLIENTS", message: clientsParsed.message };
  }
  const retailParsed = parseJsonArray(input.retailBytes, V3_BUNDLE_FILES.retail);
  if (!retailParsed.ok) {
    return { ok: false, errorCode: "INVALID_RETAIL", message: retailParsed.message };
  }

  const rosterParsed = parseWholesaleEmployeeRosterBytes(input.employeesBytes);
  if (!rosterParsed.ok) {
    return { ok: false, errorCode: "INVALID_EMPLOYEES", message: rosterParsed.message };
  }
  const employeeRoster = rosterParsed.roster;

  const structuralErrors: string[] = [];
  const holdings: NonNullable<ReturnType<typeof parseHoldingRecord>>[] = [];
  const holdingIds = new Set<string>();
  for (const row of holdingsParsed.rows) {
    const parsed = parseHoldingRecord(row, structuralErrors);
    if (!parsed) {
      continue;
    }
    if (holdingIds.has(parsed.guidHolding)) {
      structuralErrors.push(`Дубликат guid_holding: ${parsed.guidHolding}`);
      continue;
    }
    holdingIds.add(parsed.guidHolding);
    holdings.push(parsed);
  }

  const legalEntities: NonNullable<ReturnType<typeof parseLegalRecord>>[] = [];
  const legalIds = new Set<string>();
  for (const row of clientsParsed.rows) {
    const parsed = parseLegalRecord(row, structuralErrors);
    if (!parsed) {
      continue;
    }
    if (legalIds.has(parsed.guidClient)) {
      structuralErrors.push(`Дубликат guid_client: ${parsed.guidClient}`);
      continue;
    }
    legalIds.add(parsed.guidClient);
    legalEntities.push(parsed);
  }

  const retailOutlets: NonNullable<ReturnType<typeof parseRetailRecord>>[] = [];
  const storeIds = new Set<string>();
  for (const row of retailParsed.rows) {
    const parsed = parseRetailRecord(row, structuralErrors);
    if (!parsed) {
      continue;
    }
    if (storeIds.has(parsed.guidStore)) {
      structuralErrors.push(`Дубликат guid_store: ${parsed.guidStore}`);
      continue;
    }
    storeIds.add(parsed.guidStore);
    retailOutlets.push(parsed);
  }

  if (structuralErrors.length > 0) {
    return {
      ok: false,
      errorCode: "STRUCTURAL_ERRORS",
      message: structuralErrors.slice(0, 20).join("; "),
    };
  }

  const warnings: string[] = [];
  const wholesaleGuids = employeeRoster.wholesaleGuids;

  for (const legal of legalEntities) {
    if (legal.guidHolding && !holdingIds.has(legal.guidHolding)) {
      warnings.push(`Юрлицо ${legal.guidClient}: guid_holding отсутствует в all_holding.json`);
    }
    if (!legal.guidHolding) {
      warnings.push(`Юрлицо ${legal.guidClient}: без холдинга`);
    }
    if (legal.managers.guidManager && !wholesaleGuids.has(legal.managers.guidManager)) {
      warnings.push(`Юрлицо ${legal.guidClient}: менеджер не в справочнике ОПТ`);
    }
  }

  for (const outlet of retailOutlets) {
    if (outlet.guidHolding && !holdingIds.has(outlet.guidHolding)) {
      warnings.push(`ТТ ${outlet.guidStore}: guid_holding отсутствует в all_holding.json`);
    }
    if (!outlet.guidHolding) {
      warnings.push(`ТТ ${outlet.guidStore}: без холдинга`);
    }
    if (outlet.managers.guidManager && !wholesaleGuids.has(outlet.managers.guidManager)) {
      warnings.push(`ТТ ${outlet.guidStore}: менеджер не в справочнике ОПТ`);
    }
  }

  for (const holding of holdings) {
    for (const member of holding.legalEntities) {
      if (member.zeroGuid) {
        warnings.push(`Холдинг ${holding.guidHolding}: нулевой UUID в legal_entities`);
        continue;
      }
      if (!legalIds.has(member.guidRetail)) {
        warnings.push(`Холдинг ${holding.guidHolding}: legal_entities ссылается на отсутствующее юрлицо ${member.guidRetail}`);
      }
    }
    for (const member of holding.retailOutlets) {
      if (member.zeroGuid) {
        warnings.push(`Холдинг ${holding.guidHolding}: нулевой UUID в retail_outlets`);
        continue;
      }
      if (!storeIds.has(member.guidRetail)) {
        warnings.push(`Холдинг ${holding.guidHolding}: retail_outlets ссылается на отсутствующую ТТ ${member.guidRetail}`);
      }
    }
  }

  // Membership conflicts: object guid_holding vs holding composition lists
  for (const legal of legalEntities) {
    if (!legal.guidHolding) {
      continue;
    }
    const holding = holdings.find((h) => h.guidHolding === legal.guidHolding);
    if (!holding) {
      continue;
    }
    const inComposition = holding.legalEntities.some((m) => !m.zeroGuid && m.guidRetail === legal.guidClient);
    if (!inComposition) {
      warnings.push(`Конфликт состава: юрлицо ${legal.guidClient} указывает холдинг ${legal.guidHolding}, но отсутствует в legal_entities холдинга`);
      legal.membershipConflict = true;
    }
  }

  for (const outlet of retailOutlets) {
    if (!outlet.guidHolding) {
      continue;
    }
    const holding = holdings.find((h) => h.guidHolding === outlet.guidHolding);
    if (!holding) {
      continue;
    }
    const inComposition = holding.retailOutlets.some((m) => !m.zeroGuid && m.guidRetail === outlet.guidStore);
    if (!inComposition) {
      warnings.push(`Конфликт состава: ТТ ${outlet.guidStore} указывает холдинг ${outlet.guidHolding}, но отсутствует в retail_outlets холдинга`);
      outlet.membershipConflict = true;
    }
  }

  return {
    ok: true,
    bundle: {
      holdings,
      legalEntities,
      retailOutlets,
      employeeRoster,
      fileSha256,
      bundleFingerprint,
      warnings,
    },
  };
}
