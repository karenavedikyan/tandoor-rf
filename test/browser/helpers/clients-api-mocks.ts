export const SYNTHETIC_CLIENT_GUID = "11111111-1111-4111-8111-111111111111";
export const SYNTHETIC_CLIENT_TWO = "33333333-3333-4333-8333-333333333333";
export const SYNTHETIC_MANAGER_A = "22222222-2222-4222-8222-222222222222";
export const SYNTHETIC_OUTLET_MANAGER_M2 = "66666666-6666-4666-8666-666666666666";
export const SYNTHETIC_HOLDING_A = "44444444-4444-4444-8444-444444444444";

export const NAV_ROP_A = "11a0c069-11bc-11ea-80ec-00155d0a0a4e";
export const NAV_ROP_B = "2b4cd6c6-a29e-11e3-86da-08606e7fce4d";
export const NAV_CLIENT_C1 = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
export const NAV_CLIENT_C2 = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
export const NAV_OUTLET_T2 = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
export const NAV_OUTLET_T1 = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
export const NAV_OUTLET_C3_T3 = "88888888-8888-4888-8888-888888888803";

export const COMPLETENESS_CLIENT_BOTH = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
export const COMPLETENESS_CLIENT_FILLED = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
export const COMPLETENESS_STORE_MISSING = "88888888-8888-4888-8888-888888888801";

export type MockRole = "admin" | "manager" | "marketer" | "anonymous";
export type ClientsBusinessRole = "manager" | "regional_manager" | "rop" | "director" | "admin";

export function adminUserPayload() {
  return {
    user: {
      role: "admin",
      email: "admin@synthetic.test",
      fullName: "Synthetic Admin",
    },
  };
}

export function managerUserPayload() {
  return {
    user: {
      role: "manager",
      email: "manager@synthetic.test",
      fullName: "Synthetic Manager",
    },
  };
}

export function marketerUserPayload() {
  return {
    user: {
      role: "marketer",
      email: "marketer@synthetic.test",
      fullName: "Synthetic Marketer",
    },
  };
}

export function syntheticListPayload() {
  return {
    items: [
      {
        guid: SYNTHETIC_CLIENT_GUID,
        name: "Synthetic Client Alpha",
        holding: { id: SYNTHETIC_HOLDING_A, name: "Холдинг Восток" },
        manager: {
          id: SYNTHETIC_MANAGER_A,
          name: "Менеджер Иванов",
          shortId: "22222222",
        },
        address: "Москва, ул. Пример 1",
        phonePreview: { primary: "+7 (999) 000-11-22", extraCount: 1 },
      },
      {
        guid: SYNTHETIC_CLIENT_TWO,
        name: "Synthetic Client Beta",
        holding: { id: null, name: "" },
        manager: {
          id: SYNTHETIC_MANAGER_A,
          name: "Менеджер Иванов",
          shortId: "22222222",
        },
        address: "   ",
        phonePreview: { primary: null, extraCount: 0 },
      },
    ],
    total: 2,
    page: 1,
    pageSize: 50,
    totalPages: 1,
    isEmptyDatabase: false,
  };
}

export function syntheticPagedListPayload(page: number) {
  const base = syntheticListPayload();
  return {
    ...base,
    page,
    total: 60,
    totalPages: 2,
  };
}

export function syntheticOutletsListPayload() {
  return {
    items: [
      {
        guidStore: "44444444-4444-4444-8444-444444444444",
        guidClient: SYNTHETIC_CLIENT_GUID,
        clientName: "Synthetic Client Alpha",
        outletLabel: "Store Alpha",
        address: "Store street 1",
        isClosed: false,
        closureStatusLabel: "Открыта",
        holdingName: "Холдинг Восток",
        manager: {
          id: SYNTHETIC_MANAGER_A,
          name: "Менеджер Иванов",
          shortId: "22222222",
          hasSource: true,
          assignmentState: "directory_unverified",
          assignmentLabel: "Менеджер Иванов · 22222222",
        },
        clientManager: {
          id: SYNTHETIC_MANAGER_A,
          name: "Менеджер Иванов",
          shortId: "22222222",
        },
        regionalManager: {
          id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
          name: "Regional One",
          shortId: "AAAAAAAA",
          hasSource: true,
          assignmentState: "directory_unverified",
          assignmentLabel: "Regional One · AAAAAAAA",
        },
        hardwareManager: {
          id: null,
          name: "",
          shortId: null,
          hasSource: false,
          assignmentState: "not_provided",
          assignmentLabel: "Не передано",
        },
        headOfSales: {
          id: null,
          name: "",
          shortId: null,
          hasSource: true,
          assignmentState: "unassigned",
          assignmentLabel: "Не назначен",
        },
        warehouse: { value: true, label: "Да", hasSource: true },
        tandoorClub: { value: "Gold", hasSource: true },
      },
    ],
    total: 1,
    page: 1,
    pageSize: 50,
    totalPages: 1,
    isEmptyDatabase: false,
  };
}

function navClientItem(guid: string, name: string) {
  return {
    guid,
    name,
    holding: { id: null, name: "" },
    manager: {
      id: SYNTHETIC_MANAGER_A,
      name: "Менеджер Иванов",
      shortId: "22222222",
    },
    address: "Addr",
    phonePreview: { primary: null, extraCount: 0 },
  };
}

function navOutletItem(guidStore: string, clientName: string, guidClient: string) {
  return {
    guidStore,
    guidClient,
    clientName,
    outletLabel: "Store " + guidStore.slice(0, 8),
    address: "Store street",
    isClosed: false,
    closureStatusLabel: "Открыта",
    holdingName: "",
    manager: {
      id: SYNTHETIC_MANAGER_A,
      name: "Менеджер Иванов",
      shortId: "22222222",
    },
    regionalManager: { id: null, name: "", shortId: "", hasSource: false },
    warehouse: { value: false, label: "Нет", hasSource: true },
    tandoorClub: { value: null, hasSource: false },
  };
}

export function portfolioAwareClientsListPayload(url: URL) {
  const view = url.searchParams.get("view");
  const ropEmployee = url.searchParams.get("ropEmployee");
  const portfolio = url.searchParams.get("portfolio");
  const entity = url.searchParams.get("entity") || "clients";

  if (view !== "teams" || !ropEmployee || !portfolio) {
    return null;
  }

  if (entity === "outlets" && portfolio === "outlets") {
    if (ropEmployee === NAV_ROP_A) {
      return {
        items: [navOutletItem(NAV_OUTLET_T2, "Client C1", NAV_CLIENT_C1)],
        total: 1,
        page: 1,
        pageSize: 50,
        totalPages: 1,
        isEmptyDatabase: false,
      };
    }
    if (ropEmployee === NAV_ROP_B) {
      return {
        items: [
          navOutletItem(NAV_OUTLET_T1, "Client C1", NAV_CLIENT_C1),
          navOutletItem(NAV_OUTLET_C3_T3, "Client C3", "88888888-8888-4888-8888-888888888888"),
        ],
        total: 2,
        page: 1,
        pageSize: 50,
        totalPages: 1,
        isEmptyDatabase: false,
      };
    }
    return { items: [], total: 0, page: 1, pageSize: 50, totalPages: 0, isEmptyDatabase: false };
  }

  if (entity === "clients" && portfolio === "clients") {
    if (ropEmployee === NAV_ROP_A) {
      return {
        items: [navClientItem(NAV_CLIENT_C1, "Client C1")],
        total: 1,
        page: 1,
        pageSize: 50,
        totalPages: 1,
        isEmptyDatabase: false,
      };
    }
    if (ropEmployee === NAV_ROP_B) {
      return {
        items: [navClientItem(NAV_CLIENT_C2, "Client C2")],
        total: 1,
        page: 1,
        pageSize: 50,
        totalPages: 1,
        isEmptyDatabase: false,
      };
    }
    return { items: [], total: 0, page: 1, pageSize: 50, totalPages: 0, isEmptyDatabase: false };
  }

  return { items: [], total: 0, page: 1, pageSize: 50, totalPages: 0, isEmptyDatabase: false };
}

export function syntheticOptionsPayload(
  overrides: {
    managers?: Array<{ id: string; name: string; shortId: string }>;
    outletManagers?: Array<{ id: string; name: string; shortId: string }>;
  } = {},
) {
  return {
    managers: overrides.managers ?? [
      {
        id: SYNTHETIC_MANAGER_A,
        name: "Менеджер Иванов",
        shortId: "22222222",
      },
    ],
    outletManagers: overrides.outletManagers ?? [
      {
        id: SYNTHETIC_OUTLET_MANAGER_M2,
        name: "Менеджер ТТ Петров",
        shortId: "66666666",
      },
    ],
    holdings: [
      {
        id: SYNTHETIC_HOLDING_A,
        name: "Холдинг Восток",
        shortId: "44444444",
      },
    ],
    regionalManagers: [
      {
        id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
        name: "Regional One",
        shortId: "AAAAAAAA",
      },
    ],
    hardwareManagers: [
      {
        id: "77777777-7777-4777-8777-777777777777",
        name: "Hardware Lead",
        shortId: "77777777",
      },
    ],
    rops: [
      {
        id: NAV_ROP_A,
        name: "ROP Alpha",
        shortId: "11A0C069",
      },
      {
        id: NAV_ROP_B,
        name: "ROP Beta",
        shortId: "2B4CD6C6",
      },
    ],
  };
}

export function filterAwareAllListPayload(url: URL) {
  if (url.searchParams.get("view") !== "all") {
    return null;
  }
  const entity = url.searchParams.get("entity") || "clients";
  const ropEmployee = url.searchParams.get("ropEmployee");
  const manager = url.searchParams.get("manager");
  const hardwareManager = url.searchParams.get("hardwareManager");
  const missingManager = url.searchParams.get("missingManager") === "1";
  const missingRop = url.searchParams.get("missingRop") === "1";

  if (entity === "clients") {
    if (hardwareManager === "77777777-7777-4777-8777-777777777777") {
      return {
        items: [navClientItem(NAV_CLIENT_C1, "Client C1")],
        total: 1,
        page: 1,
        pageSize: 50,
        totalPages: 1,
        isEmptyDatabase: false,
      };
    }
    if (missingRop) {
      return {
        items: [navClientItem("99999999-9999-4999-8999-999999999999", "Missing ROP Client")],
        total: 1,
        page: 1,
        pageSize: 50,
        totalPages: 1,
        isEmptyDatabase: false,
      };
    }
    if (ropEmployee === NAV_ROP_A && manager === SYNTHETIC_MANAGER_A) {
      return {
        items: [navClientItem(NAV_CLIENT_C1, "Client C1")],
        total: 1,
        page: 1,
        pageSize: 50,
        totalPages: 1,
        isEmptyDatabase: false,
      };
    }
    return null;
  }

  if (missingManager) {
    return {
      items: [navOutletItem("88888888-8888-4888-8888-888888888805", "Client C1", NAV_CLIENT_C1)],
      total: 1,
      page: 1,
      pageSize: 50,
      totalPages: 1,
      isEmptyDatabase: false,
    };
  }

  if (ropEmployee === NAV_ROP_B && manager === SYNTHETIC_MANAGER_A) {
    return {
      items: [navOutletItem(NAV_OUTLET_T1, "Client C1", NAV_CLIENT_C1)],
      total: 1,
      page: 1,
      pageSize: 50,
      totalPages: 1,
      isEmptyDatabase: false,
    };
  }

  return null;
}

function userPayloadForBusinessRole(role: ClientsBusinessRole) {
  switch (role) {
    case "manager":
      return {
        user: {
          role: "manager",
          email: "manager@synthetic.test",
          fullName: "Synthetic Manager",
        },
      };
    case "regional_manager":
      return {
        user: {
          role: "regional_manager",
          email: "regional@synthetic.test",
          fullName: "Synthetic Regional",
        },
      };
    case "rop":
      return {
        user: {
          role: "rop",
          email: "rop@synthetic.test",
          fullName: "Synthetic ROP",
        },
      };
    case "director":
      return {
        user: {
          role: "director",
          email: "director@synthetic.test",
          fullName: "Synthetic Director",
        },
      };
    default:
      return adminUserPayload();
  }
}

export function syntheticPresentationPayload(role: ClientsBusinessRole = "admin") {
  switch (role) {
    case "manager":
      return {
        presentation: {
          pageTitle: "Мои клиенты",
          defaultView: "all",
          defaultEntity: "clients",
          allowedViews: ["all"],
          allowedEntities: ["clients", "outlets"],
          showViewSwitcher: false,
          showManagerTeamFilter: false,
          showTeamNavigation: false,
          reviewReadOnly: true,
        },
      };
    case "regional_manager":
      return {
        presentation: {
          pageTitle: "Мои торговые точки",
          defaultView: "all",
          defaultEntity: "outlets",
          allowedViews: ["all"],
          allowedEntities: ["outlets", "clients"],
          showViewSwitcher: false,
          showManagerTeamFilter: false,
          showTeamNavigation: false,
          reviewReadOnly: true,
        },
      };
    case "rop":
      return {
        presentation: {
          pageTitle: "Клиенты моей команды",
          defaultView: "teams",
          defaultEntity: "clients",
          allowedViews: ["all", "teams"],
          allowedEntities: ["clients", "outlets"],
          showEntitySwitcher: false,
          showViewSwitcher: true,
          showManagerTeamFilter: true,
          showTeamNavigation: true,
          reviewReadOnly: true,
        },
      };
    case "director":
      return {
        presentation: {
          businessRole: "director",
          pageTitle: "Вся клиентская база",
          defaultView: "teams",
          defaultEntity: "clients",
          allowedViews: ["all", "teams", "review", "completeness"],
          allowedEntities: ["clients", "outlets"],
          showViewSwitcher: true,
          showManagerTeamFilter: true,
          showTeamNavigation: true,
          reviewReadOnly: true,
          directorLayout: true,
        },
      };
    default:
      return {
        presentation: {
          businessRole: "admin",
          pageTitle: "Вся клиентская база",
          defaultView: "teams",
          defaultEntity: "clients",
          allowedViews: ["all", "teams", "review", "completeness"],
          allowedEntities: ["clients", "outlets"],
          showViewSwitcher: true,
          showManagerTeamFilter: true,
          showTeamNavigation: true,
          reviewReadOnly: false,
          directorLayout: true,
        },
      };
  }
}

export function syntheticSyncStatusPayload() {
  return {
    freshnessState: "current",
    lastSuccessfulImportAt: "2026-09-28T09:00:00.000Z",
    lastSuccessfulImportAtLabel: "28.09.2026, 12:00",
    sourceFormationKnown: false,
    lastSourceModifiedAtLabel: null,
    runningImport: false,
    warning: null,
  };
}

export function syntheticOnecUpdateStatusPayload(
  phase: NonNullable<MockOptions["onecUpdatePhase"]> = "idle",
) {
  if (phase === "idle") {
    return {
      job: null,
      canStart: true,
      blockedReason: null,
    };
  }
  const phaseLabels: Record<string, string> = {
    pending: "Ожидает запуска",
    running: "Выполняется",
    completed: "Завершено",
    no_changes: "Нет изменений",
    rejected: "Отклонено проверками",
    error: "Ошибка",
  };
  return {
    job: {
      id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      phase,
      message:
        phase === "rejected"
          ? "Отклонено проверками. Комплект не прошёл проверку перед обновлением. Прежние данные клиентов и назначений сохранены без изменений."
          : phaseLabels[phase] + ". Синтетический статус обновления.",
      startedAt: "2026-10-06T11:00:00.000Z",
      finishedAt: phase === "pending" || phase === "running" ? null : "2026-10-06T11:05:00.000Z",
      sourceExportAt: "2026-10-06T08:00:00.000Z",
      sourceExportAtLabel: "06.10.2026, 11:00",
      lastSuccessfulUpdateAt: "2026-09-28T09:00:00.000Z",
      lastSuccessfulUpdateAtLabel: "28.09.2026, 12:00",
      dataPreserved: phase === "rejected" || phase === "error",
      errorCode: phase === "rejected" ? "ROSTER_SHRINK_AMBIGUOUS" : null,
      requestedByUserId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
      jobSource: "admin_manual",
      jobSourceLabel: "Вручную администратором",
      exportBatchId: phase === "completed" ? "batch-2026-10-06" : null,
    },
    canStart: phase !== "pending" && phase !== "running",
    blockedReason: phase === "pending" || phase === "running" ? "Обновление из 1С уже поставлено в очередь или выполняется." : null,
  };
}

export function syntheticDetailPayload(overrides: Record<string, unknown> = {}) {
  return {
    client: {
      guid: SYNTHETIC_CLIENT_GUID,
      name: "Synthetic Client Alpha",
      manager: {
        id: SYNTHETIC_MANAGER_A,
        name: "Менеджер Иванов",
        shortId: "22222222",
      },
      address: "Москва, ул. Пример 1",
      phones: [
        { value: "+7 (999) 000-11-22", telHref: "+79990001122" },
        { value: "8-800-555-35-35", telHref: null },
      ],
      holding: {
        id: SYNTHETIC_HOLDING_A,
        name: "Холдинг Восток",
      },
      sourceLabel: "Данные из 1С",
      lastImportedAt: "2026-09-28T09:30:00.000Z",
      lastImportedAtLabel: "28.09.2026, 12:30",
      ...overrides,
    },
  };
}

export function syntheticLongDetailPayload() {
  return syntheticDetailPayload({
    name: "Synthetic Client With Very Long Name That Should Wrap In Narrow Layout Without Breaking Shell",
    address:
      "123456789012345678901234567890123456789012345678901234567890123456789012345678901234567890",
  });
}

export function syntheticOutletMock(
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    ordinal: 0,
    guidStore: null,
    guidStoreShortLabel: null,
    holdingName: "Холдинг Восток",
    identityLabel: "Точка из выгрузки 1С. Идентификатор ещё не передан",
    closureStatus: "not_provided",
    closureStatusLabel: "Статус не передан",
    closureNote: null,
    presentInCurrentExport: true,
    dataSourceLabel: "Источник не подтверждён",
    freshnessLabel: "Источник не подтверждён",
    warehouse: true,
    warehouseLabel: "Используется как склад",
    addresses: {
      storeAddress: "Store street with a very long name for layout testing",
      deliveryAddress: "Delivery street",
      routeDirection: "North",
    },
    loading: {
      days: [
        { key: "mon", label: "Пн", value: false },
        { key: "tue", label: "Вт", value: false },
        { key: "wed", label: "Ср", value: false },
        { key: "thu", label: "Чт", value: false },
        { key: "fri", label: "Пт", value: false },
        { key: "sat", label: "Сб", value: false },
        { key: "sun", label: "Вс", value: false },
      ],
      loadingTime: "09:00",
      loadingTimeNote: null,
      loadingEndTime: null,
      scheduleState: "all_false" as const,
    },
    managers: {
      manager: { assignmentLabel: "Не назначен", assignmentState: "unassigned" },
      regionalManager: { assignmentLabel: "Regional One", assignmentState: "directory_unverified" },
      hardwareManager: { assignmentLabel: "Не назначен", assignmentState: "unassigned" },
      headOfSales: { assignmentLabel: "Не назначен", assignmentState: "unassigned" },
    },
    contacts: { storePhone: "+7 495 000-00-00", accountantPhone: "", accountantEmail: "" },
    distributionAllowed: false as const,
    distributionNote: "Запись дистрибуции недоступна без подтверждённого идентификатора торговой точки.",
    ...overrides,
  };
}

export function syntheticExtendedEmptyOutletsPayload(): ReturnType<typeof syntheticExtendedDetailPayload> {
  const detail = syntheticExtendedDetailPayload("granted");
  detail.client.extended!.retailOutlets = [];
  detail.client.extended!.retailOutletsTotalCount = 0;
  detail.client.extended!.retailOutletsEmptyReason = "empty_snapshot";
  detail.client.extended!.retailOutletHistoryCount = 0;
  detail.client.extended!.dataQualityLabel = "В текущих данных 1С торговые точки не указаны";
  return detail;
}

export function syntheticExtendedEmptyScopePayload(): ReturnType<typeof syntheticExtendedDetailPayload> {
  const detail = syntheticExtendedDetailPayload("granted");
  detail.client.extended!.retailOutlets = [];
  detail.client.extended!.retailOutletsTotalCount = 0;
  detail.client.extended!.retailOutletsEmptyReason = "empty_scope";
  detail.client.extended!.retailOutletHistoryCount = 0;
  detail.client.extended!.dataQualityLabel = "Нет доступных торговых точек в вашей области";
  return detail;
}

export function syntheticExtendedDetailPayload(outletAccess: "granted" | "denied" = "granted") {
  const outlet = syntheticOutletMock();
  return syntheticDetailPayload({
    extended: {
      formatVersion: "extended_v1",
      sourceSha256: "abc123",
      importedAt: "2026-01-01T10:00:00.000Z",
      importedAtLabel: "01.01.2026, 13:00",
      freshnessState: "current",
      freshnessLabel: "Обновлено из текущей выгрузки",
      isHolding: true,
      holdingCardLabel: "Карточка холдинга",
      managers: {
        regionalManager: { assignmentLabel: "Regional One", assignmentState: "directory_unverified" },
        hardwareManager: { assignmentLabel: "Не назначен", assignmentState: "unassigned" },
        headOfSales: { assignmentLabel: "Не назначен", assignmentState: "unassigned" },
      },
      retailOutlets: outletAccess === "granted"
        ? [outlet, syntheticOutletMock({ ordinal: 1 })]
        : [],
      retailOutletsTotalCount: outletAccess === "granted" ? 2 : 0,
      retailOutletsTruncated: false,
      retailOutletsAccess: outletAccess,
      retailOutletsEmptyReason: outletAccess === "granted" ? "none" : "none",
      retailOutletHistoryCount: 0,
      dataQualityLabel:
        outletAccess === "granted" ? "Частично подключено" : "Торговые точки недоступны для вашей роли",
      sensitiveFieldsWithheld: true,
      outletNormalizedReady: false,
      clientExtendedReady: false,
    },
  });
}

export type MockOptions = {
  role?: MockRole;
  clientsBusinessRole?: ClientsBusinessRole;
  listStatus?: number;
  listBody?: unknown;
  outletsListBody?: unknown;
  detailStatus?: number;
  detailBody?: unknown;
  failListOnce?: boolean;
  bitrix24Label?: Record<string, unknown>;
  bitrix24Tasks?: Record<string, unknown>;
  bitrix24Claims?: Record<string, unknown>;
  bitrix24Sync?: Record<string, unknown> | number;
  catalogMeta?: Record<string, unknown>;
  catalogProducts?: Record<string, unknown>;
  catalogProductDetail?: Record<string, unknown>;
  catalogActiveVersionId?: string;
  catalogProductsStatus?: number;
  catalogFailProductsOnce?: boolean;
  catalogAccessRevoked?: boolean;
  reviewersStatus?: number;
  eligibleReviewersItems?: Array<{ userId: string; name: string; shortId: string }>;
  reviewGetBody?: Record<string, unknown> | null;
  previewActive?: boolean;
  onecUpdatePhase?: "idle" | "pending" | "running" | "completed" | "no_changes" | "rejected" | "error";
  optionsPayload?: ReturnType<typeof syntheticOptionsPayload>;
};

export function syntheticCatalogMetaPayload() {
  return {
    state: "ready",
    versionId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    importedAt: "2026-10-01T12:00:00.000Z",
    importProfile: "distribution",
    distributionReady: true,
    productCount: 2,
    sectionCount: 2,
    propertyCount: 2,
    imagePathCount: 1,
    classificationIncomplete: true,
    message: "Часть товаров ссылается на группы, отсутствующие в выгрузке; исходные коды групп сохранены.",
    sections: [
      { code: "s1", name: "Section one" },
      { code: "s2", name: "Section two" },
    ],
    outlets: [
      {
        guidStore: "cccccccc-cccc-4ccc-8ccc-ccccccccccc1",
        guidClient: SYNTHETIC_CLIENT_GUID,
        displayName: "Mock store",
        storeAddress: "Mock store address",
        guidStoreShortLabel: "cccc…ccc1",
        closureStatus: "open",
        closureStatusLabel: "Открыта",
        presentInCurrentExport: true,
        distributionWritable: true,
        distributionBlockedReason: null,
      },
    ],
    selectedStoreGuid: null,
    outletConfirmed: false,
    selectionPersisted: false,
    distributionEnabled: false,
    futureActionsBlockedReason: "Выберите торговую точку, чтобы сохранять дистрибуцию по образцам.",
  };
}

export function syntheticCatalogProductsPayload() {
  return {
    state: "ready",
    versionId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    query: "",
    sectionCode: null,
    page: 1,
    pageSize: 20,
    total: 1,
    items: [
      {
        code: "p1",
        name: "Product one with a very long name for wrapping test in narrow layout",
        groupCode: "ghost-group",
        groupStatus: "missing_reference",
        sectionNames: ["Section one"],
        primaryImagePath: "images/p1.jpg",
        primaryImageAssetId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
        article: null,
        keyProperties: [{ code: "type", name: "Тип товара", value: "Складская" }],
        activity: "Y",
      },
    ],
  };
}

export function syntheticCatalogProductDetailPayload() {
  return {
    state: "ready",
    product: {
      versionId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      code: "p1",
      name: "Product one with a very long name for wrapping test in narrow layout",
      groupCode: "ghost-group",
      groupStatus: "missing_reference",
      activity: "Y",
      sectionNames: ["Section one"],
      properties: [{ code: "type", name: "Тип товара", value: "Складская" }],
      imagePaths: ["images/p1.jpg"],
      imageAssetIds: ["bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb"],
      article: null,
      snapshotImportedAt: "2026-10-01T12:00:00.000Z",
    },
    outletConfirmed: false,
    selectionPersisted: false,
    distributionEnabled: false,
    futureActionsBlockedReason: "Выберите торговую точку, чтобы сохранять дистрибуцию по образцам.",
  };
}

export function jsonResponse(status: number, body: unknown): {
  status: number;
  contentType: string;
  body: string;
} {
  return {
    status,
    contentType: "application/json",
    body: JSON.stringify(body),
  };
}

function completenessQueueItem(input: {
  entityKind: "client" | "outlet";
  guidClient: string;
  guidStore?: string | null;
  name: string;
  parentClientName?: string | null;
  reasons: string[];
  reasonLabels: string[];
}) {
  return {
    entityKind: input.entityKind,
    guidClient: input.guidClient,
    guidStore: input.guidStore ?? null,
    name: input.name,
    address: "",
    parentClientName: input.parentClientName ?? null,
    knownAssignees: {
      rop: { guid: null, name: null },
      manager: { guid: null, name: null },
      regional: { guid: null, name: null },
    },
    reasons: input.reasons,
    reasonLabels: input.reasonLabels,
    lastImportedAt: "2026-10-05T12:00:00.000Z",
    lastImportedAtLabel: "05.10.2026, 12:00",
    reviewState: null,
    reviewStateLabel: null,
    hasLinkedAccount: null,
  };
}

const COMPLETENESS_QUEUE_FIXTURE = [
  completenessQueueItem({
    entityKind: "client",
    guidClient: COMPLETENESS_CLIENT_BOTH,
    name: "Client Both Missing",
    reasons: ["missing_rop", "missing_manager"],
    reasonLabels: ["Не указан РОП", "Не указан ответственный менеджер"],
  }),
  completenessQueueItem({
    entityKind: "outlet",
    guidClient: COMPLETENESS_CLIENT_FILLED,
    guidStore: COMPLETENESS_STORE_MISSING,
    name: "Store Missing Assignments",
    parentClientName: "Client Filled",
    reasons: ["missing_rop", "missing_manager"],
    reasonLabels: ["Не указан РОП", "Не указан ответственный менеджер"],
  }),
];

export function completenessAwareQueuePayload(url: URL) {
  const entity = url.searchParams.get("entity") || "clients";
  const q = (url.searchParams.get("q") || "").trim().toLowerCase();
  const reasons = url.searchParams.getAll("completenessReason");

  let items = COMPLETENESS_QUEUE_FIXTURE.filter((item) =>
    entity === "outlets" ? item.entityKind === "outlet" : item.entityKind === "client",
  );

  if (q) {
    items = items.filter(
      (item) =>
        item.name.toLowerCase().includes(q) ||
        (item.parentClientName && item.parentClientName.toLowerCase().includes(q)),
    );
  }

  if (reasons.length > 0) {
    items = items.filter((item) => reasons.some((reason) => item.reasons.includes(reason)));
  }

  const ropEmployee = url.searchParams.get("ropEmployee");
  if (ropEmployee) {
    items = items.filter((item) => item.knownAssignees?.rop?.guid === ropEmployee);
  }
  const manager = url.searchParams.get("manager");
  if (manager) {
    items = items.filter((item) => item.knownAssignees?.manager?.guid === manager);
  }

  const page = Number(url.searchParams.get("page") || "1");
  const pageSize = Number(url.searchParams.get("pageSize") || "50");
  const total = items.length;
  const totalPages = total === 0 ? 0 : Math.ceil(total / pageSize);
  const start = (page - 1) * pageSize;

  return {
    items: items.slice(start, start + pageSize),
    total,
    page,
    pageSize,
    totalPages,
    summary: {
      clients: COMPLETENESS_QUEUE_FIXTURE.filter((item) => item.entityKind === "client").length,
      outlets: COMPLETENESS_QUEUE_FIXTURE.filter((item) => item.entityKind === "outlet").length,
      records: COMPLETENESS_QUEUE_FIXTURE.length,
    },
  };
}

export function resolveMockResponse(
  url: URL,
  options: MockOptions,
  state: { listCalls: number; catalogProductsCalls: number; lastCompletenessQueueUrl?: string },
  method = "GET",
  requestBody?: string,
): { status: number; contentType: string; body: string } | null {
  const path = url.pathname;

  if (path === "/api/auth/me") {
    if (options.role === "anonymous") {
      return jsonResponse(401, { error: { code: "UNAUTHORIZED", message: "Unauthorized" } });
    }
    let payload: Record<string, unknown>;
    if (options.clientsBusinessRole) {
      payload = userPayloadForBusinessRole(options.clientsBusinessRole);
    } else if (options.role === "manager") {
      payload = managerUserPayload();
    } else if (options.role === "marketer") {
      payload = marketerUserPayload();
    } else {
      payload = adminUserPayload();
    }
    if (options.previewActive) {
      payload.preview = {
        active: true,
        targetUser: {
          role: "manager",
          fullName: "Synthetic Manager",
          email: "manager@synthetic.test",
        },
      };
    } else {
      payload.preview = { active: false };
    }
    return jsonResponse(200, payload);
  }

  if (path === "/api/clients/presentation") {
    const presentationRole =
      options.clientsBusinessRole ??
      (options.role === "manager" ? "manager" : "admin");
    return jsonResponse(200, syntheticPresentationPayload(presentationRole));
  }

  if (path === "/api/clients/options") {
    return jsonResponse(200, options.optionsPayload ?? syntheticOptionsPayload());
  }

  if (path === "/api/clients/sync-status") {
    return jsonResponse(200, syntheticSyncStatusPayload());
  }

  if (path === "/api/admin/clients/onec-update/status") {
    if (options.role !== "admin" && options.clientsBusinessRole !== "admin") {
      return jsonResponse(403, { error: { code: "FORBIDDEN", message: "Forbidden" } });
    }
    return jsonResponse(
      200,
      syntheticOnecUpdateStatusPayload(options.onecUpdatePhase ?? "idle"),
    );
  }

  if (path === "/api/admin/clients/onec-update" && method === "POST") {
    if (options.role !== "admin" && options.clientsBusinessRole !== "admin") {
      return jsonResponse(403, { error: { code: "FORBIDDEN", message: "Forbidden" } });
    }
    return jsonResponse(202, {
      jobId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      phase: "pending",
      message: "Обновление из 1С поставлено в очередь.",
    });
  }

  if (path === "/api/clients/org-structure") {
    return jsonResponse(200, {
      director: {
        employeeGuid: "a2bacfab-ebec-11e3-a1dd-08606e7fce4d",
        name: "Synthetic Director",
        shortId: "A2BACFAB",
        rosterPost: "Директор",
        hasLinkedAccount: true,
        note: "Организационная роль директора задаётся по GUID 1С.",
      },
      rops: [
        {
          employeeGuid: NAV_ROP_A,
          name: "ROP Alpha",
          shortId: "11A0C069",
          rosterPost: "Руководитель отдела продаж",
          hasLinkedAccount: true,
          hasAssignedPortfolio: true,
          portfolioNote: null,
          managerCount: 2,
          regionalCount: 0,
          teamMemberCount: 2,
          uniqueClientCount: 1,
          uniqueOutletCount: 1,
          parentClientCount: 0,
          sources: ["roster", "assignment"],
        },
        {
          employeeGuid: NAV_ROP_B,
          name: "ROP Beta",
          shortId: "2B4CD6C6",
          rosterPost: "Руководитель отдела продаж",
          hasLinkedAccount: true,
          hasAssignedPortfolio: true,
          portfolioNote: null,
          managerCount: 2,
          regionalCount: 1,
          teamMemberCount: 2,
          uniqueClientCount: 1,
          uniqueOutletCount: 2,
          parentClientCount: 1,
          sources: ["roster", "assignment"],
        },
      ],
      undefinedTeam: [],
      rosterLoaded: true,
      limitationNote: "Структура построена по назначениям 1С.",
    });
  }

  if (path.match(/^\/api\/clients\/org-structure\/[^/]+\/responsibles$/)) {
    return jsonResponse(200, {
      items: [
        {
          kind: "manager",
          employeeGuid: SYNTHETIC_MANAGER_A,
          name: "Менеджер Иванов",
          shortId: "22222222",
          hasLinkedAccount: true,
          rosterInOpt: true,
          clientCount: 2,
          outletCount: 0,
        },
      ],
    });
  }

  if (path === "/api/clients/completeness-queue") {
    state.lastCompletenessQueueUrl = url.search;
    const payload = completenessAwareQueuePayload(url);
    if (payload) {
      return jsonResponse(200, payload);
    }
    return jsonResponse(200, {
      items: [],
      total: 0,
      page: 1,
      pageSize: 50,
      totalPages: 0,
      summary: { clients: 0, outlets: 0, records: 0 },
    });
  }

  if (path === "/api/clients/teams") {
    return jsonResponse(200, {
      items: [
        {
          ropUserId: "99999999-9999-4999-8999-999999999999",
          ropName: "Synthetic ROP",
          ropEmployeeGuid: SYNTHETIC_MANAGER_A,
          ropEmployeeName: "Менеджер Иванов",
          ropEmployeeShortId: "22222222",
          managerCount: 1,
          uniqueClientCount: 2,
        },
      ],
    });
  }

  if (path.match(/^\/api\/clients\/teams\/[^/]+\/managers$/)) {
    return jsonResponse(200, {
      items: [
        {
          kind: "team_member",
          userId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
          employeeGuid: SYNTHETIC_MANAGER_A,
          name: "Менеджер Иванов",
          shortId: "22222222",
          clientCount: 2,
        },
      ],
    });
  }

  if (path === "/api/clients/unassigned/summary") {
    return jsonResponse(200, {
      limitationNote: "Полноценный справочник сотрудников ОПТ в БД недоступен.",
      categories: [
        {
          category: "opt_without_rop_team",
          label: "Сотрудники ОПТ без команды РОП",
          uniqueClientCount: 1,
          employeeCount: 1,
        },
      ],
      employees: [
        {
          employeeGuid: "55555555-5555-4555-8555-555555555555",
          name: "Менеджер Петров",
          shortId: "55555555",
          clientCount: 1,
          category: "opt_without_rop_team",
          categoryLabel: "Сотрудники ОПТ без команды РОП",
        },
      ],
    });
  }

  if (path === "/api/clients/review/options") {
    return jsonResponse(200, {
      states: [
        { id: "unreviewed", label: "Не проверен" },
        { id: "in_progress", label: "В работе" },
        { id: "completed", label: "Завершён" },
      ],
      decisions: [{ id: "confirm_current_manager", label: "Подтвердить текущего ответственного" }],
      commentMaxLength: 2000,
    });
  }

  if (path === "/api/clients/review/eligible-managers") {
    return jsonResponse(200, {
      items: [
        {
          employeeGuid: SYNTHETIC_MANAGER_A,
          name: "Менеджер Иванов",
          shortId: "22222222",
        },
      ],
    });
  }

  if (path === "/api/clients/review/eligible-reviewers") {
    if (options.reviewersStatus && options.reviewersStatus !== 200) {
      return jsonResponse(options.reviewersStatus, {
        error: { message: "Reviewers temporarily unavailable." },
      });
    }
    return jsonResponse(200, {
      items: options.eligibleReviewersItems ?? [
        {
          userId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
          name: "Synthetic Admin",
          shortId: "aaaaaaaa",
        },
      ],
    });
  }

  const reviewMatch = path.match(/^\/api\/clients\/([^/]+)\/review(?:\/history)?$/);
  if (reviewMatch) {
    if (path.endsWith("/history")) {
      return jsonResponse(200, { items: [] });
    }
    if (method === "PUT") {
      let parsedBody: unknown = null;
      try {
        parsedBody = JSON.parse(requestBody ?? "{}");
      } catch {
        parsedBody = null;
      }
      if (typeof parsedBody === "string") {
        return jsonResponse(400, {
          error: { message: "Expected JSON object body." },
        });
      }
      const payload =
        parsedBody && typeof parsedBody === "object" && parsedBody !== null
          ? (parsedBody as {
              reviewState?: string;
              reviewDecision?: string | null;
              assignedReviewerUserId?: string | null;
              dueAt?: string | null;
              recheckConfirmed?: boolean;
            })
          : {};
      const nextStoredState = payload.recheckConfirmed
        ? payload.reviewState ?? "completed"
        : payload.reviewState ?? "completed";
      return jsonResponse(200, {
        review: {
          reviewState: nextStoredState,
          storedReviewState: nextStoredState,
          reviewDecision: payload.reviewDecision ?? "confirm_current_manager",
          version: 2,
          isStale: false,
          transferStatus: "none",
          assignedReviewerUserId: payload.assignedReviewerUserId ?? null,
          dueAt: payload.dueAt ?? null,
        },
      });
    }
    if (options.reviewGetBody !== undefined) {
      return jsonResponse(200, { review: options.reviewGetBody });
    }
    return jsonResponse(200, { review: null });
  }

  if (path === "/api/clients") {
    state.listCalls += 1;
    const entity = url.searchParams.get("entity") || "clients";
    const sortBy = url.searchParams.get("sortBy");
    if (entity === "outlets" && sortBy === "name") {
      return jsonResponse(400, {
        error: { code: "VALIDATION_ERROR", message: "Некорректное поле сортировки." },
      });
    }
    if (options.failListOnce && state.listCalls === 1) {
      return jsonResponse(503, { error: { code: "SERVICE_UNAVAILABLE", message: "Temporary" } });
    }
    if (options.listStatus && options.listStatus !== 200) {
      return jsonResponse(options.listStatus, options.listBody ?? { error: { message: "Error" } });
    }
    const portfolioPayload = portfolioAwareClientsListPayload(url);
    if (portfolioPayload) {
      return jsonResponse(200, portfolioPayload);
    }
    const filterPayload = filterAwareAllListPayload(url);
    if (filterPayload) {
      return jsonResponse(200, filterPayload);
    }
    if (entity === "outlets") {
      return jsonResponse(200, options.outletsListBody ?? syntheticOutletsListPayload());
    }
    return jsonResponse(200, options.listBody ?? syntheticListPayload());
  }

  const detailMatch = path.match(/^\/api\/clients\/([^/]+)$/);
  if (detailMatch) {
    if (options.detailStatus && options.detailStatus !== 200) {
      return jsonResponse(options.detailStatus, options.detailBody ?? { error: { message: "Error" } });
    }
    return jsonResponse(200, options.detailBody ?? syntheticDetailPayload());
  }

  if (path.endsWith("/bitrix24/label")) {
    if (options.bitrix24Label) {
      return jsonResponse(200, options.bitrix24Label);
    }
    return jsonResponse(404, {
      code: "NOT_ISSUED",
      message: "Метка для объекта ещё не выдана.",
    });
  }

  if (path.includes("/bitrix24/tasks/") && path.endsWith("/contact")) {
    if (method === "PUT") {
      return jsonResponse(200, {
        marked: true,
        markedAtLabel: "30.09.2026 12:00",
        markedByDisplayName: "Test User",
        comment: null,
      });
    }
  }

  if (path.endsWith("/bitrix24/sync")) {
    if (method === "POST") {
      if (typeof options.bitrix24Sync === "number") {
        return jsonResponse(options.bitrix24Sync, {
          error: { code: "RATE_LIMITED", message: "Синхронизация уже выполняется." },
          retryAfterMs: 30000,
        });
      }
      if (options.bitrix24Sync) {
        return jsonResponse(200, options.bitrix24Sync);
      }
      return jsonResponse(200, {
        status: "success",
        complete: true,
        message: "Данные задач и чек-листов обновлены.",
        syncedAt: "2026-09-30T12:00:00.000Z",
        syncedAtLabel: "30.09.2026, 12:00",
        tasksSynced: 1,
        checklistsSynced: 1,
      });
    }
  }

  if (path.endsWith("/bitrix24/tasks")) {
    if (options.bitrix24Tasks) {
      return jsonResponse(200, options.bitrix24Tasks);
    }
    return jsonResponse(200, {
      state: "not_configured",
      message: "Bitrix24 integration is not configured.",
      tasks: [],
      sync: null,
      portalConfigured: false,
    });
  }

  if (path.endsWith("/bitrix24/claims")) {
    if (options.bitrix24Claims) {
      return jsonResponse(200, options.bitrix24Claims);
    }
    return jsonResponse(200, {
      state: "empty",
      message: "Опубликованные рекламации по этому клиенту не найдены.",
      count: 0,
      claims: [],
      sync: null,
    });
  }

  if (path.endsWith("/catalog/meta")) {
    if (options.catalogAccessRevoked) {
      return jsonResponse(404, { error: { code: "NOT_FOUND", message: "Client not found." } });
    }
    return jsonResponse(200, options.catalogMeta ?? syntheticCatalogMetaPayload());
  }

  if (path.endsWith("/catalog/sections-tree")) {
    if (options.catalogAccessRevoked) {
      return jsonResponse(404, { error: { code: "NOT_FOUND", message: "Client not found." } });
    }
    return jsonResponse(200, {
      state: "ready",
      versionId: syntheticCatalogMetaPayload().versionId,
      tree: [
        {
          code: "s1",
          name: "Section one",
          parentCode: null,
          children: [{ code: "s2", name: "Section two", parentCode: "s1", children: [] }],
        },
      ],
    });
  }

  if (path.endsWith("/catalog/facets")) {
    if (options.catalogAccessRevoked) {
      return jsonResponse(404, { error: { code: "NOT_FOUND", message: "Client not found." } });
    }
    return jsonResponse(200, {
      state: "ready",
      versionId: syntheticCatalogMetaPayload().versionId,
      total: 1,
      availableFilters: [{ key: "brand", label: "Бренд" }],
      facets: [
        {
          key: "brand",
          label: "Бренд",
          values: [{ value: "Tandoor", count: 1 }],
          totalValues: 1,
          valuesTruncated: false,
        },
      ],
    });
  }

  if (path.endsWith("/catalog/facet-values")) {
    if (options.catalogAccessRevoked) {
      return jsonResponse(404, { error: { code: "NOT_FOUND", message: "Client not found." } });
    }
    const facetKey = url.searchParams.get("facetKey") ?? "brand";
    const facetQ = (url.searchParams.get("facetQ") ?? "").toLowerCase();
    const allValues = [
      { value: "Tandoor", count: 1 },
      { value: "Other brand", count: 1 },
    ];
    const filtered = facetQ
      ? allValues.filter((entry) => entry.value.toLowerCase().includes(facetQ))
      : allValues;
    return jsonResponse(200, {
      state: "ready",
      versionId: syntheticCatalogMetaPayload().versionId,
      key: facetKey,
      label: "Бренд",
      total: filtered.length,
      values: filtered,
      offset: Number(url.searchParams.get("facetOffset") ?? "0"),
      hasMore: false,
    });
  }

  const mediaMatch = path.match(/\/catalog\/media\/([^/]+)$/);
  if (mediaMatch) {
    if (options.catalogAccessRevoked) {
      return jsonResponse(404, { error: { code: "NOT_FOUND", message: "Image not found." } });
    }
    return {
      status: 200,
      contentType: "image/png",
      body: Buffer.from(
        "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
        "base64",
      ),
      headers: { "Cache-Control": "no-store" },
    };
  }

  if (path.endsWith("/catalog/products") && !path.match(/\/catalog\/products\/[^/]+$/)) {
    state.catalogProductsCalls += 1;
    if (options.catalogFailProductsOnce && state.catalogProductsCalls === 1) {
      return jsonResponse(503, { error: { code: "SERVICE_UNAVAILABLE", message: "Temporary" } });
    }
    if (options.catalogProductsStatus && options.catalogProductsStatus !== 200) {
      return jsonResponse(
        options.catalogProductsStatus,
        options.catalogProducts ?? { error: { message: "Error" } },
      );
    }
    const activeVersionId =
      options.catalogActiveVersionId ??
      (options.catalogMeta as { versionId?: string } | undefined)?.versionId ??
      syntheticCatalogMetaPayload().versionId;
    const requestedVersionId = url.searchParams.get("versionId");
    if (requestedVersionId && requestedVersionId !== activeVersionId) {
      return jsonResponse(409, {
        code: "CATALOG_VERSION_CHANGED",
        message: "Каталог обновился после открытия списка. Обновите данные и повторите выбор.",
        currentVersionId: activeVersionId,
        importedAt: "2026-10-01T13:00:00.000Z",
      });
    }
    const section = url.searchParams.get("section");
    const base = structuredClone(options.catalogProducts ?? syntheticCatalogProductsPayload()) as {
      items: Array<Record<string, unknown>>;
      total: number;
      versionId: string;
      sectionCode: string | null;
      query: string;
      page: number;
    };
    base.versionId = activeVersionId;
    base.query = url.searchParams.get("q") ?? "";
    base.sectionCode = section;
    base.page = Number(url.searchParams.get("page") ?? "1");
    if (section === "s2") {
      base.total = 0;
      base.items = [];
    }
    return jsonResponse(200, base);
  }

  const productDetailMatch = path.match(/\/catalog\/products\/([^/]+)$/);
  if (productDetailMatch) {
    if (options.catalogAccessRevoked) {
      return jsonResponse(404, { error: { code: "NOT_FOUND", message: "Client not found." } });
    }
    const activeVersionId =
      options.catalogActiveVersionId ??
      (options.catalogMeta as { versionId?: string } | undefined)?.versionId ??
      syntheticCatalogMetaPayload().versionId;
    const requestedVersionId = url.searchParams.get("versionId");
    if (requestedVersionId && requestedVersionId !== activeVersionId) {
      return jsonResponse(409, {
        code: "CATALOG_VERSION_CHANGED",
        message: "Каталог обновился после открытия списка. Обновите данные и повторите выбор.",
        currentVersionId: activeVersionId,
      });
    }
    return jsonResponse(200, options.catalogProductDetail ?? syntheticCatalogProductDetailPayload());
  }

  return null;
}
