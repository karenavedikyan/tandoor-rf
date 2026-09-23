import { telHrefFromPhone } from "./phone";
import { shortUuidLabel } from "./uuid-param";

export type ClientListItemDto = {
  guid: string;
  name: string;
  holding: {
    id: string | null;
    name: string;
  };
  manager: {
    id: string;
    name: string;
    shortId: string;
  };
  address: string;
  phonePreview: {
    primary: string | null;
    extraCount: number;
  };
};

export type ClientDetailDto = {
  guid: string;
  name: string;
  manager: {
    id: string;
    name: string;
    shortId: string;
  };
  address: string;
  phones: Array<{
    value: string;
    telHref: string | null;
  }>;
  holding: {
    id: string;
    name: string;
  } | null;
  sourceLabel: string;
  lastImportedAt: string;
  lastImportedAtLabel: string;
};

export type ClientOptionDto = {
  id: string;
  name: string;
  shortId: string;
};

export type ClientsListResponse = {
  items: ClientListItemDto[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
  isEmptyDatabase: boolean;
};

export type ClientsOptionsResponse = {
  managers: ClientOptionDto[];
  holdings: ClientOptionDto[];
};

export type ClientsSyncStatusResponse = {
  lastSuccessfulImportAt: string | null;
  lastSuccessfulImportAtLabel: string | null;
  runningImport: boolean;
  warning: string | null;
};

type ClientRow = {
  guid_client: string;
  name_client: string;
  guid_holding: string | null;
  name_holding: string;
  guid_manager: string;
  name_manager: string;
  address: string;
  telephone: unknown;
  last_imported_at: Date;
};

export function formatMskDateTime(value: Date): string {
  return new Intl.DateTimeFormat("ru-RU", {
    timeZone: "Europe/Moscow",
    dateStyle: "medium",
    timeStyle: "short",
  }).format(value);
}

function parseTelephones(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.filter((item): item is string => typeof item === "string");
}

function phonePreviewFromTelephones(telephones: string[]): ClientListItemDto["phonePreview"] {
  const nonEmpty = telephones.map((item) => item.trim()).filter((item) => item.length > 0);
  if (nonEmpty.length === 0) {
    return { primary: null, extraCount: 0 };
  }
  return {
    primary: nonEmpty[0] ?? null,
    extraCount: Math.max(0, nonEmpty.length - 1),
  };
}

export function toClientListItem(row: ClientRow): ClientListItemDto {
  const telephones = parseTelephones(row.telephone);
  return {
    guid: row.guid_client,
    name: row.name_client,
    holding: {
      id: row.guid_holding,
      name: row.name_holding,
    },
    manager: {
      id: row.guid_manager,
      name: row.name_manager,
      shortId: shortUuidLabel(row.guid_manager),
    },
    address: row.address,
    phonePreview: phonePreviewFromTelephones(telephones),
  };
}

export function toClientDetail(row: ClientRow): ClientDetailDto {
  const telephones = parseTelephones(row.telephone);
  const nonEmptyPhones = telephones.filter((item) => item.trim().length > 0);
  return {
    guid: row.guid_client,
    name: row.name_client,
    manager: {
      id: row.guid_manager,
      name: row.name_manager,
      shortId: shortUuidLabel(row.guid_manager),
    },
    address: row.address,
    phones: nonEmptyPhones.map((value) => ({
      value,
      telHref: telHrefFromPhone(value),
    })),
    holding: row.guid_holding
      ? {
          id: row.guid_holding,
          name: row.name_holding,
        }
      : null,
    sourceLabel: "Данные из 1С",
    lastImportedAt: row.last_imported_at.toISOString(),
    lastImportedAtLabel: formatMskDateTime(row.last_imported_at),
  };
}

export function toClientOption(id: string, name: string): ClientOptionDto {
  return {
    id,
    name,
    shortId: shortUuidLabel(id),
  };
}
