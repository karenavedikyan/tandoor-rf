(function () {
  "use strict";

  var api = window.TandoorRf;
  var shell = window.ClientsShell;
  var logic = window.ClientsLogic;
  var sections = window.ClientDetailSections;

  var accessPanel = document.getElementById("access-panel");
  var initPanel = document.getElementById("init-panel");
  var statePanel = document.getElementById("state-panel");
  var detailEl = document.getElementById("client-detail");
  var detailRoot = document.getElementById("client-detail-root");

  function parseReturnQuery() {
    return logic.parseReturnQuery(window.location.search);
  }

  function v3EntityFromQuery() {
    return new URLSearchParams(window.location.search).get("v3Entity");
  }

  function currentDetailReturnParam() {
    return encodeURIComponent(window.location.pathname + window.location.search);
  }

  function resolveV3BackHref() {
    var raw = new URLSearchParams(window.location.search).get("return");
    if (typeof raw === "string" && raw !== "") {
      // URLSearchParams already decoded the outer return value; do not decodeURIComponent
      // the whole string or nested query inside return= will break (e.g. &v3manager=).
      if (raw.startsWith("/clients") || raw.startsWith("/sales")) {
        return raw;
      }
      try {
        var decoded = decodeURIComponent(raw);
        if (decoded.startsWith("/clients") || decoded.startsWith("/sales")) {
          return decoded;
        }
      } catch (_err) {
        /* ignore */
      }
    }
    var returnQuery = parseReturnQuery();
    return returnQuery ? "/clients" + returnQuery : "/clients?v3mode=1";
  }

  function v3DetailTitle(payload) {
    var ent = payload.entity || {};
    if (payload.entityType === "legal") {
      return ent.name_client || ent.name || "Юрлицо";
    }
    if (payload.entityType === "holding") {
      return ent.name || "Холдинг";
    }
    var addr = ent.address && typeof ent.address === "object" ? ent.address : {};
    return addr.store_address || addr.storeAddress || ent.name || "Торговая точка";
  }

  function v3CompositionUrl(holdingGuid) {
    var search = window.location.search;
    var selection = new URLSearchParams();
    for (var depth = 0; depth < 12; depth += 1) {
      var params = new URLSearchParams(search);
      var responsible = params.get("responsibleGuid") || params.get("v3manager");
      var rop = params.get("ropEmployee") || params.get("ropBranchGuid");
      if (responsible || rop) {
        var kind = params.get("responsibleKind") || params.get("teamKind") || "manager";
        if (["manager", "regional", "hardware"].indexOf(kind) < 0) {
          throw new Error("Invalid selected territory");
        }
        if (responsible) {
          selection.set("responsibleGuid", responsible);
          selection.set("responsibleKind", kind);
        }
        if (rop) selection.set("ropBranchGuid", rop);
        break;
      }
      var parent = params.get("return");
      if (!parent) break;
      if (parent.charAt(0) === "?") {
        search = parent;
      } else if (/^\/clients(?:\/|\?|$)/.test(parent)) {
        search = new URL(parent, window.location.origin).search;
      } else if (parent.indexOf("=") >= 0 && parent.charAt(0) !== "/") {
        search = "?" + parent;
      } else {
        throw new Error("Invalid territory return");
      }
      if (depth === 11) throw new Error("Territory return is too deep");
    }
    return "/api/clients/v3/holdings/" + encodeURIComponent(holdingGuid) +
      "/composition" + (selection.toString() ? "?" + selection.toString() : "");
  }

  function compositionRowsFromPayload(data) {
    if (!data || data.access === "unknown" || data.access === "withheld") {
      return null;
    }
    return {
      legal: data.legalEntities || data.legal_entities || [],
      retail: data.retailOutlets || data.retail_outlets || [],
    };
  }

  function requestV3LegalDetail(guid) {
    return api.apiRequest(
      "/api/clients/v3/detail?entity=legal&guid=" + encodeURIComponent(guid),
    );
  }

  function bindCompositionLegalLazy(host) {
    if (host && window.ClientDetailV3 && window.ClientDetailV3.bindLegalLazyExpansions) {
      window.ClientDetailV3.bindLegalLazyExpansions(host, requestV3LegalDetail, shell);
    }
  }

  function renderV3CompositionLists(host, legal, retail) {
    if (!host) {
      return;
    }
    var parentReturn = currentDetailReturnParam();
    var legalInner = legal.length
      ? legal
          .map(function (row) {
            if (window.ClientDetailV3 && window.ClientDetailV3.renderLegalLazyExpandItem) {
              return window.ClientDetailV3.renderLegalLazyExpandItem(shell, row, parentReturn);
            }
            return (
              "<details><summary>" +
              shell.escapeHtml(row.name) +
              "</summary></details>"
            );
          })
          .join("")
      : '<p class="pc-unavailable">Юрлица не переданы из 1С.</p>';
    var retailInner = retail.length
      ? "<ul class=\"v3-composition-list\">" +
        retail
          .map(function (row) {
            return (
              "<li><a class=\"clients-link\" href=\"/clients/" +
              encodeURIComponent(row.guid) +
              "?v3Entity=retail&return=" +
              parentReturn +
              '">' +
              shell.escapeHtml(row.name) +
              "</a></li>"
            );
          })
          .join("") +
        "</ul>"
      : '<p class="pc-unavailable">Торговые точки не переданы из 1С.</p>';
    host.innerHTML =
      '<details class="x6-group v3-inline-disclosure" open><summary>Юрлица (' +
      legal.length +
      ")</summary><div class=\"v3-inline-disclosure__body\">" +
      legalInner +
      '</div></details><details class="x6-group v3-inline-disclosure" open><summary>Торговые точки (' +
      retail.length +
      ")</summary><div class=\"v3-inline-disclosure__body\">" +
      retailInner +
      "</div></details>";
    bindCompositionLegalLazy(host);
  }

  function applyV3CompositionContext(detailRoot, payload, rows) {
    if (!detailRoot || !rows || !window.ClientDetailV3 || !window.ClientDetailV3.updateRelatedContext) {
      return;
    }
    window.ClientDetailV3.updateRelatedContext(detailRoot, shell, {
      entityType: payload.entityType,
      counts: {
        retailOutlets: rows.retail.length,
        legalEntities: payload.entityType === "legal" ? 1 : rows.legal.length,
      },
      retailOutlets: rows.retail,
      legalEntities: rows.legal,
      parentReturn: currentDetailReturnParam(),
    });
  }

  function loadV3Composition(detailRoot, payload, options) {
    options = options || {};
    var holdingGuid =
      payload.entityType === "holding"
        ? payload.entity && payload.entity.guid
        : payload.holdingLink && payload.holdingLink.guid;
    if (!holdingGuid) {
      return;
    }
    var compositionHost = options.compositionHost || null;
    if (compositionHost) {
      compositionHost.innerHTML = "Загрузка состава…";
    }
    var compositionUrl;
    try {
      compositionUrl = v3CompositionUrl(holdingGuid);
    } catch (_err) {
      if (compositionHost) {
        compositionHost.textContent = "Некорректная выбранная территория.";
      }
      if (options.onTerritoryError) {
        options.onTerritoryError("Некорректная выбранная территория.");
      }
      return;
    }
    api
      .apiRequest(compositionUrl)
      .then(function (result) {
        if (detailRoot && !detailRoot.isConnected) {
          return;
        }
        if (compositionHost && !compositionHost.isConnected) {
          return;
        }
        if (!result.response.ok || !result.data) {
          if (compositionHost) {
            compositionHost.innerHTML =
              '<p class="clients-error">Не удалось загрузить состав.</p>' +
              '<button type="button" class="workspace-button workspace-button--secondary" id="v3-composition-retry">Повторить</button>';
            document.getElementById("v3-composition-retry")?.addEventListener("click", function () {
              loadV3Composition(detailRoot, payload, options);
            });
          }
          if (options.onLoadError) {
            options.onLoadError("Не удалось загрузить торговые точки холдинга.");
          }
          return;
        }
        var rows = compositionRowsFromPayload(result.data);
        if (!rows) {
          if (options.onLoadError) {
            options.onLoadError("Состав холдинга недоступен в вашей области.");
          }
          return;
        }
        if (compositionHost) {
          renderV3CompositionLists(compositionHost, rows.legal, rows.retail);
        }
        applyV3CompositionContext(detailRoot, payload, rows);
      })
      .catch(function () {
        if (compositionHost && compositionHost.isConnected) {
          compositionHost.innerHTML = '<p class="clients-error">Ошибка сети при загрузке состава.</p>';
        }
        if (options.onLoadError) {
          options.onLoadError("Ошибка сети при загрузке ТТ.");
        }
      });
  }

  function renderV3Composition(host, payload) {
    if (!host || !payload.entity || !payload.entity.guid) {
      return;
    }
    loadV3Composition(document.getElementById("client-detail-root"), payload, { compositionHost: host });
  }

  function buildV3SessionContext(user) {
    if (!user) {
      return {
        displayName: "—",
        roleLabel: "—",
        scopeLabel: "Область видимости по текущей сессии",
      };
    }
    var displayName = user.fullName || user.email || "Пользователь";
    var roleKey = user.role || "user";
    var roleNames = {
      admin: "Администратор",
      manager: "Менеджер",
      marketer: "Маркетолог",
      coordinator: "Координатор",
    };
    var roleLabel = roleNames[roleKey] || String(roleKey);
    var scopeByRole = {
      admin: "Вся база и административные действия",
      manager: "Клиенты и точки по вашим назначениям 1С",
      marketer: "Маркетинговый просмотр",
      coordinator: "Команда и назначения по доступу",
    };
    var scopeLabel = scopeByRole[roleKey] || "Область видимости по текущей сессии";
    if (user.preview && user.preview.active && user.preview.targetUser) {
      displayName = user.preview.targetUser.fullName || displayName;
      roleLabel = "Предпросмотр · " + (user.preview.targetUser.role || roleLabel);
      scopeLabel = "Режим предпросмотра сотрудника";
    }
    return { displayName: displayName, roleLabel: roleLabel, scopeLabel: scopeLabel };
  }

  var v3SalesState = { legalGuid: null, months: [], month: null, loading: false };

  function loadV3LegalSales(detailRoot, legalGuid, month) {
    if (!detailRoot || !legalGuid || !window.ClientDetailV3) {
      return;
    }
    if (!month && window.ClientSalesSummaryUi && window.ClientSalesSummaryUi.monthFromUrl) {
      month = window.ClientSalesSummaryUi.monthFromUrl();
    }
    var host = detailRoot.querySelector('[data-testid="v3-sales-host"]');
    if (!host) {
      return;
    }
    v3SalesState.loading = true;
    host.innerHTML = '<p class="pc-unavailable">Загрузка продаж…</p>';
    Promise.all([
      v3SalesState.months.length
        ? Promise.resolve({ response: { status: 200 }, data: { months: v3SalesState.months } })
        : api.apiRequest("/api/clients/v3/legal/" + encodeURIComponent(legalGuid) + "/sales/months"),
      month
        ? api.apiRequest(
            "/api/clients/v3/legal/" + encodeURIComponent(legalGuid) + "/sales?month=" + encodeURIComponent(month),
          )
        : Promise.resolve(null),
    ])
      .then(function (results) {
        var monthsResult = results[0];
        if (monthsResult.response.status !== 200) {
          host.innerHTML = window.ClientDetailV3.renderSalesContent(shell, {
            sales: { lines: [] },
            salesState: monthsResult.response.status === 403 ? "forbidden" : "error",
          });
          return;
        }
        v3SalesState.months = monthsResult.data.months || [];
        var selectedMonth = month || v3SalesState.months[0] || null;
        if (!selectedMonth) {
          var importInfo = monthsResult.data.salesImport || {};
          host.innerHTML = window.ClientDetailV3.renderSalesContent(shell, {
            sales: { lines: [] },
            salesState: importInfo.applied ? "empty_month" : "not_imported",
          });
          return;
        }
        if (!month || month !== selectedMonth) {
          return loadV3LegalSales(detailRoot, legalGuid, selectedMonth);
        }
        var salesResult = results[1];
        if (!salesResult || salesResult.response.status !== 200) {
          host.innerHTML = window.ClientDetailV3.renderSalesContent(shell, {
            sales: { lines: [] },
            salesState: salesResult && salesResult.response.status === 403 ? "forbidden" : "error",
          });
          return;
        }
        v3SalesState.month = selectedMonth;
        host.innerHTML = window.ClientDetailV3.renderSalesContent(shell, {
          sales: salesResult.data.sales,
          months: v3SalesState.months,
        });
        var selectEl = host.querySelector('[data-testid="v3-sales-month-select"]');
        if (selectEl) {
          selectEl.addEventListener("change", function () {
            if (window.ClientSalesSummaryUi && window.ClientSalesSummaryUi.setMonthInUrl) {
              window.ClientSalesSummaryUi.setMonthInUrl(selectEl.value);
            }
            loadV3LegalSales(detailRoot, legalGuid, selectEl.value);
          });
        }
      })
      .finally(function () {
        v3SalesState.loading = false;
      });
  }

  function renderV3Detail(payload) {
    hideAllPanels();
    detailEl.classList.remove("clients-hidden");
    var backHref = resolveV3BackHref();
    var ent = payload.entity || {};
    var title = v3DetailTitle(payload);
    v3SalesState = { legalGuid: null, months: [], month: null, loading: false };
    var cardHtml = window.ClientDetailV3
      ? window.ClientDetailV3.renderCard(shell, payload.entityType, ent, payload.holdingLink, {
          session: buildV3SessionContext(currentUser),
        })
      : "";
    detailRoot.innerHTML = renderV3CardChrome(backHref, buildV3SessionContext(currentUser)) + cardHtml;
    detailRoot.ClientDetailV3LazyRequest = requestV3LegalDetail;
    if (window.ClientDetailV3 && window.ClientDetailV3.bindTabs) {
      var legalGuid = payload.entityType === "legal" ? ent.guid || ent.guid_client : null;
      if (legalGuid) {
        v3SalesState.legalGuid = legalGuid;
      }
      window.ClientDetailV3.bindTabs(detailRoot, {
        title: title,
        entityType: payload.entityType,
        entityLabel:
          payload.entityType === "holding"
            ? "Холдинг"
            : payload.entityType === "legal"
              ? "Юрлицо"
              : "Торговая точка",
        onSalesTabSelected: function () {
          if (legalGuid) {
            var monthFromOverview =
              window.ClientSalesSummaryUi && window.ClientSalesSummaryUi.monthFromUrl
                ? window.ClientSalesSummaryUi.monthFromUrl()
                : "";
            loadV3LegalSales(detailRoot, legalGuid, monthFromOverview || v3SalesState.month);
          }
        },
      });
    }
    if (payload.entityType === "holding" && ent.guid) {
      loadV3Composition(detailRoot, payload, {
        compositionHost: document.getElementById("v3-composition"),
      });
    } else {
      loadV3HoldingRelated(detailRoot, payload);
    }
    var salesHost = document.getElementById("v3-client-sales-overview-host");
    if (
      salesHost &&
      window.ClientSalesSummaryUi &&
      (payload.entityType === "holding" || payload.entityType === "legal")
    ) {
      var cardGuid = ent.guid || ent.guid_client;
      if (cardGuid) {
        var listReturn = new URLSearchParams(window.location.search).get("return") || "";
        var salesTerritoryQuery = "";
        try {
          salesTerritoryQuery = window.ClientSalesSummaryUi.territoryQueryFromListReturn(listReturn);
        } catch (_territoryErr) {
          salesTerritoryQuery = "";
        }
        window.ClientSalesSummaryUi.mountOverview(salesHost, {
          api: api,
          shell: shell,
          entityType: payload.entityType,
          guid: cardGuid,
          returnQuery: listReturn,
          territoryQuery: salesTerritoryQuery,
          onMonthChange: function () {
            var back = detailRoot.querySelector('[data-testid="v3-back-to-list"]');
            if (back) {
              back.setAttribute("href", resolveV3BackHref());
            }
          },
          onOpenSalesTab: function () {
            if (payload.entityType !== "legal") {
              return;
            }
            var salesTab = detailRoot.querySelector('[data-card-tab="sales"]');
            if (salesTab) {
              salesTab.click();
            }
          },
        });
      }
    }
  }

  function renderV3CardChrome(backHref, session) {
    session = session || {};
    var parts = ["Мои клиенты"];
    var returnRaw = new URLSearchParams(window.location.search).get("return");
    if (returnRaw) {
      try {
        var returnSearch = returnRaw.charAt(0) === "?" ? returnRaw : "?" + decodeURIComponent(returnRaw);
        var state = logic.readStateFromSearch(returnSearch);
        if (state.view === "teams") {
          parts = ["Мои РОПы", "Команда", "Клиентская база"];
        } else if (state.responsibleGuid || state.v3manager) {
          parts = ["Мои клиенты", "Территория сотрудника"];
        }
      } catch (_err) {
        /* keep default chain */
      }
    }
    parts.push("Карточка");
    var nav =
      '<nav aria-label="Путь к карточке">' +
      parts
        .map(function (part, index) {
          var current = index === parts.length - 1;
          return (
            "<span" +
            (current ? ' aria-current="page"' : "") +
            ">" +
            shell.escapeHtml(part) +
            "</span>"
          );
        })
        .join('<i aria-hidden="true">/</i>') +
      "</nav>";
    var viewing = session.roleLabel ? shell.escapeHtml(session.roleLabel) : "";
    if (session.scopeLabel && session.scopeLabel.indexOf("Предпросмотр") >= 0) {
      viewing = shell.escapeHtml(session.scopeLabel);
    }
    return (
      '<div class="x13-context-nav v3-card-context" data-testid="v3-territory-nav">' +
      '<a class="client-detail-back x13-back clients-link" href="' +
      shell.escapeHtml(backHref) +
      '" data-testid="v3-back-to-list">← Назад</a>' +
      nav +
      (viewing ? '<span class="x13-viewing">' + viewing + "</span>" : "") +
      "</div>"
    );
  }

  function loadV3HoldingRelated(detailRoot, payload) {
    if (!detailRoot || !window.ClientDetailV3 || !window.ClientDetailV3.updateRelatedContext) {
      return;
    }
    if (!payload.holdingLink || !payload.holdingLink.guid) {
      var emptyHost = detailRoot.querySelector('[data-testid="v3-data-holding-outlets"]');
      if (emptyHost) emptyHost.textContent = "Связь с холдингом не передана из 1С.";
      return;
    }
    function showRelatedError(message) {
      if (!detailRoot.isConnected) return;
      detailRoot.querySelectorAll(
        '[data-testid="v3-related-outlets"], [data-testid="v3-data-holding-outlets"], [data-testid="v3-data-holding-legals"]',
      ).forEach(function (host) { host.textContent = message; });
    }
    loadV3Composition(detailRoot, payload, {
      onTerritoryError: showRelatedError,
      onLoadError: showRelatedError,
    });
  }

  function clientGuidFromPath() {
    var parts = window.location.pathname.split("/").filter(Boolean);
    if (parts.length !== 2 || parts[0] !== "clients") {
      return null;
    }
    try {
      return decodeURIComponent(parts[1] || "");
    } catch (_err) {
      return null;
    }
  }

  function hideAllPanels() {
    detailEl.classList.add("clients-hidden");
    statePanel.classList.add("clients-hidden");
    accessPanel.classList.add("clients-hidden");
    if (initPanel) {
      initPanel.classList.add("clients-hidden");
    }
  }

  function bindRetryButton(buttonId, onRetry) {
    var button = document.getElementById(buttonId);
    if (!button) {
      return;
    }
    button.addEventListener("click", function () {
      button.disabled = true;
      Promise.resolve()
        .then(onRetry)
        .catch(function () {
          /* errors handled by onRetry callbacks */
        })
        .finally(function () {
          button.disabled = false;
        });
    });
  }

  function showInitError(title, text, onRetry) {
    hideAllPanels();
    if (!initPanel) {
      showState(title, text, onRetry);
      return;
    }
    initPanel.classList.remove("clients-hidden");
    shell.setPanelMessage(
      initPanel,
      "error",
      title,
      text,
      '<button type="button" class="workspace-button workspace-button--primary" id="retry-init">Повторить</button>',
    );
    bindRetryButton("retry-init", onRetry);
  }

  function handleAccessReason(reason, onRetry) {
    hideAllPanels();
    if (reason === "forbidden") {
      accessPanel.classList.remove("clients-hidden");
      shell.setPanelMessage(
        accessPanel,
        "forbidden",
        "Нет доступа",
        "У вашей роли нет доступа к разделу «Клиенты».",
        '<a class="workspace-button workspace-button--secondary" href="/profile">В профиль</a>',
      );
      return;
    }
    if (reason === "service") {
      showInitError("Сервис временно недоступен", "Не удалось проверить доступ. Повторите попытку.", onRetry);
      return;
    }
    showInitError("Ошибка сети", "Не удалось связаться с сервером. Проверьте подключение.", onRetry);
  }

  var addressCopyValue = null;
  var addressCopyController = logic.createAddressCopyController({
    getCopyButton: function () {
      return document.getElementById("copy-address");
    },
    getStatusElement: function () {
      return document.getElementById("copy-address-status");
    },
    getCopyValue: function () {
      return addressCopyValue;
    },
    copyText: function (value) {
      return shell.copyText(value);
    },
  });

  function bindCopyAddress() {
    addressCopyController.bind();
  }

  function renderPhones(phones) {
    var container = document.getElementById("client-phones");
    if (!container) {
      return;
    }
    if (!phones || phones.length === 0) {
      container.innerHTML = '<p class="clients-phone-muted">Не указан</p>';
      return;
    }
    container.innerHTML = "";
    phones.forEach(function (phone, index) {
      var row = document.createElement("div");
      row.className = "client-detail-phone-row";

      if (phone.telHref) {
        var link = document.createElement("a");
        link.className = "clients-link";
        link.href = "tel:" + phone.telHref;
        link.textContent = phone.value;
        row.appendChild(link);
      } else {
        var text = document.createElement("span");
        text.textContent = phone.value;
        row.appendChild(text);
      }

      var button = document.createElement("button");
      button.type = "button";
      button.className = "workspace-button workspace-button--secondary";
      button.textContent = "Копировать";
      var statusEl = document.createElement("span");
      statusEl.className = "workspace-status copy-phone-status";
      statusEl.id = "copy-phone-" + index;
      statusEl.setAttribute("role", "status");
      statusEl.setAttribute("aria-live", "polite");

      button.addEventListener("click", function () {
        shell
          .copyText(phone.value)
          .then(function () {
            statusEl.textContent = "Скопировано";
            statusEl.className = "workspace-status workspace-status--success";
          })
          .catch(function () {
            statusEl.textContent = "Не удалось скопировать";
            statusEl.className = "workspace-status workspace-status--error";
          });
      });

      row.appendChild(button);
      row.appendChild(statusEl);
      container.appendChild(row);
    });
  }

  function renderDetailLayout(returnQuery) {
    if (!detailRoot) {
      return;
    }
    detailRoot.innerHTML = sections.renderAllSections(returnQuery);
  }

  function renderClient(client) {
    hideAllPanels();
    var returnQuery = parseReturnQuery();
    renderDetailLayout(returnQuery);

    var headerEl = detailRoot.querySelector(".client-detail-header");
    if (headerEl) {
      headerEl.outerHTML = sections.renderHeader(client, returnQuery, shell.escapeHtml);
    }

    var nameEl = document.getElementById("client-name");
    if (nameEl) {
      nameEl.textContent = client.name || "—";
    }

    var holdingNameEl = document.getElementById("client-holding-name");
    if (holdingNameEl) {
      holdingNameEl.textContent =
        client.holding && client.holding.name && client.holding.name.trim()
          ? client.holding.name
          : "—";
    }

    var managerNameEl = document.getElementById("client-manager-name");
    if (managerNameEl) {
      managerNameEl.textContent = client.manager && client.manager.name ? client.manager.name : "—";
    }

    var addressPresentation = logic.resolveAddressPresentation(client.address);
    addressCopyValue = addressPresentation.copyValue;
    var addressEl = document.getElementById("client-address");
    if (addressEl) {
      addressEl.textContent = addressPresentation.displayText;
    }

    var loadedAtEl = document.getElementById("client-loaded-at");
    if (loadedAtEl) {
      loadedAtEl.textContent = logic.formatLoadedInLkLabel(client.lastImportedAtLabel);
    }

    var sourceUpdatedEl = document.getElementById("client-source-updated");
    if (sourceUpdatedEl) {
      sourceUpdatedEl.textContent = logic.SOURCE_UPDATED_UNKNOWN;
    }

    var uuidEl = document.getElementById("client-uuid");
    if (uuidEl) {
      uuidEl.textContent = client.guid;
    }

    var holdingUuidEl = document.getElementById("client-holding-uuid");
    if (holdingUuidEl) {
      holdingUuidEl.textContent = client.holding && client.holding.id ? client.holding.id : "—";
    }

    var managerUuidEl = document.getElementById("client-manager-uuid");
    if (managerUuidEl) {
      managerUuidEl.textContent = client.manager ? client.manager.id : "—";
    }

    renderPhones(client.phones);
    bindCopyAddress();
    window.ClientCardPrototype.mount(detailRoot, client);
    sections.initCollapsibles(detailRoot);
    detailEl.classList.remove("clients-hidden");
    applyStoreDeepLink(detailRoot);
    applyWorkDeepLink(detailRoot);
  }

  function applyStoreDeepLink(root) {
    var params = new URLSearchParams(window.location.search);
    var storeGuid = params.get("store");
    if (!storeGuid) {
      return;
    }
    var normalized = storeGuid.trim().toLowerCase();
    var dataTab = root.querySelector("#pc-tab-data");
    if (dataTab) {
      dataTab.click();
    }
    var outletCard = null;
    root.querySelectorAll(".pc-outlet-card[data-outlet-guid]").forEach(function (el) {
      if (el.getAttribute("data-outlet-guid").toLowerCase() === normalized) {
        outletCard = el;
      }
    });
    if (outletCard) {
      outletCard.scrollIntoView({ block: "nearest" });
      outletCard.classList.add("pc-outlet-card--selected");
    }
  }

  function applyWorkDeepLink(root) {
    var params = new URLSearchParams(window.location.search);
    if (params.get("tab") !== "work") {
      return;
    }
    var desiredTab = "work";
    var rawTaskId = params.get("task");
    var taskId = null;
    if (rawTaskId && /^\d+$/.test(String(rawTaskId).trim())) {
      taskId = String(rawTaskId).trim();
    }

    function isWorkTabSelected() {
      var selected = root.querySelector('.pc-tabs button[aria-selected="true"]');
      return selected && selected.getAttribute("data-card-tab") === desiredTab;
    }

    function scrollToTaskRow() {
      if (!taskId || !isWorkTabSelected()) {
        return false;
      }
      var selector = '.pc-bitrix24-task[data-task-id="' + CSS.escape(taskId) + '"]';
      var row = root.querySelector(selector);
      if (!row) {
        return false;
      }
      row.scrollIntoView({ block: "nearest", behavior: "smooth" });
      return true;
    }

    var tabBtn = root.querySelector('[data-card-tab="work"]');
    if (tabBtn && tabBtn.getAttribute("aria-selected") !== "true") {
      tabBtn.click();
    }

    if (!taskId) {
      return;
    }

    var loadPromise = root._bitrix24WorkLoadPromise;
    function waitForTask() {
      if (!isWorkTabSelected()) {
        return;
      }
      if (scrollToTaskRow()) {
        return;
      }
      var attempts = 0;
      var timer = window.setInterval(function () {
        attempts += 1;
        if (!isWorkTabSelected() || attempts > 120) {
          window.clearInterval(timer);
          return;
        }
        if (scrollToTaskRow()) {
          window.clearInterval(timer);
        }
      }, 50);
    }

    if (loadPromise && typeof loadPromise.then === "function") {
      loadPromise.then(waitForTask).catch(waitForTask);
    } else {
      waitForTask();
    }
  }

  function showState(title, text, onRetry) {
    hideAllPanels();
    statePanel.classList.remove("clients-hidden");
    shell.setPanelMessage(
      statePanel,
      "info",
      title,
      text,
      onRetry
        ? '<button type="button" class="workspace-button workspace-button--primary" id="retry-detail">Повторить</button>'
        : "",
    );
    if (onRetry) {
      bindRetryButton("retry-detail", onRetry);
    }
  }

  var currentUser = null;

  function isAdminActorSession() {
    var preview = shell.getPreviewState();
    if (preview && preview.active) {
      return false;
    }
    var actor = shell.getActorUser();
    return Boolean(actor && actor.role === "admin");
  }

  function maybeMountReviewPanel(client) {
    if (!isAdminActorSession() || !window.ClientReviewPanel) {
      return;
    }
    var host = document.getElementById("client-review-host");
    if (!host) {
      host = document.createElement("div");
      host.id = "client-review-host";
      detailRoot.appendChild(host);
    }
    window.ClientReviewPanel.create({
      api: api,
      shell: shell,
      logic: logic,
      guid: client.guid,
      container: host,
      currentManagerLabel:
        client.manager && client.manager.name
          ? client.manager.name + " · " + client.manager.shortId
          : "—",
    }).mount();
  }

  var detailController = logic.createDetailController({
    parseGuidFromPath: clientGuidFromPath,
    ensureAdminAccess: function (callback) {
      return shell.ensureClientsReadAccess(function (user, reason) {
        currentUser = user;
        callback(user, reason);
      });
    },
    showInvalidGuid: function () {
      showState("Некорректная ссылка", "Идентификатор клиента имеет неверный формат.", null);
    },
    showLoading: function () {
      showState("Загрузка карточки…", "", null);
    },
    fetchClient: function (guid) {
      var v3Entity = v3EntityFromQuery();
      if (v3Entity) {
        return api.apiRequest(
          "/api/clients/v3/detail?entity=" +
            encodeURIComponent(v3Entity) +
            "&guid=" +
            encodeURIComponent(guid),
        );
      }
      return api.apiRequest("/api/clients/" + encodeURIComponent(guid));
    },
    handleClientResult: function (result) {
      var v3Entity = v3EntityFromQuery();
      if (v3Entity) {
        if (result.response.status === 401) {
          window.location.replace("/login");
          return;
        }
        if (result.response.status === 404) {
          showState("Объект не найден", "Проверьте ссылку или вернитесь к списку.", null);
          return;
        }
        if (result.response.status !== 200 || !result.data || !result.data.entity) {
          showState("Не удалось загрузить карточку", "Повторите попытку позже.", function () {
            return detailController.loadClient();
          });
          return;
        }
        renderV3Detail({
          entityType: v3Entity,
          entity: result.data.entity,
          holdingLink: result.data.holdingLink,
        });
        return;
      }
      if (result.response.status === 401) {
        window.location.replace("/login");
        return;
      }
      if (result.response.status === 403) {
        handleAccessReason("forbidden", function () {
          return detailController.ensureAccessAndLoad();
        });
        return;
      }
      if (result.response.status === 400) {
        showState("Некорректная ссылка", "Идентификатор клиента имеет неверный формат.", null);
        return;
      }
      if (result.response.status === 404) {
        showState("Клиент не найден", "Проверьте ссылку или вернитесь к списку.", null);
        return;
      }
      if (result.response.status === 503) {
        showState(
          "Сервис временно недоступен",
          api.extractErrorMessage(result.data, "Повторите попытку позже."),
          function () {
            return detailController.loadClient();
          },
        );
        return;
      }
      if (result.response.status !== 200 || !result.data || !result.data.client) {
        showState("Не удалось загрузить карточку", "Повторите попытку позже.", function () {
          return detailController.loadClient();
        });
        return;
      }
      renderClient(result.data.client);
      maybeMountReviewPanel(result.data.client);
    },
    showClientError: function (err, onRetry) {
      showState("Ошибка загрузки", api.mapRequestError(err, api.REQUEST_TIMEOUT_MS / 1000), onRetry);
    },
    showInitError: function (err, onRetry) {
      showInitError(
        "Ошибка инициализации",
        api.mapRequestError(err, api.REQUEST_TIMEOUT_MS / 1000),
        onRetry,
      );
    },
    handleAccessReason: function (reason, onRetry) {
      handleAccessReason(reason, onRetry);
    },
  });

  shell.mountAuthenticatedShell("clients", function () {
    detailController.bootstrap();
  });
})();
