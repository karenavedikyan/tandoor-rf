(function (root, factory) {
  if (typeof module === "object" && module.exports) {
    module.exports = factory();
  } else {
    root.ClientsLogic = factory();
  }
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  var NO_DATA_LABEL = "Нет данных";
  var MISSING_ROP_ID = "__missing_rop__";
  var MISSING_MANAGER_ID = "__missing_manager__";
  var MISSING_REGIONAL_ID = "__missing_regional__";
  var MISSING_HARDWARE_ID = "__missing_hardware__";

  var LIST_QUERY_KEYS = [
    "view",
    "entity",
    "q",
    "manager",
    "clientManager",
    "outletManager",
    "holding",
    "phone",
    "rop",
    "ropEmployee",
    "clientRopEmployee",
    "outletRopEmployee",
    "unassignedCategory",
    "reviewState",
    "reviewDecision",
    "hasOutlets",
    "sortBy",
    "sortDir",
    "cols",
    "outletStatus",
    "warehouse",
    "regionalManager",
    "clientRegionalManager",
    "outletRegionalManager",
    "hardwareManager",
    "clientHardwareManager",
    "outletHardwareManager",
    "clientManagerMode",
    "outletManagerMode",
    "clientRegionalManagerMode",
    "outletRegionalManagerMode",
    "clientHardwareManagerMode",
    "outletHardwareManagerMode",
    "clientRopEmployeeMode",
    "outletRopEmployeeMode",
    "missingClientManager",
    "missingOutletManager",
    "missingClientRegional",
    "missingOutletRegional",
    "missingClientHardware",
    "missingOutletHardware",
    "missingClientRop",
    "missingOutletRop",
    "tandoorClub",
    "routeDirection",
    "storeAddressContains",
    "storePhoneContains",
    "accountantPhoneContains",
    "accountantEmailContains",
    "loadingTime",
    "loadingSchedule",
    "discountProgram",
    "onecTop150",
    "onecCategory",
    "onecCounterpartyContains",
    "onecFullNameContains",
    "onecLegalEntityType",
    "onecOgrn",
    "discountAmountMin",
    "discountAmountMax",
    "markupName",
    "markupPercentage",
    "bonusTandoorClub",
    "lprNameContains",
    "lprPostContains",
    "lprPhoneContains",
    "lprEmailContains",
    "lprBonusContains",
    "lprConditionsBonusContains",
    "lprDateOfBirth",
    "lprDateOfBirthFrom",
    "lprDateOfBirthTo",
    "filled",
    "empty",
    "portfolio",
    "responsibleKind",
    "completenessReason",
    "missingRop",
    "missingManager",
    "missingRegional",
    "missingHardware",
    "page",
    "teamExpand",
    "teamQ",
    "teamKind",
    "teamSource",
    "onecTeam",
  ];

  var FIELD_FILTER_EMPTY_OPTIONS = [
    { value: "", label: "—" },
    { value: "deliveryAddress", label: "Адрес доставки пуст" },
    { value: "routeDirection", label: "Маршрут пуст" },
    { value: "storePhone", label: "Телефон магазина пуст" },
    { value: "accountantPhone", label: "Телефон бухгалтерии пуст" },
    { value: "accountantEmail", label: "Email бухгалтерии пуст" },
    { value: "loadingTime", label: "Время приёмки пусто" },
    { value: "loadingSchedule", label: "Дни приёмки не заданы" },
    { value: "tandoorClub", label: "Tandoor Club пуст" },
    { value: "bonusTandoorClub", label: "Bonus Tandoor Club пуст" },
    { value: "lprName", label: "ФИО ЛПР пусто" },
    { value: "lprPost", label: "Должность ЛПР пуста" },
    { value: "lprPhone", label: "Телефон ЛПР пуст" },
    { value: "lprEmail", label: "Email ЛПР пуст" },
    { value: "lprDateOfBirth", label: "Дата рождения ЛПР пуста" },
    { value: "lprBonus", label: "Бонус ЛПР пуст" },
    { value: "lprConditionsBonus", label: "Условия бонуса ЛПР пусты" },
    { value: "discountProgram", label: "Discount пуст" },
    { value: "onecTop150", label: "ТОП-150 (1С) пуст" },
    { value: "onecCategory", label: "Категория 1С пуста" },
    { value: "onecCounterparty", label: "Контрагент пуст" },
    { value: "onecFullName", label: "Полное наименование пусто" },
    { value: "onecLegalEntityType", label: "Тип контрагента пуст" },
    { value: "onecOgrn", label: "ОГРН пуст" },
    { value: "discountAmount", label: "DiscountAmount пуст" },
    { value: "markups", label: "Markups пуст" },
  ];

  var CLIENT_FILLED_EMPTY_FIELD_IDS = {
    address: true,
    telephone: true,
    holding: true,
    discountProgram: true,
    onecTop150: true,
    onecCategory: true,
    onecCounterparty: true,
    onecFullName: true,
    onecLegalEntityType: true,
    onecOgrn: true,
    discountAmount: true,
    markups: true,
  };

  var CLIENT_ONLY_VALUE_FILTER_KEYS = [
    "discountProgram",
    "onecTop150",
    "onecCategory",
    "onecCounterpartyContains",
    "onecFullNameContains",
    "onecLegalEntityType",
    "onecOgrn",
    "discountAmountMin",
    "discountAmountMax",
    "markupName",
    "markupPercentage",
  ];

  function stripFilledEmptyFieldsForEntity(value, entity) {
    if (!value || entity !== "outlets") {
      return value || "";
    }
    return value
      .split(",")
      .map(function (part) {
        return part.trim();
      })
      .filter(function (part) {
        return part.length > 0 && !CLIENT_FILLED_EMPTY_FIELD_IDS[part];
      })
      .join(",");
  }

  function clearClientCommercialFilters(state) {
    state.discountProgram = "";
    state.onecTop150 = "";
    state.onecCategory = "";
    state.onecCounterpartyContains = "";
    state.onecFullNameContains = "";
    state.onecLegalEntityType = "";
    state.onecOgrn = "";
    state.discountAmountMin = "";
    state.discountAmountMax = "";
    state.markupName = "";
    state.markupPercentage = "";
  }

  function sanitizeStateForEntity(state) {
    var next = Object.assign({}, state);
    if (next.entity === "outlets") {
      clearClientCommercialFilters(next);
      next.filled = stripFilledEmptyFieldsForEntity(next.filled, "outlets");
      next.empty = stripFilledEmptyFieldsForEntity(next.empty, "outlets");
    }
    return next;
  }

  var FIELD_FILTER_FILLED_OPTIONS = [
    { value: "", label: "—" },
    { value: "deliveryAddress", label: "Адрес доставки заполнен" },
    { value: "routeDirection", label: "Маршрут заполнен" },
    { value: "storePhone", label: "Телефон магазина заполнен" },
    { value: "accountantPhone", label: "Телефон бухгалтерии заполнен" },
    { value: "accountantEmail", label: "Email бухгалтерии заполнен" },
    { value: "loadingTime", label: "Время приёмки задано" },
    { value: "loadingSchedule", label: "Дни приёмки заданы" },
    { value: "tandoorClub", label: "Tandoor Club заполнен" },
    { value: "bonusTandoorClub", label: "Bonus Tandoor Club заполнен" },
    { value: "lprName", label: "ФИО ЛПР заполнено" },
    { value: "lprPost", label: "Должность ЛПР заполнена" },
    { value: "lprPhone", label: "Телефон ЛПР заполнен" },
    { value: "lprEmail", label: "Email ЛПР заполнен" },
    { value: "lprDateOfBirth", label: "Дата рождения ЛПР заполнена" },
    { value: "lprBonus", label: "Бонус ЛПР заполнен" },
    { value: "lprConditionsBonus", label: "Условия бонуса ЛПР заполнены" },
    { value: "discountProgram", label: "Discount заполнен" },
    { value: "onecTop150", label: "ТОП-150 (1С) заполнен" },
    { value: "onecCategory", label: "Категория 1С заполнена" },
    { value: "onecCounterparty", label: "Контрагент заполнен" },
    { value: "onecFullName", label: "Полное наименование заполнено" },
    { value: "onecLegalEntityType", label: "Тип контрагента заполнен" },
    { value: "onecOgrn", label: "ОГРН заполнен" },
    { value: "discountAmount", label: "DiscountAmount заполнен" },
    { value: "markups", label: "Markups заполнен" },
  ];

  var CLIENT_COLUMNS = [
    { id: "name", label: "Клиент", entity: "clients", defaultVisible: true, locked: true, sortable: true, hasSource: true },
    { id: "code1c", label: "Код 1С", entity: "clients", defaultVisible: false, sortable: false, hasSource: false },
    { id: "inn", label: "ИНН", entity: "clients", defaultVisible: false, sortable: false, hasSource: false },
    { id: "category", label: "Категория", entity: "clients", defaultVisible: false, sortable: false, hasSource: false },
    { id: "onecTop150", label: "ТОП-150 (1С)", entity: "clients", defaultVisible: false, sortable: false, hasSource: true },
    { id: "onecCategory", label: "Категория 1С", entity: "clients", defaultVisible: false, sortable: false, hasSource: true },
    { id: "onecCounterparty", label: "Контрагент", entity: "clients", defaultVisible: false, sortable: false, hasSource: true },
    { id: "onecFullName", label: "Полное наименование", entity: "clients", defaultVisible: false, sortable: false, hasSource: true },
    { id: "onecLegalEntityType", label: "Тип контрагента", entity: "clients", defaultVisible: false, sortable: false, hasSource: true },
    { id: "onecOgrn", label: "ОГРН", entity: "clients", defaultVisible: false, sortable: false, hasSource: true },
    { id: "holding", label: "Холдинг", entity: "clients", defaultVisible: true, sortable: true, hasSource: true },
    { id: "address", label: "Адрес", entity: "clients", defaultVisible: true, sortable: true, hasSource: true },
    { id: "city", label: "Город", entity: "clients", defaultVisible: false, sortable: false, hasSource: false },
    { id: "manager", label: "Менеджер клиента", entity: "clients", defaultVisible: true, sortable: true, hasSource: true },
    { id: "regional", label: "Региональный менеджер", entity: "clients", defaultVisible: false, sortable: false, hasSource: true },
    { id: "hardware", label: "Менеджер по фурнитуре", entity: "clients", defaultVisible: false, sortable: false, hasSource: true },
    { id: "rop", label: "РОП", entity: "clients", defaultVisible: false, sortable: false, hasSource: true },
    { id: "team", label: "РОП / команда", entity: "clients", defaultVisible: false, sortable: true, viewModes: ["teams", "review"], hasSource: true },
    { id: "outletsCount", label: "Кол-во ТТ", entity: "clients", defaultVisible: false, sortable: true, hasSource: true },
    { id: "assignmentState", label: "Состояние назначения", entity: "clients", defaultVisible: false, sortable: false, viewModes: ["teams", "review"], hasSource: true },
    { id: "review", label: "Ревизия", entity: "clients", defaultVisible: false, sortable: false, viewModes: ["review"], hasSource: true },
    { id: "phone", label: "Телефон", entity: "clients", defaultVisible: true, sortable: false, hasSource: true },
    { id: "warehouse", label: "Склад", entity: "clients", defaultVisible: false, sortable: false, hasSource: false },
    { id: "tandoorClub", label: "Tandoor Club", entity: "clients", defaultVisible: false, sortable: false, hasSource: false },
    { id: "cashback", label: "Cashback", entity: "clients", defaultVisible: false, sortable: false, hasSource: false },
    { id: "discountProgram", label: "Discount", entity: "clients", defaultVisible: false, sortable: false, hasSource: true },
    { id: "discountAmount", label: "DiscountAmount", entity: "clients", defaultVisible: false, sortable: false, hasSource: true },
    { id: "nextStep", label: "Следующий шаг", entity: "clients", defaultVisible: false, sortable: false, hasSource: false },
  ];

  var OUTLET_COLUMNS = [
    { id: "clientName", label: "Клиент", entity: "outlets", defaultVisible: true, locked: true, sortable: true, hasSource: true },
    { id: "outlet", label: "Торговая точка", entity: "outlets", defaultVisible: true, sortable: true, hasSource: true },
    { id: "guidStore", label: "ID ТТ", entity: "outlets", defaultVisible: false, sortable: true, hasSource: true },
    { id: "address", label: "Адрес", entity: "outlets", defaultVisible: true, sortable: true, hasSource: true },
    { id: "status", label: "Статус ТТ", entity: "outlets", defaultVisible: true, sortable: true, hasSource: true },
    { id: "manager", label: "Менеджер ТТ", entity: "outlets", defaultVisible: true, sortable: true, hasSource: true },
    { id: "clientManager", label: "Менеджер клиента", entity: "outlets", defaultVisible: false, sortable: false, hasSource: true },
    { id: "holding", label: "Холдинг", entity: "outlets", defaultVisible: false, sortable: true, hasSource: true },
    { id: "regional", label: "Региональный ТТ", entity: "outlets", defaultVisible: false, sortable: true, hasSource: true },
    { id: "hardware", label: "Менеджер по фурнитуре ТТ", entity: "outlets", defaultVisible: false, sortable: false, hasSource: true },
    { id: "rop", label: "РОП ТТ", entity: "outlets", defaultVisible: false, sortable: false, hasSource: true },
    { id: "warehouse", label: "Склад", entity: "outlets", defaultVisible: false, sortable: true, hasSource: true },
    { id: "tandoorClub", label: "Tandoor Club", entity: "outlets", defaultVisible: false, sortable: true, hasSource: true },
    { id: "bonusTandoorClub", label: "Bonus Tandoor Club", entity: "outlets", defaultVisible: false, sortable: false, hasSource: true },
    { id: "lprName", label: "ЛПР · ФИО", entity: "outlets", defaultVisible: false, sortable: false, hasSource: true },
    { id: "lprPost", label: "ЛПР · должность", entity: "outlets", defaultVisible: false, sortable: false, hasSource: true },
    { id: "lprPhone", label: "ЛПР · телефон", entity: "outlets", defaultVisible: false, sortable: false, hasSource: true },
    { id: "lprEmail", label: "ЛПР · email", entity: "outlets", defaultVisible: false, sortable: false, hasSource: true },
    { id: "lprDateOfBirth", label: "ЛПР · дата рождения", entity: "outlets", defaultVisible: false, sortable: false, hasSource: true },
    { id: "lprBonus", label: "ЛПР · бонус", entity: "outlets", defaultVisible: false, sortable: false, hasSource: true },
    { id: "lprConditionsBonus", label: "ЛПР · условия бонуса", entity: "outlets", defaultVisible: false, sortable: false, hasSource: true },
    { id: "cashback", label: "Cashback", entity: "outlets", defaultVisible: false, sortable: false, hasSource: false },
  ];

  function columnDefinitions(entity) {
    return entity === "outlets" ? OUTLET_COLUMNS.slice() : CLIENT_COLUMNS.slice();
  }

  function isColumnAllowedForView(col, view) {
    if (!col.viewModes || col.viewModes.length === 0) {
      return true;
    }
    return col.viewModes.indexOf(view) !== -1;
  }

  function defaultVisibleColumnIds(entity, view) {
    return columnDefinitions(entity)
      .filter(function (col) {
        return col.defaultVisible && isColumnAllowedForView(col, view);
      })
      .map(function (col) {
        return col.id;
      });
  }

  function parseColumnsParam(raw) {
    if (!raw || typeof raw !== "string") {
      return [];
    }
    return raw
      .split(",")
      .map(function (part) {
        return part.trim();
      })
      .filter(function (part) {
        return part.length > 0;
      });
  }

  function buildColumnsStorageKey(userId, entity) {
    return "clients-columns:" + (userId || "anonymous") + ":" + (entity || "clients");
  }

  function readStoredColumnIds(storageKey) {
    try {
      if (typeof localStorage === "undefined") {
        return [];
      }
      var raw = localStorage.getItem(storageKey);
      if (!raw) {
        return [];
      }
      var parsed = JSON.parse(raw);
      if (!Array.isArray(parsed)) {
        return [];
      }
      return parsed.filter(function (item) {
        return typeof item === "string";
      });
    } catch (_err) {
      return [];
    }
  }

  function persistStoredColumnIds(storageKey, columnIds) {
    try {
      if (typeof localStorage === "undefined") {
        return;
      }
      localStorage.setItem(storageKey, JSON.stringify(columnIds));
    } catch (_err) {
      /* ignore quota errors */
    }
  }

  function resolveVisibleColumns(input) {
    var entity = input.entity || "clients";
    var view = input.view || "all";
    var defs = columnDefinitions(entity);
    var defById = {};
    defs.forEach(function (col) {
      defById[col.id] = col;
    });
    var allowedIds = defs
      .filter(function (col) {
        return isColumnAllowedForView(col, view);
      })
      .map(function (col) {
        return col.id;
      });
    var allowedSet = {};
    allowedIds.forEach(function (id) {
      allowedSet[id] = true;
    });

    var fromUrl = parseColumnsParam(input.cols || "");
    var fromStorage = input.storageKey ? readStoredColumnIds(input.storageKey) : [];
    var seed = fromUrl.length > 0 ? fromUrl : fromStorage.length > 0 ? fromStorage : defaultVisibleColumnIds(entity, view);

    var visible = [];
    seed.forEach(function (id) {
      if (!allowedSet[id] || visible.indexOf(id) !== -1) {
        return;
      }
      visible.push(id);
    });

    defs.forEach(function (col) {
      if (col.locked && visible.indexOf(col.id) === -1 && isColumnAllowedForView(col, view)) {
        visible.unshift(col.id);
      }
    });

    if (visible.length === 0) {
      return defaultVisibleColumnIds(entity, view);
    }
    return visible;
  }

  function toggleColumnSelection(currentIds, columnId, enabled, entity, view) {
    var defs = columnDefinitions(entity);
    var def = defs.find(function (col) {
      return col.id === columnId;
    });
    if (!def || def.locked || !isColumnAllowedForView(def, view || "all")) {
      return currentIds.slice();
    }
    var next = currentIds.slice();
    var index = next.indexOf(columnId);
    if (enabled && index === -1) {
      next.push(columnId);
    }
    if (!enabled && index !== -1) {
      next.splice(index, 1);
    }
    defs.forEach(function (col) {
      if (col.locked && next.indexOf(col.id) === -1) {
        next.unshift(col.id);
      }
    });
    return next.length > 0 ? next : defaultVisibleColumnIds(entity, view || "all");
  }

  function nextSortState(currentSortBy, currentSortDir, columnId) {
    if (currentSortBy !== columnId) {
      return { sortBy: columnId, sortDir: "asc" };
    }
    if (currentSortDir === "asc") {
      return { sortBy: columnId, sortDir: "desc" };
    }
    return { sortBy: columnId, sortDir: "asc" };
  }

  function sortIndicator(sortBy, sortDir, columnId) {
    if (sortBy !== columnId) {
      return "";
    }
    return sortDir === "desc" ? " ▼" : " ▲";
  }

  function defaultSortFieldForEntity(entity) {
    return entity === "outlets" ? "clientName" : "name";
  }

  function mapSortFieldForEntity(fromEntity, toEntity, sortBy) {
    if (!sortBy || fromEntity === toEntity) {
      return sortBy || null;
    }
    if (fromEntity === "clients" && toEntity === "outlets") {
      var toOutlets = { name: "clientName", holding: "holding", manager: "manager", address: "address" };
      return toOutlets[sortBy] || null;
    }
    if (fromEntity === "outlets" && toEntity === "clients") {
      var toClients = { clientName: "name", holding: "holding", manager: "manager", address: "address" };
      return toClients[sortBy] || null;
    }
    return null;
  }

  function isSortAllowedForEntity(entity, sortBy) {
    if (!sortBy) {
      return false;
    }
    var def = columnDefinitions(entity).find(function (col) {
      return col.id === sortBy;
    });
    return Boolean(def && def.sortable && def.hasSource);
  }

  function normalizeStateForEntitySwitch(state, previousEntity) {
    var next = Object.assign({}, state);
    next.page = 1;
    next.cols = "";
    var mappedSort = mapSortFieldForEntity(previousEntity, next.entity, next.sortBy);
    if (mappedSort && isSortAllowedForEntity(next.entity, mappedSort)) {
      next.sortBy = mappedSort;
    } else if (isSortAllowedForEntity(next.entity, next.sortBy)) {
      /* keep */
    } else {
      next.sortBy = defaultSortFieldForEntity(next.entity);
      next.sortDir = "asc";
    }
    if (next.entity !== previousEntity) {
      next = sanitizeStateForEntity(next);
    }
    return next;
  }

  function readStateFromSearch(search) {
    var params = new URLSearchParams(search || "");
    var view = params.get("view") || "all";
    if (view !== "all" && view !== "teams" && view !== "review" && view !== "completeness") {
      view = "all";
    }
    var entity = params.get("entity") || "clients";
    if (entity !== "clients" && entity !== "outlets") {
      entity = "clients";
    }
    var legacyManager = params.get("manager") || "";
    var clientManager = params.get("clientManager") || (entity === "clients" ? legacyManager : "");
    var outletManager =
      params.get("outletManager") || (entity === "outlets" ? legacyManager : params.get("outletManager") || "");
    var legacyRegional = params.get("regionalManager") || "";
    var clientRegional = params.get("clientRegionalManager") || (entity === "clients" ? legacyRegional : "");
    var outletRegional =
      params.get("outletRegionalManager") || (entity === "outlets" ? legacyRegional : "");
    var legacyHardware = params.get("hardwareManager") || "";
    var clientHardware = params.get("clientHardwareManager") || (entity === "clients" ? legacyHardware : "");
    var outletHardware =
      params.get("outletHardwareManager") || (entity === "outlets" ? legacyHardware : "");
    var legacyRop = params.get("ropEmployee") || "";
    return sanitizeStateForEntity({
      view: view,
      entity: entity,
      q: params.get("q") || "",
      manager: legacyManager,
      clientManager: clientManager,
      outletManager: outletManager,
      holding: params.get("holding") || "",
      phone: params.get("phone") || "all",
      rop: params.get("rop") || "",
      ropEmployee: legacyRop,
      clientRopEmployee: params.get("clientRopEmployee") || (entity === "clients" ? legacyRop : ""),
      outletRopEmployee: params.get("outletRopEmployee") || (entity === "outlets" ? legacyRop : ""),
      unassignedCategory: params.get("unassignedCategory") || "",
      reviewState: params.get("reviewState") || "",
      reviewDecision: params.get("reviewDecision") || "",
      hasOutlets: params.get("hasOutlets") || "all",
      outletStatus: params.get("outletStatus") || "all",
      warehouse: params.get("warehouse") || "all",
      regionalManager: legacyRegional,
      clientRegionalManager: clientRegional,
      outletRegionalManager: outletRegional,
      hardwareManager: legacyHardware,
      clientHardwareManager: clientHardware,
      outletHardwareManager: outletHardware,
      clientManagerMode: params.get("clientManagerMode") || "",
      outletManagerMode: params.get("outletManagerMode") || "",
      clientRegionalManagerMode: params.get("clientRegionalManagerMode") || "",
      outletRegionalManagerMode: params.get("outletRegionalManagerMode") || "",
      clientHardwareManagerMode: params.get("clientHardwareManagerMode") || "",
      outletHardwareManagerMode: params.get("outletHardwareManagerMode") || "",
      clientRopEmployeeMode: params.get("clientRopEmployeeMode") || "",
      outletRopEmployeeMode: params.get("outletRopEmployeeMode") || "",
      portfolio: params.get("portfolio") || "",
      responsibleKind: params.get("responsibleKind") || "",
      completenessReasons: params
        .getAll("completenessReason")
        .map(function (value) {
          return value.trim();
        })
        .filter(function (value) {
          return value.length > 0;
        }),
      tandoorClub: params.get("tandoorClub") || "",
      routeDirection: params.get("routeDirection") || "",
      storeAddressContains: params.get("storeAddressContains") || "",
      storePhoneContains: params.get("storePhoneContains") || "",
      accountantPhoneContains: params.get("accountantPhoneContains") || "",
      accountantEmailContains: params.get("accountantEmailContains") || "",
      loadingTime: params.get("loadingTime") || "",
      loadingSchedule: params.get("loadingSchedule") || "all",
      discountProgram: params.get("discountProgram") || "",
      onecTop150: params.get("onecTop150") || "",
      onecCategory: params.get("onecCategory") || "",
      onecCounterpartyContains: params.get("onecCounterpartyContains") || "",
      onecFullNameContains: params.get("onecFullNameContains") || "",
      onecLegalEntityType: params.get("onecLegalEntityType") || "",
      onecOgrn: params.get("onecOgrn") || "",
      discountAmountMin: params.get("discountAmountMin") || "",
      discountAmountMax: params.get("discountAmountMax") || "",
      markupName: params.get("markupName") || "",
      markupPercentage: params.get("markupPercentage") || "",
      bonusTandoorClub: params.get("bonusTandoorClub") || "",
      lprNameContains: params.get("lprNameContains") || "",
      lprPostContains: params.get("lprPostContains") || "",
      lprPhoneContains: params.get("lprPhoneContains") || "",
      lprEmailContains: params.get("lprEmailContains") || "",
      lprBonusContains: params.get("lprBonusContains") || "",
      lprConditionsBonusContains: params.get("lprConditionsBonusContains") || "",
      lprDateOfBirth: params.get("lprDateOfBirth") || "",
      lprDateOfBirthFrom: params.get("lprDateOfBirthFrom") || "",
      lprDateOfBirthTo: params.get("lprDateOfBirthTo") || "",
      filled: params.get("filled") || "",
      empty: params.get("empty") || "",
      missingRop: params.get("missingRop") === "1" || params.get("missingClientRop") === "1",
      missingManager: params.get("missingManager") === "1" || params.get("missingClientManager") === "1",
      missingRegional: params.get("missingRegional") === "1" || params.get("missingClientRegional") === "1",
      missingHardware: params.get("missingHardware") === "1" || params.get("missingClientHardware") === "1",
      missingClientManager: params.get("missingClientManager") === "1",
      missingOutletManager: params.get("missingOutletManager") === "1",
      missingClientRegional: params.get("missingClientRegional") === "1",
      missingOutletRegional: params.get("missingOutletRegional") === "1",
      missingClientHardware: params.get("missingClientHardware") === "1",
      missingOutletHardware: params.get("missingOutletHardware") === "1",
      missingClientRop: params.get("missingClientRop") === "1",
      missingOutletRop: params.get("missingOutletRop") === "1",
      sortBy: params.get("sortBy") || "",
      sortDir: params.get("sortDir") || "",
      cols: params.get("cols") || "",
      page: Math.max(1, Number(params.get("page") || "1") || 1),
      teamExpand: params
        .getAll("teamExpand")
        .map(function (value) {
          return value.trim();
        })
        .filter(function (value) {
          return value.length > 0;
        }),
      teamQ: params.get("teamQ") || "",
      teamKind: params.get("teamKind") || "",
      teamSource: params.get("teamSource") === "onec" ? "onec" : "rop",
      onecTeam: params.get("onecTeam") || "",
    });
  }

  function normalizeTeamKind(value) {
    if (value === "manager" || value === "regional" || value === "hardware") {
      return value;
    }
    return "";
  }

  function applyPresentationDefaults(state, presentation, search) {
    if (!presentation) {
      return state;
    }
    var params = new URLSearchParams(search || "");
    var next = Object.assign({}, state);
    if (!params.has("view")) {
      next.view = presentation.defaultView || next.view;
    }
    if (!params.has("entity")) {
      next.entity = presentation.defaultEntity || next.entity;
    }
    return next;
  }

  function isBranchPortfolioList(state) {
    return (
      state &&
      state.view === "teams" &&
      state.ropEmployee &&
      (state.portfolio === "clients" || state.portfolio === "outlets")
    );
  }

  function hasResponsibleSelection(state) {
    if (!state || state.view !== "teams" || !state.ropEmployee) {
      return false;
    }
    if (state.responsibleKind === "regional") {
      return Boolean(state.regionalManager);
    }
    if (state.responsibleKind === "hardware") {
      return Boolean(state.hardwareManager);
    }
    if (state.responsibleKind === "manager") {
      return Boolean(state.manager);
    }
    return Boolean(state.manager);
  }

  function appendAssignmentParams(params, state) {
    var entity = state.entity || "clients";
    var managerSlice = assignmentFilterSliceFromState(
      state,
      {
        clients: {
          guid: "clientManager",
          mode: "clientManagerMode",
          missing: "missingClientManager",
          legacyGuid: "manager",
          legacyMissing: "missingManager",
        },
        outlets: {
          guid: "outletManager",
          mode: "outletManagerMode",
          missing: "missingOutletManager",
          legacyGuid: "manager",
          legacyMissing: "missingManager",
        },
      },
      entity,
    );
    var regionalSlice = assignmentFilterSliceFromState(
      state,
      {
        clients: {
          guid: "clientRegionalManager",
          mode: "clientRegionalManagerMode",
          missing: "missingClientRegional",
          legacyGuid: "regionalManager",
          legacyMissing: "missingRegional",
        },
        outlets: {
          guid: "outletRegionalManager",
          mode: "outletRegionalManagerMode",
          missing: "missingOutletRegional",
          legacyGuid: "regionalManager",
          legacyMissing: "missingRegional",
        },
      },
      entity,
    );
    var hardwareSlice = assignmentFilterSliceFromState(
      state,
      {
        clients: {
          guid: "clientHardwareManager",
          mode: "clientHardwareManagerMode",
          missing: "missingClientHardware",
          legacyGuid: "hardwareManager",
          legacyMissing: "missingHardware",
        },
        outlets: {
          guid: "outletHardwareManager",
          mode: "outletHardwareManagerMode",
          missing: "missingOutletHardware",
          legacyGuid: "hardwareManager",
          legacyMissing: "missingHardware",
        },
      },
      entity,
    );
    var ropSlice = assignmentFilterSliceFromState(
      state,
      {
        clients: {
          guid: "clientRopEmployee",
          mode: "clientRopEmployeeMode",
          missing: "missingClientRop",
          legacyGuid: "ropEmployee",
          legacyMissing: "missingRop",
        },
        outlets: {
          guid: "outletRopEmployee",
          mode: "outletRopEmployeeMode",
          missing: "missingOutletRop",
          legacyGuid: "ropEmployee",
          legacyMissing: "missingRop",
        },
      },
      entity,
    );

    if (entity === "clients") {
      writeAssignmentFilterParams(params, { guid: "clientManager", mode: "clientManagerMode" }, managerSlice);
      writeAssignmentFilterParams(params, { guid: "clientRegionalManager", mode: "clientRegionalManagerMode" }, regionalSlice);
      writeAssignmentFilterParams(params, { guid: "clientHardwareManager", mode: "clientHardwareManagerMode" }, hardwareSlice);
      writeAssignmentFilterParams(params, { guid: "clientRopEmployee", mode: "clientRopEmployeeMode" }, ropSlice);
      writeAssignmentFilterParams(
        params,
        { guid: "outletManager", mode: "outletManagerMode" },
        assignmentFilterSliceFromState(
          state,
          {
            clients: {
              guid: "outletManager",
              mode: "outletManagerMode",
              missing: "missingOutletManager",
            },
            outlets: {
              guid: "outletManager",
              mode: "outletManagerMode",
              missing: "missingOutletManager",
            },
          },
          "clients",
        ),
      );
      writeAssignmentFilterParams(
        params,
        { guid: "outletRegionalManager", mode: "outletRegionalManagerMode" },
        assignmentFilterSliceFromState(
          state,
          {
            clients: {
              guid: "outletRegionalManager",
              mode: "outletRegionalManagerMode",
              missing: "missingOutletRegional",
            },
            outlets: {
              guid: "outletRegionalManager",
              mode: "outletRegionalManagerMode",
              missing: "missingOutletRegional",
            },
          },
          "clients",
        ),
      );
      writeAssignmentFilterParams(
        params,
        { guid: "outletHardwareManager", mode: "outletHardwareManagerMode" },
        assignmentFilterSliceFromState(
          state,
          {
            clients: {
              guid: "outletHardwareManager",
              mode: "outletHardwareManagerMode",
              missing: "missingOutletHardware",
            },
            outlets: {
              guid: "outletHardwareManager",
              mode: "outletHardwareManagerMode",
              missing: "missingOutletHardware",
            },
          },
          "clients",
        ),
      );
      writeAssignmentFilterParams(
        params,
        { guid: "outletRopEmployee", mode: "outletRopEmployeeMode" },
        assignmentFilterSliceFromState(
          state,
          {
            clients: {
              guid: "outletRopEmployee",
              mode: "outletRopEmployeeMode",
              missing: "missingOutletRop",
            },
            outlets: {
              guid: "outletRopEmployee",
              mode: "outletRopEmployeeMode",
              missing: "missingOutletRop",
            },
          },
          "clients",
        ),
      );
    } else {
      writeAssignmentFilterParams(params, { guid: "outletManager", mode: "outletManagerMode" }, managerSlice);
      writeAssignmentFilterParams(params, { guid: "outletRegionalManager", mode: "outletRegionalManagerMode" }, regionalSlice);
      writeAssignmentFilterParams(params, { guid: "outletHardwareManager", mode: "outletHardwareManagerMode" }, hardwareSlice);
      writeAssignmentFilterParams(params, { guid: "outletRopEmployee", mode: "outletRopEmployeeMode" }, ropSlice);
    }
  }

  function buildListQueryString(state) {
    var params = new URLSearchParams();
    if (state.view) params.set("view", state.view);
    if (state.entity && state.entity !== "clients") params.set("entity", state.entity);
    if (state.q) params.set("q", state.q);
    appendAssignmentParams(params, state);
    if (state.holding) params.set("holding", state.holding);
    if (state.phone && state.phone !== "all") params.set("phone", state.phone);
    if (state.rop) params.set("rop", state.rop);
    if (state.unassignedCategory) params.set("unassignedCategory", state.unassignedCategory);
    if (state.reviewState) params.set("reviewState", state.reviewState);
    if (state.reviewDecision) params.set("reviewDecision", state.reviewDecision);
    if (state.hasOutlets && state.hasOutlets !== "all") params.set("hasOutlets", state.hasOutlets);
    if (state.outletStatus && state.outletStatus !== "all") params.set("outletStatus", state.outletStatus);
    if (state.warehouse && state.warehouse !== "all") params.set("warehouse", state.warehouse);
    if (state.portfolio) params.set("portfolio", state.portfolio);
    if (state.responsibleKind) params.set("responsibleKind", state.responsibleKind);
    if (state.view === "completeness" && state.completenessReasons && state.completenessReasons.length > 0) {
      state.completenessReasons.forEach(function (reason) {
        params.append("completenessReason", reason);
      });
    }
    if (state.tandoorClub) params.set("tandoorClub", state.tandoorClub);
    if (state.routeDirection) params.set("routeDirection", state.routeDirection);
    if (state.storeAddressContains) params.set("storeAddressContains", state.storeAddressContains);
    if (state.storePhoneContains) params.set("storePhoneContains", state.storePhoneContains);
    if (state.accountantPhoneContains) params.set("accountantPhoneContains", state.accountantPhoneContains);
    if (state.accountantEmailContains) params.set("accountantEmailContains", state.accountantEmailContains);
    if (state.loadingTime) params.set("loadingTime", state.loadingTime);
    if (state.loadingSchedule && state.loadingSchedule !== "all") {
      params.set("loadingSchedule", state.loadingSchedule);
    }
    if (state.discountProgram) params.set("discountProgram", state.discountProgram);
    if (state.onecTop150) params.set("onecTop150", state.onecTop150);
    if (state.onecCategory) params.set("onecCategory", state.onecCategory);
    if (state.onecCounterpartyContains) params.set("onecCounterpartyContains", state.onecCounterpartyContains);
    if (state.onecFullNameContains) params.set("onecFullNameContains", state.onecFullNameContains);
    if (state.onecLegalEntityType) params.set("onecLegalEntityType", state.onecLegalEntityType);
    if (state.onecOgrn) params.set("onecOgrn", state.onecOgrn);
    if (state.discountAmountMin) params.set("discountAmountMin", state.discountAmountMin);
    if (state.discountAmountMax) params.set("discountAmountMax", state.discountAmountMax);
    if (state.markupName) params.set("markupName", state.markupName);
    if (state.markupPercentage) params.set("markupPercentage", state.markupPercentage);
    if (state.bonusTandoorClub) params.set("bonusTandoorClub", state.bonusTandoorClub);
    if (state.lprNameContains) params.set("lprNameContains", state.lprNameContains);
    if (state.lprPostContains) params.set("lprPostContains", state.lprPostContains);
    if (state.lprPhoneContains) params.set("lprPhoneContains", state.lprPhoneContains);
    if (state.lprEmailContains) params.set("lprEmailContains", state.lprEmailContains);
    if (state.lprBonusContains) params.set("lprBonusContains", state.lprBonusContains);
    if (state.lprConditionsBonusContains) {
      params.set("lprConditionsBonusContains", state.lprConditionsBonusContains);
    }
    if (state.lprDateOfBirth) params.set("lprDateOfBirth", state.lprDateOfBirth);
    if (state.lprDateOfBirthFrom) params.set("lprDateOfBirthFrom", state.lprDateOfBirthFrom);
    if (state.lprDateOfBirthTo) params.set("lprDateOfBirthTo", state.lprDateOfBirthTo);
    if (state.filled) params.set("filled", state.filled);
    if (state.empty) params.set("empty", state.empty);
    if (state.sortBy) params.set("sortBy", state.sortBy);
    if (state.sortDir && state.sortDir !== "asc") params.set("sortDir", state.sortDir);
    if (state.cols) params.set("cols", state.cols);
    if (state.page > 1) params.set("page", String(state.page));
    if (state.teamExpand && state.teamExpand.length > 0) {
      state.teamExpand.forEach(function (guid) {
        if (guid) {
          params.append("teamExpand", guid);
        }
      });
    }
    if (state.teamQ) params.set("teamQ", state.teamQ);
    if (state.teamKind) params.set("teamKind", state.teamKind);
    if (state.teamSource === "onec") params.set("teamSource", "onec");
    if (state.onecTeam) params.set("onecTeam", state.onecTeam);
    return params.toString();
  }

  function parseReturnQuery(search) {
    var params = new URLSearchParams(search || "");
    var value = params.get("return");
    if (typeof value !== "string" || value === "") {
      return "";
    }
    if (!value.startsWith("?")) {
      return "";
    }
    try {
      var probe = new URLSearchParams(value.slice(1));
      if (
        Array.from(probe.keys()).some(function (key) {
          return LIST_QUERY_KEYS.indexOf(key) === -1;
        })
      ) {
        return "";
      }
      return value;
    } catch (_err) {
      return "";
    }
  }

  function shouldAcceptListResponse(requestId, activeRequestId) {
    return requestId === activeRequestId;
  }

  function shouldAcceptDetailResponse(requestId, activeRequestId) {
    return requestId === activeRequestId;
  }

  function filterOptions(items, query) {
    var normalized = (query || "").trim().toLowerCase();
    if (!normalized) {
      return items.slice();
    }
    return items.filter(function (item) {
      var haystack = (item.name + " " + item.shortId).toLowerCase();
      return haystack.indexOf(normalized) !== -1;
    });
  }

  function optionLabel(item) {
    return item.name + " · " + item.shortId;
  }

  function createComboboxModel() {
    return {
      selectedId: "",
      searchText: "",
      activeIndex: -1,
      open: false,
    };
  }

  function comboboxLabelForId(selectedId, options, missingEntry) {
    if (!selectedId) {
      return "";
    }
    if (missingEntry && selectedId === missingEntry.id) {
      return missingEntry.label;
    }
    var match = options.find(function (item) {
      return item.id === selectedId;
    });
    return match ? optionLabel(match) : selectedId.slice(0, 8).toUpperCase();
  }

  function resolveComboboxSelection(selectedId, missingEntry) {
    if (!selectedId) {
      return { guid: "", missing: false };
    }
    if (missingEntry && selectedId === missingEntry.id) {
      return { guid: "", missing: true };
    }
    return { guid: selectedId, missing: false };
  }

  function comboboxSelectedIdFromState(guid, missing, missingId) {
    if (missing) {
      return missingId;
    }
    return guid || "";
  }

  function comboboxApplyFromUrl(model, selectedId, options, missingEntry) {
    model.selectedId = selectedId || "";
    model.searchText = comboboxLabelForId(model.selectedId, options, missingEntry);
    model.activeIndex = -1;
    model.open = false;
    return model;
  }

  function comboboxOnInput(model, value) {
    model.searchText = value;
    model.activeIndex = -1;
    model.open = true;
    return model;
  }

  function comboboxOnBlur(model, options, missingEntry) {
    model.searchText = comboboxLabelForId(model.selectedId, options, missingEntry);
    model.activeIndex = -1;
    model.open = false;
    return model;
  }

  function comboboxSelect(model, selectedId, options, missingEntry) {
    model.selectedId = selectedId || "";
    model.searchText = comboboxLabelForId(model.selectedId, options, missingEntry);
    model.activeIndex = -1;
    model.open = false;
    return model;
  }

  function comboboxListEntries(options, query, allLabel, missingEntry) {
    var entries = [{ id: "", label: allLabel }];
    if (missingEntry) {
      entries.push({ id: missingEntry.id, label: missingEntry.label });
    }
    filterOptions(options, query).forEach(function (item) {
      entries.push({ id: item.id, label: optionLabel(item) });
    });
    return entries;
  }

  function comboboxMoveActive(model, entryCount, delta) {
    if (entryCount <= 0) {
      model.activeIndex = -1;
      return model;
    }
    if (model.activeIndex < 0) {
      model.activeIndex = delta > 0 ? 0 : entryCount - 1;
      return model;
    }
    model.activeIndex = (model.activeIndex + delta + entryCount) % entryCount;
    return model;
  }

  var ASSIGNMENT_MODE_OPTIONS = [
    { value: "", label: "Все" },
    { value: "assigned", label: "Назначен" },
    { value: "unassigned", label: "Не назначен" },
    { value: "not_provided", label: "Не передан из 1С" },
  ];

  function parseGuidListParam(value) {
    if (!value) {
      return [];
    }
    return String(value)
      .split(",")
      .map(function (part) {
        return part.trim();
      })
      .filter(function (part) {
        return part.length > 0;
      });
  }

  function formatGuidListParam(guids) {
    if (!guids || !guids.length) {
      return "";
    }
    return guids.join(",");
  }

  function normalizeAssignmentPresenceMode(value) {
    if (!value) {
      return "";
    }
    if (value === "assigned" || value === "unassigned" || value === "not_provided") {
      return value;
    }
    return "";
  }

  function assignmentFilterSliceFromState(state, keys, entity) {
    var scope = entity === "outlets" ? keys.outlets : keys.clients;
    var mode = normalizeAssignmentPresenceMode(state[scope.mode] || "");
    var missing = Boolean(state[scope.missing] || state[scope.legacyMissing]);
    var guids = parseGuidListParam(state[scope.guid] || state[scope.legacyGuid] || "");
    if (mode) {
      return { guids: [], mode: mode };
    }
    if (missing) {
      return { guids: [], mode: "unassigned" };
    }
    return { guids: guids, mode: "" };
  }

  function applyAssignmentFilterSliceToState(state, keys, entity, slice) {
    var scope = entity === "outlets" ? keys.outlets : keys.clients;
    var guids = slice.mode ? [] : slice.guids || [];
    var mode = slice.mode || "";
    state[scope.guid] = formatGuidListParam(guids);
    state[scope.mode] = mode;
    state[scope.missing] = false;
    if (scope.legacyGuid) {
      state[scope.legacyGuid] = state[scope.guid];
    }
    if (scope.legacyMissing) {
      state[scope.legacyMissing] = false;
    }
    return state;
  }

  function writeAssignmentFilterParams(params, scope, slice) {
    var guids = slice.mode ? [] : slice.guids || [];
    var mode = slice.mode || "";
    if (guids.length > 0) {
      params.set(scope.guid, formatGuidListParam(guids));
    }
    if (mode) {
      params.set(scope.mode, mode);
    }
  }

  function createAssignmentFilterModel(multiSelect) {
    return {
      selectedGuids: [],
      mode: "",
      searchText: "",
      activeIndex: -1,
      open: false,
      multiSelect: Boolean(multiSelect),
    };
  }

  function populateAssignmentModeSelect(selectEl, ownerDocument) {
    if (!selectEl) {
      return;
    }
    selectEl.innerHTML = "";
    ASSIGNMENT_MODE_OPTIONS.forEach(function (opt) {
      var optionEl = (ownerDocument || selectEl.ownerDocument).createElement("option");
      optionEl.value = opt.value;
      optionEl.textContent = opt.label;
      selectEl.appendChild(optionEl);
    });
  }

  function assignmentFilterLabelsForGuids(guids, options) {
    return guids.map(function (guid) {
      return comboboxLabelForId(guid, options, null);
    });
  }

  function mountAssignmentFilter(config) {
    var model = config.model;
    var modeSelect = config.modeSelect;
    var input = config.input;
    var hidden = config.hidden;
    var tagsEl = config.tagsEl;
    var listEl = config.listEl;
    var options = config.options;
    var allLabel = config.allLabel;
    var missingEntry = config.missingEntry || null;
    var listboxId = config.listboxId;
    var onApply = config.onApply;
    var ownerDocument = config.root.ownerDocument || (typeof document !== "undefined" ? document : null);

    populateAssignmentModeSelect(modeSelect, ownerDocument);

    function syncHidden() {
      hidden.value = formatGuidListParam(model.selectedGuids);
    }

    function renderTags() {
      if (!tagsEl) {
        return;
      }
      tagsEl.innerHTML = "";
      if (model.mode || !model.selectedGuids.length) {
        tagsEl.classList.add("clients-hidden");
        return;
      }
      tagsEl.classList.remove("clients-hidden");
      model.selectedGuids.forEach(function (guid) {
        var chip = (ownerDocument || tagsEl.ownerDocument).createElement("span");
        chip.className = "clients-assignment-filter__tag";
        chip.dataset.guid = guid;
        var label = comboboxLabelForId(guid, options(), missingEntry);
        var labelEl = (ownerDocument || tagsEl.ownerDocument).createElement("span");
        labelEl.className = "clients-assignment-filter__tag-label";
        labelEl.textContent = label;
        chip.appendChild(labelEl);
        var removeBtn = (ownerDocument || tagsEl.ownerDocument).createElement("button");
        removeBtn.type = "button";
        removeBtn.className = "clients-assignment-filter__tag-remove";
        removeBtn.setAttribute("aria-label", "Убрать " + label);
        removeBtn.textContent = "×";
        removeBtn.addEventListener("click", function (event) {
          event.preventDefault();
          event.stopPropagation();
          model.selectedGuids = model.selectedGuids.filter(function (item) {
            return item !== guid;
          });
          syncDom();
          onApply();
        });
        chip.appendChild(removeBtn);
        tagsEl.appendChild(chip);
      });
    }

    function updateComboboxDisabled() {
      var disabled = Boolean(model.mode);
      input.disabled = disabled;
      input.classList.toggle("is-disabled", disabled);
      if (disabled) {
        model.open = false;
        listEl.classList.add("clients-hidden");
      }
    }

    function syncDom() {
      if (modeSelect) {
        modeSelect.value = model.mode || "";
      }
      if (model.mode) {
        input.value = "";
        model.searchText = "";
      } else if (model.multiSelect) {
        input.value = model.searchText;
      } else {
        input.value =
          model.searchText ||
          comboboxLabelForId(model.selectedGuids[0] || "", options(), missingEntry);
      }
      syncHidden();
      renderTags();
      updateComboboxDisabled();
      input.setAttribute("aria-expanded", model.open ? "true" : "false");
    }

    function renderList() {
      var entries = comboboxListEntries(options(), model.searchText, allLabel, missingEntry);
      if (model.multiSelect) {
        entries = entries.filter(function (entry) {
          return entry.id !== "";
        });
        entries.unshift({ id: "", label: allLabel });
      }
      listEl.innerHTML = "";
      entries.forEach(function (entry, index) {
        var li = (ownerDocument || listEl.ownerDocument).createElement("li");
        li.className = "clients-combobox__option";
        if (model.multiSelect && entry.id && model.selectedGuids.indexOf(entry.id) !== -1) {
          li.classList.add("is-selected");
        }
        li.setAttribute("role", "option");
        li.id = listboxId + "-opt-" + index;
        li.dataset.value = entry.id;
        var prefix =
          model.multiSelect && entry.id && model.selectedGuids.indexOf(entry.id) !== -1 ? "✓ " : "";
        li.textContent = prefix + entry.label;
        if (index === model.activeIndex) {
          li.classList.add("is-active");
          li.setAttribute("aria-selected", "true");
          input.setAttribute("aria-activedescendant", li.id);
        } else {
          li.setAttribute("aria-selected", "false");
        }
        listEl.appendChild(li);
      });
      listEl.classList.toggle("clients-hidden", !model.open);
      if (model.activeIndex < 0) {
        input.removeAttribute("aria-activedescendant");
      }
      return entries;
    }

    function openList() {
      if (model.mode) {
        return;
      }
      model.open = true;
      renderList();
      syncDom();
    }

    function closeList(restoreLabel) {
      if (restoreLabel) {
        if (model.multiSelect) {
          model.searchText = "";
        } else {
          comboboxOnBlur(
            {
              selectedId: model.selectedGuids[0] || "",
              searchText: model.searchText,
            },
            options(),
            missingEntry,
          );
          model.searchText = comboboxLabelForId(model.selectedGuids[0] || "", options(), missingEntry);
        }
      }
      model.open = false;
      model.activeIndex = -1;
      listEl.classList.add("clients-hidden");
      input.setAttribute("aria-expanded", "false");
      input.removeAttribute("aria-activedescendant");
      syncDom();
    }

    function clearSelection() {
      model.selectedGuids = [];
      model.mode = "";
      model.searchText = "";
    }

    function applyMode(mode) {
      model.mode = normalizeAssignmentPresenceMode(mode);
      if (model.mode) {
        model.selectedGuids = [];
        model.searchText = "";
      }
      syncDom();
      onApply();
    }

    function toggleGuid(guid) {
      if (!guid) {
        clearSelection();
        syncDom();
        onApply();
        return;
      }
      if (missingEntry && guid === missingEntry.id) {
        applyMode("unassigned");
        closeList(false);
        return;
      }
      model.mode = "";
      if (modeSelect) {
        modeSelect.value = "";
      }
      if (model.multiSelect) {
        if (model.selectedGuids.indexOf(guid) === -1) {
          model.selectedGuids = model.selectedGuids.concat([guid]);
        } else {
          model.selectedGuids = model.selectedGuids.filter(function (item) {
            return item !== guid;
          });
        }
        model.searchText = "";
        syncDom();
        renderList();
        onApply();
        return;
      }
      model.selectedGuids = [guid];
      model.searchText = comboboxLabelForId(guid, options(), missingEntry);
      syncDom();
      closeList(false);
      onApply();
    }

    modeSelect?.addEventListener("change", function () {
      applyMode(modeSelect.value || "");
      closeList(false);
    });

    input.addEventListener("focus", function () {
      openList();
    });

    input.addEventListener("input", function () {
      if (model.mode) {
        return;
      }
      model.searchText = input.value;
      model.activeIndex = -1;
      syncDom();
      openList();
    });

    input.addEventListener("keydown", function (event) {
      if (model.mode) {
        return;
      }
      var entries = comboboxListEntries(options(), model.searchText, allLabel, missingEntry);
      if (model.multiSelect) {
        entries = entries.filter(function (entry) {
          return entry.id !== "";
        });
        entries.unshift({ id: "", label: allLabel });
      }
      if (event.key === "ArrowDown") {
        event.preventDefault();
        model.open = true;
        comboboxMoveActive(model, entries.length, 1);
        renderList();
        return;
      }
      if (event.key === "ArrowUp") {
        event.preventDefault();
        model.open = true;
        comboboxMoveActive(model, entries.length, -1);
        renderList();
        return;
      }
      if (event.key === "Enter") {
        if (model.open && model.activeIndex >= 0 && entries[model.activeIndex]) {
          event.preventDefault();
          toggleGuid(entries[model.activeIndex].id);
        }
        return;
      }
      if (event.key === "Escape") {
        event.preventDefault();
        closeList(true);
        return;
      }
      if (event.key === "Tab") {
        closeList(true);
      }
    });

    listEl.addEventListener("mousedown", function (event) {
      var target = event.target;
      if (!target || typeof target.closest !== "function") {
        return;
      }
      var option = target.closest(".clients-combobox__option");
      if (!option) {
        return;
      }
      event.preventDefault();
      toggleGuid(option.dataset.value || "");
    });

    if (ownerDocument) {
      ownerDocument.addEventListener("click", function (event) {
        if (config.root.contains(event.target)) {
          return;
        }
        if (model.open) {
          closeList(true);
        }
      });
    }

    return {
      model: model,
      getState: function () {
        return {
          guids: model.selectedGuids.slice(),
          mode: model.mode || "",
        };
      },
      syncFromUrl: function (slice) {
        var activeElement =
          (input.ownerDocument && input.ownerDocument.activeElement) ||
          (typeof document !== "undefined" ? document.activeElement : null);
        var focused =
          model.open ||
          activeElement === input ||
          (modeSelect && activeElement === modeSelect);
        if (focused) {
          return;
        }
        model.mode = normalizeAssignmentPresenceMode(slice.mode || "");
        model.selectedGuids = model.mode ? [] : (slice.guids || []).slice();
        model.searchText = model.multiSelect
          ? ""
          : comboboxLabelForId(model.selectedGuids[0] || "", options(), missingEntry);
        model.activeIndex = -1;
        model.open = false;
        syncDom();
      },
      reset: function () {
        clearSelection();
        syncDom();
        closeList(false);
      },
      syncDom: syncDom,
      renderList: renderList,
    };
  }

  function formatLoadedInLkLabel(lastImportedAtLabel) {
    if (!lastImportedAtLabel || String(lastImportedAtLabel).trim() === "") {
      return "Сведения о загрузке отсутствуют";
    }
    return lastImportedAtLabel + " (МСК)";
  }

  var SOURCE_UPDATED_UNKNOWN = "Время обновления в 1С не передано";

  function resolveAddressPresentation(rawAddress) {
    if (rawAddress === null || rawAddress === undefined) {
      return { displayText: "Адрес не указан", copyValue: null, copyEnabled: false };
    }
    var raw = String(rawAddress);
    if (raw.trim().length === 0) {
      return { displayText: "Адрес не указан", copyValue: null, copyEnabled: false };
    }
    return { displayText: raw.trim(), copyValue: raw, copyEnabled: true };
  }

  function createAddressCopyController(deps) {
    return {
      bind: function () {
        var copyBtn = deps.getCopyButton();
        var statusEl = deps.getStatusElement();
        var copyValue = deps.getCopyValue();

        if (!copyBtn || !statusEl) {
          return;
        }

        if (!copyValue) {
          copyBtn.hidden = true;
          copyBtn.disabled = true;
          statusEl.textContent = "";
          statusEl.className = "workspace-status";
          return;
        }

        copyBtn.hidden = false;
        copyBtn.disabled = false;
        statusEl.textContent = "";
        statusEl.className = "workspace-status";

        copyBtn.onclick = function () {
          deps
            .copyText(copyValue)
            .then(function () {
              statusEl.textContent = "Адрес скопирован";
              statusEl.className = "workspace-status workspace-status--success";
            })
            .catch(function () {
              statusEl.textContent = "Не удалось скопировать адрес";
              statusEl.className = "workspace-status workspace-status--error";
            });
        };
      },
    };
  }

  var ONEc_UPDATE_STAGE_LABELS = {
    config: "Проверка конфигурации",
    file_read: "Чтение файлов",
    manifest_validation: "Проверка manifest",
    bundle_validation: "Проверка комплекта",
    apply: "Применение",
    employee_roster: "Справочник сотрудников",
    unknown: "Неизвестный этап",
  };

  var ONEc_UPDATE_PHASE_LABELS = {
    pending: "Ожидает запуска",
    running: "Выполняется",
    completed: "Завершено",
    no_changes: "Нет изменений",
    rejected: "Отклонено проверками",
    error: "Ошибка",
    uncertain: "Результат уточняется",
    idle: "Готово к запуску",
  };

  function formatOnecUpdatePhaseLabel(phase) {
    return ONEc_UPDATE_PHASE_LABELS[phase] || ONEc_UPDATE_PHASE_LABELS.idle;
  }

  function shouldPollOnecUpdateStatus(data) {
    if (!data || !data.job) {
      return false;
    }
    return data.job.phase === "pending" || data.job.phase === "running";
  }

  function formatOnecUpdateStatusText(data) {
    if (!data) {
      return {
        text: "Не удалось получить статус обновления из 1С.",
        statusClass: "clients-onec-update__status--error",
        disableButton: true,
      };
    }
    if (!data.job) {
      return {
        text: data.blockedReason || "Можно запустить обновление последнего готового комплекта из 1С.",
        statusClass: "",
        disableButton: !data.canStart,
      };
    }
    var job = data.job;
    var prefix = formatOnecUpdatePhaseLabel(job.phase) + ".";
    var text = prefix + " " + (job.message || "");
    var statusClass = "";
    if (job.phase === "pending" || job.phase === "running") {
      statusClass = "clients-onec-update__status--running";
    } else if (job.phase === "completed" || job.phase === "no_changes") {
      statusClass = "clients-onec-update__status--success";
    } else if (job.phase === "rejected") {
      statusClass = "clients-onec-update__status--warning";
    } else if (job.phase === "uncertain") {
      statusClass = "clients-onec-update__status--warning";
    } else if (job.phase === "error") {
      statusClass = "clients-onec-update__status--error";
    }
    return {
      text: text,
      statusClass: statusClass,
      disableButton:
        !data.canStart ||
        job.phase === "pending" ||
        job.phase === "running" ||
        job.phase === "uncertain",
    };
  }

  function formatOnecUpdateMetaLines(data) {
    if (!data || !data.job) {
      return [];
    }
    var lines = [];
    var job = data.job;
    lines.push({
      label: "Источник",
      value: job.jobSourceLabel || "—",
    });
    lines.push({
      label: "Дата исходной выгрузки",
      value: job.sourceExportAtLabel || "Не передана",
    });
    if (job.exportBatchId) {
      lines.push({
        label: "Пакет 1С",
        value: job.exportBatchId,
      });
    }
    lines.push({
      label: "Последнее успешное обновление",
      value: job.lastSuccessfulUpdateAtLabel || "Ещё не выполнялось",
    });
    if (job.failureStage) {
      lines.push({
        label: "Этап",
        value: ONEc_UPDATE_STAGE_LABELS[job.failureStage] || job.failureStage,
      });
    }
    if (job.diagnosticId) {
      lines.push({
        label: "Диагностика",
        value: job.diagnosticId,
      });
    }
    if (job.dataPreserved) {
      lines.push({
        label: "База данных",
        value: "Прежние данные сохранены",
      });
    }
    return lines;
  }

  function formatSyncStatusParts(data) {
    if (!data) {
      return {
        text: "Не удалось проверить статус загрузки.",
        warning: true,
        appendWarning: "",
      };
    }
    var parts = [];
    if (data.runningImport || data.freshnessState === "updating") {
      parts.push("Обновление данных выполняется…");
    } else if (data.freshnessState === "never") {
      parts.push("Данные клиентов в ЛК ещё не загружались.");
    } else if (data.freshnessState === "error") {
      parts.push("Последняя попытка обновления завершилась с ошибкой.");
    } else if (data.freshnessState === "pending_apply") {
      parts.push("Обнаружен новый файл, ожидается согласованное обновление.");
    } else if (data.freshnessState === "stale") {
      parts.push("Актуальность данных в ЛК может быть устаревшей.");
    } else if (data.lastSuccessfulImportAtLabel) {
      parts.push("Данные загружены в ЛК: " + data.lastSuccessfulImportAtLabel + " (МСК)");
      if (data.sourceFormationKnown && data.lastSourceModifiedAtLabel) {
        parts.push("Выгрузка 1С сформирована: " + data.lastSourceModifiedAtLabel + " (МСК)");
      } else if (data.sourceFormationKnown === false) {
        parts.push("Дата формирования выгрузки 1С неизвестна.");
      }
    } else {
      parts.push("Актуальность данных неизвестна.");
    }
    return {
      text: parts.join(" "),
      warning:
        !!data.warning ||
        data.freshnessState === "error" ||
        data.freshnessState === "stale" ||
        data.freshnessState === "pending_apply",
      appendWarning: data.warning ? " " + data.warning : "",
    };
  }

  function createDetailController(deps) {
    var pageGuid = null;
    var activeRequestId = 0;

    function parseGuidOrShowError() {
      pageGuid = deps.parseGuidFromPath();
      if (!pageGuid) {
        deps.showInvalidGuid();
        return false;
      }
      return true;
    }

    function loadClient() {
      if (!pageGuid) {
        return Promise.resolve();
      }
      activeRequestId += 1;
      var requestId = activeRequestId;
      deps.showLoading();
      return deps
        .fetchClient(pageGuid)
        .then(function (result) {
          if (!shouldAcceptDetailResponse(requestId, activeRequestId)) {
            return;
          }
          return deps.handleClientResult(result);
        })
        .catch(function (err) {
          if (!shouldAcceptDetailResponse(requestId, activeRequestId)) {
            return;
          }
          deps.showClientError(err, function onRetry() {
            loadClient().catch(function (retryErr) {
              deps.showClientError(retryErr, onRetry);
            });
          });
        });
    }

    function ensureAccessAndLoad() {
      return new Promise(function (resolve, reject) {
        deps
          .ensureAdminAccess(function (_user, reason) {
            if (reason) {
              deps.handleAccessReason(reason, function onRetry() {
                ensureAccessAndLoad().then(resolve, reject);
              });
              return;
            }
            loadClient().then(resolve, reject);
          })
          .catch(reject);
      });
    }

    function bootstrap() {
      if (!parseGuidOrShowError()) {
        return Promise.resolve();
      }
      return ensureAccessAndLoad().catch(function (err) {
        deps.showInitError(err, function onRetry() {
          ensureAccessAndLoad().catch(function (retryErr) {
            deps.showInitError(retryErr, onRetry);
          });
        });
      });
    }

    return {
      bootstrap: bootstrap,
      ensureAccessAndLoad: ensureAccessAndLoad,
      loadClient: loadClient,
      getPageGuid: function () {
        return pageGuid;
      },
    };
  }

  function mountCombobox(config) {
    var model = config.model;
    var input = config.input;
    var hidden = config.hidden;
    var listEl = config.listEl;
    var options = config.options;
    var allLabel = config.allLabel;
    var missingEntry = config.missingEntry || null;
    var listboxId = config.listboxId;
    var onApplySelection = config.onApplySelection;

    function syncDom() {
      input.value = model.searchText;
      hidden.value = model.selectedId;
      input.setAttribute("aria-expanded", model.open ? "true" : "false");
    }

    var ownerDocument = config.root.ownerDocument || (typeof document !== "undefined" ? document : null);

    function renderList() {
      var entries = comboboxListEntries(options(), model.searchText, allLabel, missingEntry);
      listEl.innerHTML = "";
      entries.forEach(function (entry, index) {
        var li = (ownerDocument || listEl.ownerDocument).createElement("li");
        li.className = "clients-combobox__option";
        li.setAttribute("role", "option");
        li.id = listboxId + "-opt-" + index;
        li.dataset.value = entry.id;
        li.textContent = entry.label;
        if (index === model.activeIndex) {
          li.classList.add("is-active");
          li.setAttribute("aria-selected", "true");
          input.setAttribute("aria-activedescendant", li.id);
        } else {
          li.setAttribute("aria-selected", "false");
        }
        listEl.appendChild(li);
      });
      listEl.classList.toggle("clients-hidden", !model.open);
      if (model.activeIndex < 0) {
        input.removeAttribute("aria-activedescendant");
      }
      return entries;
    }

    function openList() {
      model.open = true;
      renderList();
      syncDom();
    }

    function closeList(restoreLabel) {
      if (restoreLabel) {
        comboboxOnBlur(model, options(), missingEntry);
      }
      model.open = false;
      model.activeIndex = -1;
      listEl.classList.add("clients-hidden");
      input.setAttribute("aria-expanded", "false");
      input.removeAttribute("aria-activedescendant");
      syncDom();
    }

    function applySelection(selectedId) {
      comboboxSelect(model, selectedId, options(), missingEntry);
      syncDom();
      closeList(false);
      onApplySelection(model.selectedId);
    }

    input.addEventListener("focus", function () {
      openList();
    });

    input.addEventListener("input", function () {
      comboboxOnInput(model, input.value);
      syncDom();
      openList();
    });

    input.addEventListener("keydown", function (event) {
      var entries = comboboxListEntries(options(), model.searchText, allLabel, missingEntry);
      if (event.key === "ArrowDown") {
        event.preventDefault();
        model.open = true;
        comboboxMoveActive(model, entries.length, 1);
        renderList();
        return;
      }
      if (event.key === "ArrowUp") {
        event.preventDefault();
        model.open = true;
        comboboxMoveActive(model, entries.length, -1);
        renderList();
        return;
      }
      if (event.key === "Enter") {
        if (model.open && model.activeIndex >= 0 && entries[model.activeIndex]) {
          event.preventDefault();
          applySelection(entries[model.activeIndex].id);
        }
        return;
      }
      if (event.key === "Escape") {
        event.preventDefault();
        closeList(true);
        return;
      }
      if (event.key === "Tab") {
        closeList(true);
      }
    });

    listEl.addEventListener("mousedown", function (event) {
      var target = event.target;
      if (!target || typeof target.closest !== "function") {
        return;
      }
      var option = target.closest(".clients-combobox__option");
      if (!option) {
        return;
      }
      event.preventDefault();
      applySelection(option.dataset.value || "");
    });

    if (ownerDocument) {
      ownerDocument.addEventListener("click", function (event) {
        if (config.root.contains(event.target)) {
          return;
        }
        if (model.open) {
          closeList(true);
        }
      });
    }

    return {
      model: model,
      syncFromUrl: function (selectedId) {
        var activeElement =
          (input.ownerDocument && input.ownerDocument.activeElement) ||
          (typeof document !== "undefined" ? document.activeElement : null);
        if (model.open || activeElement === input) {
          model.selectedId = selectedId || "";
          hidden.value = model.selectedId;
          return;
        }
        comboboxApplyFromUrl(model, selectedId, options(), missingEntry);
        syncDom();
      },
      reset: function () {
        comboboxSelect(model, "", options(), missingEntry);
        syncDom();
        closeList(false);
      },
      syncDom: syncDom,
      renderList: renderList,
    };
  }

  return {
    NO_DATA_LABEL: NO_DATA_LABEL,
    MISSING_ROP_ID: MISSING_ROP_ID,
    MISSING_MANAGER_ID: MISSING_MANAGER_ID,
    MISSING_REGIONAL_ID: MISSING_REGIONAL_ID,
    MISSING_HARDWARE_ID: MISSING_HARDWARE_ID,
    LIST_QUERY_KEYS: LIST_QUERY_KEYS,
    columnDefinitions: columnDefinitions,
    defaultVisibleColumnIds: defaultVisibleColumnIds,
    parseColumnsParam: parseColumnsParam,
    buildColumnsStorageKey: buildColumnsStorageKey,
    readStoredColumnIds: readStoredColumnIds,
    persistStoredColumnIds: persistStoredColumnIds,
    resolveVisibleColumns: resolveVisibleColumns,
    toggleColumnSelection: toggleColumnSelection,
    nextSortState: nextSortState,
    sortIndicator: sortIndicator,
    defaultSortFieldForEntity: defaultSortFieldForEntity,
    mapSortFieldForEntity: mapSortFieldForEntity,
    normalizeStateForEntitySwitch: normalizeStateForEntitySwitch,
    sanitizeStateForEntity: sanitizeStateForEntity,
    readStateFromSearch: readStateFromSearch,
    normalizeTeamKind: normalizeTeamKind,
    applyPresentationDefaults: applyPresentationDefaults,
    buildListQueryString: buildListQueryString,
    isBranchPortfolioList: isBranchPortfolioList,
    hasResponsibleSelection: hasResponsibleSelection,
    formatLoadedInLkLabel: formatLoadedInLkLabel,
    SOURCE_UPDATED_UNKNOWN: SOURCE_UPDATED_UNKNOWN,
    resolveAddressPresentation: resolveAddressPresentation,
    createAddressCopyController: createAddressCopyController,
    formatSyncStatusParts: formatSyncStatusParts,
    formatOnecUpdatePhaseLabel: formatOnecUpdatePhaseLabel,
    shouldPollOnecUpdateStatus: shouldPollOnecUpdateStatus,
    formatOnecUpdateStatusText: formatOnecUpdateStatusText,
    formatOnecUpdateMetaLines: formatOnecUpdateMetaLines,
    parseReturnQuery: parseReturnQuery,
    shouldAcceptListResponse: shouldAcceptListResponse,
    shouldAcceptDetailResponse: shouldAcceptDetailResponse,
    filterOptions: filterOptions,
    optionLabel: optionLabel,
    createComboboxModel: createComboboxModel,
    comboboxApplyFromUrl: comboboxApplyFromUrl,
    comboboxOnInput: comboboxOnInput,
    comboboxOnBlur: comboboxOnBlur,
    comboboxSelect: comboboxSelect,
    comboboxListEntries: comboboxListEntries,
    resolveComboboxSelection: resolveComboboxSelection,
    comboboxSelectedIdFromState: comboboxSelectedIdFromState,
    comboboxMoveActive: comboboxMoveActive,
    ASSIGNMENT_MODE_OPTIONS: ASSIGNMENT_MODE_OPTIONS,
    parseGuidListParam: parseGuidListParam,
    formatGuidListParam: formatGuidListParam,
    normalizeAssignmentPresenceMode: normalizeAssignmentPresenceMode,
    assignmentFilterSliceFromState: assignmentFilterSliceFromState,
    applyAssignmentFilterSliceToState: applyAssignmentFilterSliceToState,
    createAssignmentFilterModel: createAssignmentFilterModel,
    populateAssignmentModeSelect: populateAssignmentModeSelect,
    mountAssignmentFilter: mountAssignmentFilter,
    createDetailController: createDetailController,
    mountCombobox: mountCombobox,
    FIELD_FILTER_EMPTY_OPTIONS: FIELD_FILTER_EMPTY_OPTIONS,
    FIELD_FILTER_FILLED_OPTIONS: FIELD_FILTER_FILLED_OPTIONS,
  };
});
