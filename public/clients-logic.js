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

  var LIST_QUERY_KEYS = [
    "view",
    "entity",
    "q",
    "manager",
    "holding",
    "phone",
    "rop",
    "ropEmployee",
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
    "hardwareManager",
    "tandoorClub",
    "portfolio",
    "responsibleKind",
    "completenessReason",
    "missingRop",
    "missingManager",
    "missingRegional",
    "page",
  ];

  var CLIENT_COLUMNS = [
    { id: "name", label: "Клиент", entity: "clients", defaultVisible: true, locked: true, sortable: true, hasSource: true },
    { id: "code1c", label: "Код 1С", entity: "clients", defaultVisible: false, sortable: false, hasSource: false },
    { id: "inn", label: "ИНН", entity: "clients", defaultVisible: false, sortable: false, hasSource: false },
    { id: "category", label: "Категория", entity: "clients", defaultVisible: false, sortable: false, hasSource: false },
    { id: "holding", label: "Холдинг", entity: "clients", defaultVisible: true, sortable: true, hasSource: true },
    { id: "address", label: "Адрес", entity: "clients", defaultVisible: true, sortable: true, hasSource: true },
    { id: "city", label: "Город", entity: "clients", defaultVisible: false, sortable: false, hasSource: false },
    { id: "manager", label: "Менеджер", entity: "clients", defaultVisible: true, sortable: true, hasSource: true },
    { id: "regional", label: "Региональный", entity: "clients", defaultVisible: false, sortable: false, hasSource: false },
    { id: "team", label: "РОП / команда", entity: "clients", defaultVisible: false, sortable: true, viewModes: ["teams", "review"], hasSource: true },
    { id: "outletsCount", label: "Кол-во ТТ", entity: "clients", defaultVisible: false, sortable: true, hasSource: true },
    { id: "assignmentState", label: "Состояние назначения", entity: "clients", defaultVisible: false, sortable: false, viewModes: ["teams", "review"], hasSource: true },
    { id: "review", label: "Ревизия", entity: "clients", defaultVisible: false, sortable: false, viewModes: ["review"], hasSource: true },
    { id: "phone", label: "Телефон", entity: "clients", defaultVisible: true, sortable: false, hasSource: true },
    { id: "warehouse", label: "Склад", entity: "clients", defaultVisible: false, sortable: false, hasSource: false },
    { id: "tandoorClub", label: "Tandoor Club", entity: "clients", defaultVisible: false, sortable: false, hasSource: false },
    { id: "cashback", label: "Cashback", entity: "clients", defaultVisible: false, sortable: false, hasSource: false },
    { id: "nextStep", label: "Следующий шаг", entity: "clients", defaultVisible: false, sortable: false, hasSource: false },
  ];

  var OUTLET_COLUMNS = [
    { id: "clientName", label: "Клиент", entity: "outlets", defaultVisible: true, locked: true, sortable: true, hasSource: true },
    { id: "outlet", label: "Торговая точка", entity: "outlets", defaultVisible: true, sortable: true, hasSource: true },
    { id: "guidStore", label: "ID ТТ", entity: "outlets", defaultVisible: false, sortable: true, hasSource: true },
    { id: "address", label: "Адрес", entity: "outlets", defaultVisible: true, sortable: true, hasSource: true },
    { id: "status", label: "Статус ТТ", entity: "outlets", defaultVisible: true, sortable: true, hasSource: true },
    { id: "manager", label: "Менеджер", entity: "outlets", defaultVisible: true, sortable: true, hasSource: true },
    { id: "holding", label: "Холдинг", entity: "outlets", defaultVisible: false, sortable: true, hasSource: true },
    { id: "regional", label: "Региональный", entity: "outlets", defaultVisible: false, sortable: true, hasSource: true },
    { id: "warehouse", label: "Склад", entity: "outlets", defaultVisible: false, sortable: true, hasSource: true },
    { id: "tandoorClub", label: "Tandoor Club", entity: "outlets", defaultVisible: false, sortable: true, hasSource: true },
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
    if (next.entity === "clients") {
      next.outletStatus = "all";
      next.warehouse = "all";
      next.regionalManager = "";
      next.tandoorClub = "";
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
    return {
      view: view,
      entity: entity,
      q: params.get("q") || "",
      manager: params.get("manager") || "",
      holding: params.get("holding") || "",
      phone: params.get("phone") || "all",
      rop: params.get("rop") || "",
      ropEmployee: params.get("ropEmployee") || "",
      unassignedCategory: params.get("unassignedCategory") || "",
      reviewState: params.get("reviewState") || "",
      reviewDecision: params.get("reviewDecision") || "",
      hasOutlets: params.get("hasOutlets") || "all",
      outletStatus: params.get("outletStatus") || "all",
      warehouse: params.get("warehouse") || "all",
      regionalManager: params.get("regionalManager") || "",
      hardwareManager: params.get("hardwareManager") || "",
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
      missingRop: params.get("missingRop") === "1",
      missingManager: params.get("missingManager") === "1",
      missingRegional: params.get("missingRegional") === "1",
      sortBy: params.get("sortBy") || "",
      sortDir: params.get("sortDir") || "",
      cols: params.get("cols") || "",
      page: Math.max(1, Number(params.get("page") || "1") || 1),
    };
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

  function buildListQueryString(state) {
    var params = new URLSearchParams();
    if (state.view) params.set("view", state.view);
    if (state.entity && state.entity !== "clients") params.set("entity", state.entity);
    if (state.q) params.set("q", state.q);
    if (state.manager) params.set("manager", state.manager);
    if (state.holding) params.set("holding", state.holding);
    if (state.phone && state.phone !== "all") params.set("phone", state.phone);
    if (state.rop) params.set("rop", state.rop);
    if (state.ropEmployee) params.set("ropEmployee", state.ropEmployee);
    if (state.unassignedCategory) params.set("unassignedCategory", state.unassignedCategory);
    if (state.reviewState) params.set("reviewState", state.reviewState);
    if (state.reviewDecision) params.set("reviewDecision", state.reviewDecision);
    if (state.hasOutlets && state.hasOutlets !== "all") params.set("hasOutlets", state.hasOutlets);
    if (state.outletStatus && state.outletStatus !== "all") params.set("outletStatus", state.outletStatus);
    if (state.warehouse && state.warehouse !== "all") params.set("warehouse", state.warehouse);
    if (state.regionalManager) params.set("regionalManager", state.regionalManager);
    if (state.hardwareManager) params.set("hardwareManager", state.hardwareManager);
    if (state.portfolio) params.set("portfolio", state.portfolio);
    if (state.responsibleKind) params.set("responsibleKind", state.responsibleKind);
    if (state.view === "completeness" && state.completenessReasons && state.completenessReasons.length > 0) {
      state.completenessReasons.forEach(function (reason) {
        params.append("completenessReason", reason);
      });
    }
    if (state.missingRop) params.set("missingRop", "1");
    if (state.missingManager) params.set("missingManager", "1");
    if (state.missingRegional) params.set("missingRegional", "1");
    if (state.tandoorClub) params.set("tandoorClub", state.tandoorClub);
    if (state.sortBy) params.set("sortBy", state.sortBy);
    if (state.sortDir && state.sortDir !== "asc") params.set("sortDir", state.sortDir);
    if (state.cols) params.set("cols", state.cols);
    if (state.page > 1) params.set("page", String(state.page));
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
    readStateFromSearch: readStateFromSearch,
    applyPresentationDefaults: applyPresentationDefaults,
    buildListQueryString: buildListQueryString,
    isBranchPortfolioList: isBranchPortfolioList,
    hasResponsibleSelection: hasResponsibleSelection,
    formatLoadedInLkLabel: formatLoadedInLkLabel,
    SOURCE_UPDATED_UNKNOWN: SOURCE_UPDATED_UNKNOWN,
    resolveAddressPresentation: resolveAddressPresentation,
    createAddressCopyController: createAddressCopyController,
    formatSyncStatusParts: formatSyncStatusParts,
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
    createDetailController: createDetailController,
    mountCombobox: mountCombobox,
  };
});
