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

export type MockOptions = {
  role?: MockRole;
  listStatus?: number;
  listBody?: unknown;
  detailStatus?: number;
  detailBody?: unknown;
  failListOnce?: boolean;
  bitrix24Label?: Record<string, unknown>;
  bitrix24Tasks?: Record<string, unknown>;
};

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
  state: { listCalls: number },
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

  return null;
}
