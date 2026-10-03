export const SYNTHETIC_CLIENT_GUID = "11111111-1111-4111-8111-111111111111";
export const SYNTHETIC_CLIENT_TWO = "33333333-3333-4333-8333-333333333333";
export const SYNTHETIC_MANAGER_A = "22222222-2222-4222-8222-222222222222";
export const SYNTHETIC_HOLDING_A = "44444444-4444-4444-8444-444444444444";

export type MockRole = "admin" | "manager" | "marketer" | "anonymous";

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

export function syntheticOptionsPayload() {
  return {
    managers: [
      {
        id: SYNTHETIC_MANAGER_A,
        name: "Менеджер Иванов",
        shortId: "22222222",
      },
    ],
    holdings: [
      {
        id: SYNTHETIC_HOLDING_A,
        name: "Холдинг Восток",
        shortId: "44444444",
      },
    ],
  };
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
  listStatus?: number;
  listBody?: unknown;
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
    outletConfirmed: false,
    futureActionsBlockedReason:
      "Просмотр каталога. Сохранение дистрибуции станет доступно после подключения торговой точки.",
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
    futureActionsBlockedReason:
      "Просмотр каталога. Сохранение дистрибуции станет доступно после подключения торговой точки.",
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

export function resolveMockResponse(
  url: URL,
  options: MockOptions,
  state: { listCalls: number; catalogProductsCalls: number },
  method = "GET",
): { status: number; contentType: string; body: string } | null {
  const path = url.pathname;

  if (path === "/api/auth/me") {
    if (options.role === "anonymous") {
      return jsonResponse(401, { error: { code: "UNAUTHORIZED", message: "Unauthorized" } });
    }
    if (options.role === "manager") {
      return jsonResponse(200, managerUserPayload());
    }
    if (options.role === "marketer") {
      return jsonResponse(200, marketerUserPayload());
    }
    return jsonResponse(200, adminUserPayload());
  }

  if (path === "/api/clients/options") {
    return jsonResponse(200, syntheticOptionsPayload());
  }

  if (path === "/api/clients/sync-status") {
    return jsonResponse(200, syntheticSyncStatusPayload());
  }

  if (path === "/api/clients") {
    state.listCalls += 1;
    if (options.failListOnce && state.listCalls === 1) {
      return jsonResponse(503, { error: { code: "SERVICE_UNAVAILABLE", message: "Temporary" } });
    }
    if (options.listStatus && options.listStatus !== 200) {
      return jsonResponse(options.listStatus, options.listBody ?? { error: { message: "Error" } });
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
