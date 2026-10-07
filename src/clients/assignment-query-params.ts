import {
  parseAssignmentPresenceMode,
  parseUuidListParam,
  type AssignmentPresenceMode,
} from "./assignment-filter-modes";
import type { ClientsEntityMode } from "./query";
import { isValidUuidParam } from "./uuid-param";

export type ResolvedAssignmentParams = {
  clientManagerId?: string;
  clientManagerIds?: string[];
  outletManagerId?: string;
  outletManagerIds?: string[];
  clientRegionalManagerId?: string;
  clientRegionalManagerIds?: string[];
  outletRegionalManagerId?: string;
  outletRegionalManagerIds?: string[];
  clientHardwareManagerId?: string;
  clientHardwareManagerIds?: string[];
  outletHardwareManagerId?: string;
  outletHardwareManagerIds?: string[];
  /** Legacy org-teams ROP filter (both levels when set alone). */
  ropEmployeeGuid?: string;
  clientRopEmployeeGuid?: string;
  outletRopEmployeeGuid?: string;
  clientManagerMode?: AssignmentPresenceMode;
  outletManagerMode?: AssignmentPresenceMode;
  clientRegionalManagerMode?: AssignmentPresenceMode;
  outletRegionalManagerMode?: AssignmentPresenceMode;
  clientHardwareManagerMode?: AssignmentPresenceMode;
  outletHardwareManagerMode?: AssignmentPresenceMode;
  clientRopEmployeeMode?: AssignmentPresenceMode;
  outletRopEmployeeMode?: AssignmentPresenceMode;
  missingClientManager?: boolean;
  missingOutletManager?: boolean;
  missingClientRegional?: boolean;
  missingOutletRegional?: boolean;
  missingClientHardware?: boolean;
  missingOutletHardware?: boolean;
  missingClientRop?: boolean;
  missingOutletRop?: boolean;
};

function singleId(ids: string[]): string | undefined {
  return ids.length === 1 ? ids[0] : undefined;
}

function pickIds(explicit: string[], legacy: string[], useLegacy: boolean): string[] {
  if (explicit.length > 0) {
    return explicit;
  }
  return useLegacy ? legacy : [];
}

export function resolveAssignmentParams(
  input: Record<string, unknown>,
  entity: ClientsEntityMode,
): { ok: true; params: ResolvedAssignmentParams } | { ok: false; message: string } {
  const legacyManager = parseUuidListParam(input.manager);
  if (legacyManager === null) {
    return { ok: false, message: "Некорректный фильтр менеджера." };
  }
  const clientManager = parseUuidListParam(input.clientManager);
  if (clientManager === null) {
    return { ok: false, message: "Некорректный фильтр менеджера клиента." };
  }
  const outletManager = parseUuidListParam(input.outletManager);
  if (outletManager === null) {
    return { ok: false, message: "Некорректный фильтр менеджера ТТ." };
  }

  const legacyRegional = parseUuidListParam(input.regionalManager);
  if (legacyRegional === null) {
    return { ok: false, message: "Некорректный фильтр регионального менеджера." };
  }
  const clientRegional = parseUuidListParam(input.clientRegionalManager);
  if (clientRegional === null) {
    return { ok: false, message: "Некорректный фильтр регионального менеджера клиента." };
  }
  const outletRegional = parseUuidListParam(input.outletRegionalManager);
  if (outletRegional === null) {
    return { ok: false, message: "Некорректный фильтр регионального менеджера ТТ." };
  }

  const legacyHardware = parseUuidListParam(input.hardwareManager);
  if (legacyHardware === null) {
    return { ok: false, message: "Некорректный фильтр менеджера по фурнитуре." };
  }
  const clientHardware = parseUuidListParam(input.clientHardwareManager);
  if (clientHardware === null) {
    return { ok: false, message: "Некорректный фильтр менеджера по фурнитуре клиента." };
  }
  const outletHardware = parseUuidListParam(input.outletHardwareManager);
  if (outletHardware === null) {
    return { ok: false, message: "Некорректный фильтр менеджера по фурнитуре ТТ." };
  }

  const clientManagerIds =
    clientManager.length > 0
      ? clientManager
      : entity === "clients" && legacyManager.length > 0
        ? legacyManager
        : [];
  const resolvedOutletManagerIds =
    outletManager.length > 0
      ? outletManager
      : entity === "outlets" && legacyManager.length > 0
        ? legacyManager
        : [];

  const clientRegionalIds = pickIds(
    clientRegional,
    legacyRegional,
    entity === "clients" && outletRegional.length === 0,
  );
  const outletRegionalIds =
    outletRegional.length > 0
      ? outletRegional
      : entity === "outlets" && legacyRegional.length > 0
        ? legacyRegional
        : outletRegional;

  const clientHardwareIds = pickIds(
    clientHardware,
    legacyHardware,
    entity === "clients" && outletHardware.length === 0,
  );
  const outletHardwareIds =
    outletHardware.length > 0
      ? outletHardware
      : entity === "outlets" && legacyHardware.length > 0
        ? legacyHardware
        : outletHardware;

  const clientManagerMode = parseAssignmentPresenceMode(input.clientManagerMode);
  if (clientManagerMode === null) {
    return { ok: false, message: "Некорректный режим фильтра менеджера клиента." };
  }
  const outletManagerMode = parseAssignmentPresenceMode(input.outletManagerMode);
  if (outletManagerMode === null) {
    return { ok: false, message: "Некорректный режим фильтра менеджера ТТ." };
  }
  const clientRegionalManagerMode = parseAssignmentPresenceMode(input.clientRegionalManagerMode);
  if (clientRegionalManagerMode === null) {
    return { ok: false, message: "Некорректный режим фильтра регионального менеджера клиента." };
  }
  const outletRegionalManagerMode = parseAssignmentPresenceMode(input.outletRegionalManagerMode);
  if (outletRegionalManagerMode === null) {
    return { ok: false, message: "Некорректный режим фильтра регионального менеджера ТТ." };
  }
  const clientHardwareManagerMode = parseAssignmentPresenceMode(input.clientHardwareManagerMode);
  if (clientHardwareManagerMode === null) {
    return { ok: false, message: "Некорректный режим фильтра менеджера по фурнитуре клиента." };
  }
  const outletHardwareManagerMode = parseAssignmentPresenceMode(input.outletHardwareManagerMode);
  if (outletHardwareManagerMode === null) {
    return { ok: false, message: "Некорректный режим фильтра менеджера по фурнитуре ТТ." };
  }
  const clientRopEmployeeMode = parseAssignmentPresenceMode(input.clientRopEmployeeMode ?? input.ropEmployeeMode);
  if (clientRopEmployeeMode === null) {
    return { ok: false, message: "Некорректный режим фильтра РОП клиента." };
  }
  const outletRopEmployeeMode = parseAssignmentPresenceMode(input.outletRopEmployeeMode);
  if (outletRopEmployeeMode === null) {
    return { ok: false, message: "Некорректный режим фильтра РОП ТТ." };
  }

  function parseOptionalBooleanFlag(value: unknown): boolean | undefined | null {
    if (value === undefined || value === null || value === "") {
      return undefined;
    }
    if (Array.isArray(value) || (value !== null && typeof value === "object")) {
      return null;
    }
    const raw = String(value).trim().toLowerCase();
    if (raw === "1" || raw === "true" || raw === "yes") {
      return true;
    }
    if (raw === "0" || raw === "false" || raw === "no") {
      return false;
    }
    return null;
  }

  const missingClientManager = parseOptionalBooleanFlag(input.missingClientManager);
  if (missingClientManager === null) {
    return { ok: false, message: "Некорректный фильтр «не указан менеджер клиента»." };
  }
  const missingOutletManager = parseOptionalBooleanFlag(input.missingOutletManager);
  if (missingOutletManager === null) {
    return { ok: false, message: "Некорректный фильтр «не указан менеджер ТТ»." };
  }
  const legacyMissingManager = parseOptionalBooleanFlag(input.missingManager);
  if (legacyMissingManager === null) {
    return { ok: false, message: "Некорректный фильтр «не указан менеджер»." };
  }

  const missingClientRegional = parseOptionalBooleanFlag(input.missingClientRegional ?? input.missingRegional);
  if (missingClientRegional === null) {
    return { ok: false, message: "Некорректный фильтр «не указан региональный клиента»." };
  }
  const missingOutletRegional = parseOptionalBooleanFlag(input.missingOutletRegional);
  if (missingOutletRegional === null) {
    return { ok: false, message: "Некорректный фильтр «не указан региональный ТТ»." };
  }

  const missingClientHardware = parseOptionalBooleanFlag(input.missingClientHardware ?? input.missingHardware);
  if (missingClientHardware === null) {
    return { ok: false, message: "Некорректный фильтр «не указан менеджер по фурнитуре клиента»." };
  }
  const missingOutletHardware = parseOptionalBooleanFlag(input.missingOutletHardware);
  if (missingOutletHardware === null) {
    return { ok: false, message: "Некорректный фильтр «не указан менеджер по фурнитуре ТТ»." };
  }

  const missingClientRop = parseOptionalBooleanFlag(input.missingClientRop ?? input.missingRop);
  if (missingClientRop === null) {
    return { ok: false, message: "Некорректный фильтр «не указан РОП клиента»." };
  }
  const missingOutletRop = parseOptionalBooleanFlag(input.missingOutletRop);
  if (missingOutletRop === null) {
    return { ok: false, message: "Некорректный фильтр «не указан РОП ТТ»." };
  }

  const resolvedMissingClientManager =
    missingClientManager ?? (legacyMissingManager && entity === "clients" ? true : undefined);
  const resolvedMissingOutletManager =
    missingOutletManager ?? (legacyMissingManager && entity === "outlets" ? true : undefined);

  const legacyRegionalMode = parseAssignmentPresenceMode(input.regionalManagerMode);
  if (legacyRegionalMode === null) {
    return { ok: false, message: "Некорректный режим фильтра регионального менеджера." };
  }
  const legacyHardwareMode = parseAssignmentPresenceMode(input.hardwareManagerMode);
  if (legacyHardwareMode === null) {
    return { ok: false, message: "Некорректный режим фильтра менеджера по фурнитуре." };
  }

  function parseOptionalUuid(value: unknown): string | undefined | null {
    if (value === undefined || value === null || value === "") {
      return undefined;
    }
    if (Array.isArray(value) || (value !== null && typeof value === "object")) {
      return null;
    }
    if (typeof value !== "string" || !isValidUuidParam(value)) {
      return null;
    }
    return value.trim().toLowerCase();
  }

  const legacyRopEmployee = parseOptionalUuid(input.ropEmployee);
  if (legacyRopEmployee === null) {
    return { ok: false, message: "Некорректный фильтр РОП (GUID сотрудника)." };
  }
  const clientRopEmployee = parseOptionalUuid(input.clientRopEmployee);
  if (clientRopEmployee === null) {
    return { ok: false, message: "Некорректный фильтр РОП клиента." };
  }
  const outletRopEmployee = parseOptionalUuid(input.outletRopEmployee);
  if (outletRopEmployee === null) {
    return { ok: false, message: "Некорректный фильтр РОП ТТ." };
  }

  const resolvedClientRop =
    clientRopEmployee ?? (entity === "clients" && !outletRopEmployee ? legacyRopEmployee : undefined);
  const resolvedOutletRop =
    outletRopEmployee ?? (entity === "outlets" && !clientRopEmployee ? legacyRopEmployee : undefined);

  return {
    ok: true,
    params: {
      clientManagerId: singleId(clientManagerIds),
      clientManagerIds: clientManagerIds.length > 0 ? clientManagerIds : undefined,
      outletManagerId: singleId(resolvedOutletManagerIds),
      outletManagerIds: resolvedOutletManagerIds.length > 0 ? resolvedOutletManagerIds : undefined,
      clientRegionalManagerId: singleId(clientRegionalIds),
      clientRegionalManagerIds: clientRegionalIds.length > 0 ? clientRegionalIds : undefined,
      outletRegionalManagerId: singleId(outletRegionalIds),
      outletRegionalManagerIds: outletRegionalIds.length > 0 ? outletRegionalIds : undefined,
      clientHardwareManagerId: singleId(clientHardwareIds),
      clientHardwareManagerIds: clientHardwareIds.length > 0 ? clientHardwareIds : undefined,
      outletHardwareManagerId: singleId(outletHardwareIds),
      outletHardwareManagerIds: outletHardwareIds.length > 0 ? outletHardwareIds : undefined,
      clientManagerMode,
      outletManagerMode,
      clientRegionalManagerMode:
        clientRegionalManagerMode ??
        (legacyRegionalMode && entity === "clients" ? legacyRegionalMode : undefined),
      outletRegionalManagerMode:
        outletRegionalManagerMode ??
        (legacyRegionalMode && entity === "outlets" ? legacyRegionalMode : undefined),
      clientHardwareManagerMode:
        clientHardwareManagerMode ??
        (legacyHardwareMode && entity === "clients" ? legacyHardwareMode : undefined),
      outletHardwareManagerMode:
        outletHardwareManagerMode ??
        (legacyHardwareMode && entity === "outlets" ? legacyHardwareMode : undefined),
      ropEmployeeGuid: legacyRopEmployee,
      clientRopEmployeeGuid: resolvedClientRop,
      outletRopEmployeeGuid: resolvedOutletRop,
      clientRopEmployeeMode: clientRopEmployeeMode,
      outletRopEmployeeMode,
      missingClientManager: resolvedMissingClientManager,
      missingOutletManager: resolvedMissingOutletManager,
      missingClientRegional: missingClientRegional,
      missingOutletRegional: missingOutletRegional,
      missingClientHardware: missingClientHardware,
      missingOutletHardware: missingOutletHardware,
      missingClientRop: missingClientRop,
      missingOutletRop: missingOutletRop,
    },
  };
}
