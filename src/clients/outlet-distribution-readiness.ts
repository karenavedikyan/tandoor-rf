import type { PoolClient } from "pg";
import { readExtendedSnapshot } from "../onec-clients/extended-apply";
import type { ExtendedSnapshot, ParsedRetailOutlet } from "../onec-clients/extended-types";
import {
  assessOutletExportFreshness,
  type OutletDistributionGateRow,
} from "./extended-dto";
import { shortUuidLabel } from "./uuid-param";

export type OutletDistributionReadiness = {
  guidStore: string;
  guidClient: string;
  displayName: string;
  storeAddress: string;
  guidStoreShortLabel: string;
  closureStatus: "open" | "closed" | "unknown";
  closureStatusLabel: string;
  presentInCurrentExport: boolean;
  distributionWritable: boolean;
  distributionBlockedReason: string | null;
};

type RegistryRow = {
  guid_store: string;
  guid_client: string;
  is_closed: boolean | null;
};

type ClientExtendedRow = OutletDistributionGateRow & {
  extended_snapshot: unknown;
};

function readCurrentOutletsFromSnapshot(snapshot: unknown): ParsedRetailOutlet[] {
  const parsed = readExtendedSnapshot(snapshot);
  if (!parsed) return [];
  if (Array.isArray(parsed.currentRetailOutlets)) {
    return parsed.currentRetailOutlets;
  }
  const legacy = (parsed as { retailOutlets?: ParsedRetailOutlet[] }).retailOutlets;
  return Array.isArray(legacy) ? legacy : [];
}

function outletDisplayName(outlet: ParsedRetailOutlet | null, guidStore: string): string {
  const address = outlet?.address.storeAddress?.trim();
  if (address) return address;
  const holding = outlet?.holdingName?.trim();
  if (holding) return holding;
  return `ТТ ${shortUuidLabel(guidStore)}`;
}

function assessWritable(
  registry: RegistryRow,
  cardGuid: string,
  snapshotOutlet: ParsedRetailOutlet | null,
  row: ClientExtendedRow,
  snapshot: ExtendedSnapshot | null,
): { writable: boolean; reason: string | null; presentInCurrentExport: boolean } {
  if (registry.guid_client.toLowerCase() !== cardGuid.toLowerCase()) {
    return {
      writable: false,
      reason: "Торговая точка не принадлежит выбранному клиенту.",
      presentInCurrentExport: false,
    };
  }
  if (registry.is_closed === true) {
    const exportState = assessOutletExportFreshness(snapshotOutlet, row, snapshot);
    return {
      writable: false,
      reason: "Запись дистрибуции недоступна для закрытой торговой точки.",
      presentInCurrentExport: exportState.presentInCurrentExport,
    };
  }
  if (!snapshotOutlet) {
    return {
      writable: false,
      reason: "Торговая точка отсутствует в текущей выгрузке 1С.",
      presentInCurrentExport: false,
    };
  }
  if (snapshotOutlet.outletGuidStatus !== "confirmed" || !snapshotOutlet.guidStore) {
    return {
      writable: false,
      reason: "Запись дистрибуции недоступна без подтверждённого идентификатора торговой точки.",
      presentInCurrentExport: false,
    };
  }

  const exportState = assessOutletExportFreshness(snapshotOutlet, row, snapshot);
  if (!exportState.presentInCurrentExport) {
    return {
      writable: false,
      reason: "Торговая точка отсутствует в текущей выгрузке 1С.",
      presentInCurrentExport: false,
    };
  }
  if (snapshotOutlet.closureStatus === "closed") {
    return {
      writable: false,
      reason: "Запись дистрибуции недоступна для закрытой торговой точки.",
      presentInCurrentExport: true,
    };
  }
  if (snapshotOutlet.closureStatus !== "open") {
    return {
      writable: false,
      reason: "Запись дистрибуции недоступна без подтверждённого статуса торговой точки.",
      presentInCurrentExport: true,
    };
  }
  return { writable: true, reason: null, presentInCurrentExport: true };
}

export async function loadOutletDistributionOptions(
  client: PoolClient,
  cardGuid: string,
  accessibleStoreGuids?: ReadonlySet<string> | null,
): Promise<OutletDistributionReadiness[]> {
  const clientRow = await client.query<ClientExtendedRow>(
    `
      SELECT
        extended_snapshot,
        extended_freshness_state,
        source_sha256,
        extended_source_sha256
      FROM onec_clients
      WHERE guid_client = $1::uuid
    `,
    [cardGuid],
  );
  const row = clientRow.rows[0] ?? {
    extended_snapshot: null,
    extended_freshness_state: null,
    source_sha256: null,
    extended_source_sha256: null,
  };
  const snapshot = readExtendedSnapshot(row.extended_snapshot);
  const snapshotOutlets = readCurrentOutletsFromSnapshot(row.extended_snapshot);
  const snapshotByStore = new Map<string, ParsedRetailOutlet>();
  for (const outlet of snapshotOutlets) {
    if (outlet.guidStore) {
      snapshotByStore.set(outlet.guidStore.toLowerCase(), outlet);
    }
  }

  const registryRows = await client.query<RegistryRow>(
    `
      SELECT guid_store::text, guid_client::text, is_closed
      FROM onec_retail_outlets
      WHERE guid_client = $1::uuid
      ORDER BY guid_store
    `,
    [cardGuid],
  );

  const rows = accessibleStoreGuids
    ? registryRows.rows.filter((registry) =>
        accessibleStoreGuids.has(registry.guid_store.toLowerCase()),
      )
    : registryRows.rows;

  return rows.map((registry) => {
    const snapshotOutlet = snapshotByStore.get(registry.guid_store.toLowerCase()) ?? null;
    const assessed = assessWritable(registry, cardGuid, snapshotOutlet, row, snapshot);
    const closureStatus =
      registry.is_closed === true || snapshotOutlet?.closureStatus === "closed"
        ? "closed"
        : snapshotOutlet?.closureStatus === "open" || registry.is_closed === false
          ? "open"
          : "unknown";
    const closureStatusLabel =
      closureStatus === "closed"
        ? "Закрыта"
        : closureStatus === "open"
          ? "Открыта"
          : "Статус не передан";
    return {
      guidStore: registry.guid_store,
      guidClient: registry.guid_client,
      displayName: outletDisplayName(snapshotOutlet, registry.guid_store),
      storeAddress: snapshotOutlet?.address.storeAddress?.trim() || "",
      guidStoreShortLabel: shortUuidLabel(registry.guid_store),
      closureStatus,
      closureStatusLabel,
      presentInCurrentExport: assessed.presentInCurrentExport,
      distributionWritable: assessed.writable,
      distributionBlockedReason: assessed.reason,
    };
  });
}

export async function assertOutletBelongsToClient(
  client: PoolClient,
  cardGuid: string,
  storeGuid: string,
): Promise<boolean> {
  const row = await client.query<{ guid_client: string }>(
    `SELECT guid_client::text FROM onec_retail_outlets WHERE guid_store = $1::uuid`,
    [storeGuid],
  );
  return (row.rows[0]?.guid_client ?? "").toLowerCase() === cardGuid.toLowerCase();
}

/**
 * Locks client row then outlet registry row (same order as applyClientsImport:
 * onec_clients before onec_retail_outlets) to avoid deadlocks with concurrent import.
 */
export async function lockOutletDistributionContext(
  client: PoolClient,
  cardGuid: string,
  storeGuid: string,
): Promise<{ ok: true } | { ok: false; code: string; message: string }> {
  const clientRow = await client.query<{ guid_client: string }>(
    `SELECT guid_client::text FROM onec_clients WHERE guid_client = $1::uuid FOR UPDATE`,
    [cardGuid],
  );
  if (!clientRow.rows[0]) {
    return {
      ok: false,
      code: "OUTLET_NOT_FOUND",
      message: "Торговая точка не найдена для выбранного клиента.",
    };
  }

  const outletRow = await client.query<RegistryRow>(
    `
      SELECT guid_store::text, guid_client::text, is_closed
      FROM onec_retail_outlets
      WHERE guid_store = $1::uuid
      FOR UPDATE
    `,
    [storeGuid],
  );
  const registry = outletRow.rows[0];
  if (!registry) {
    return {
      ok: false,
      code: "OUTLET_NOT_FOUND",
      message: "Торговая точка не найдена для выбранного клиента.",
    };
  }
  if (registry.guid_client.toLowerCase() !== cardGuid.toLowerCase()) {
    return {
      ok: false,
      code: "OUTLET_NOT_FOUND",
      message: "Торговая точка не найдена для выбранного клиента.",
    };
  }

  return { ok: true };
}

export async function assertOutletDistributionWritable(
  client: PoolClient,
  cardGuid: string,
  storeGuid: string,
): Promise<{ ok: true } | { ok: false; code: string; message: string }> {
  const options = await loadOutletDistributionOptions(client, cardGuid);
  const match = options.find((item) => item.guidStore.toLowerCase() === storeGuid.toLowerCase());
  if (!match) {
    return {
      ok: false,
      code: "OUTLET_NOT_FOUND",
      message: "Торговая точка не найдена для выбранного клиента.",
    };
  }
  if (!match.distributionWritable) {
    return {
      ok: false,
      code: "OUTLET_NOT_WRITABLE",
      message: match.distributionBlockedReason ?? "Запись дистрибуции недоступна для этой торговой точки.",
    };
  }
  return { ok: true };
}
