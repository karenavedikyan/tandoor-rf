(function () {
  "use strict";

  var api = window.TandoorRf;
  var MAX_QUERY_LENGTH = 200;
  var VIEW_MODE_KEY = "tandoor-catalog-view-mode";
  var OUTLET_KEY_PREFIX = "tandoor-catalog-outlet-";
  var VALID_VIEW_MODES = { large: true, compact: true, list: true };

  function esc(value) {
    return window.ClientDetailSections.escapeHtml(value || "");
  }

  function sessionKey(clientGuid) {
    return "tandoor-catalog-workspace-" + clientGuid;
  }

  function outletSessionKey(clientGuid) {
    return OUTLET_KEY_PREFIX + clientGuid;
  }

  function readSelectedOutlet(clientGuid) {
    try {
      return sessionStorage.getItem(outletSessionKey(clientGuid)) || "";
    } catch (_e) {
      return "";
    }
  }

  function writeSelectedOutlet(clientGuid, storeGuid) {
    try {
      if (storeGuid) sessionStorage.setItem(outletSessionKey(clientGuid), storeGuid);
      else sessionStorage.removeItem(outletSessionKey(clientGuid));
    } catch (_e) {
      /* ignore */
    }
  }

  function readViewMode() {
    try {
      var mode = sessionStorage.getItem(VIEW_MODE_KEY);
      return VALID_VIEW_MODES[mode] ? mode : "large";
    } catch (_e) {
      return "large";
    }
  }

  function writeViewMode(mode) {
    try {
      sessionStorage.setItem(VIEW_MODE_KEY, mode);
    } catch (_e) {
      /* ignore */
    }
  }

  function readSessionState(clientGuid) {
    try {
      var raw = sessionStorage.getItem(sessionKey(clientGuid));
      return raw ? JSON.parse(raw) : null;
    } catch (_e) {
      return null;
    }
  }

  function writeSessionState(clientGuid, state) {
    try {
      sessionStorage.setItem(
        sessionKey(clientGuid),
        JSON.stringify({
          query: state.query,
          sectionCode: state.sectionCode,
          propertyFilters: state.propertyFilters,
          page: state.page,
          viewMode: state.viewMode,
          scrollY: state.scrollY,
        }),
      );
    } catch (_e) {
      /* ignore */
    }
  }

  function clearSessionState(clientGuid) {
    try {
      sessionStorage.removeItem(sessionKey(clientGuid));
    } catch (_e) {
      /* ignore */
    }
  }

  function renderState(message, tone) {
    return (
      '<div class="pc-pad pc-unavailable pc-catalog-state pc-catalog-state--' +
      esc(tone || "info") +
      '">' +
      esc(message) +
      "</div>"
    );
  }

  function groupStatusLabel(status) {
    if (status === "missing_reference") return "Группа не найдена в выгрузке";
    if (status === "not_specified") return "Группа не указана";
    return "";
  }

  function formatImportedAt(value) {
    if (!value) return "—";
    try {
      return new Date(value).toLocaleString("ru-RU");
    } catch (_error) {
      return value;
    }
  }

  function buildApiUrl(clientGuid, suffix, query) {
    var url =
      "/api/clients/" + encodeURIComponent(clientGuid) + "/catalog/" + suffix;
    if (!query) return url;
    var params = new URLSearchParams();
    Object.keys(query).forEach(function (key) {
      var val = query[key];
      if (val === undefined || val === null || val === "") return;
      if (Array.isArray(val)) {
        val.forEach(function (item) {
          if (item !== undefined && item !== null && String(item) !== "") {
            params.append(key, String(item));
          }
        });
        return;
      }
      params.set(key, String(val));
    });
    var qs = params.toString();
    return qs ? url + "?" + qs : url;
  }

  function filterParamKey(filterKey) {
    return "filter" + filterKey.charAt(0).toUpperCase() + filterKey.slice(1);
  }

  function buildListQuery(state) {
    var query = {
      q: state.query,
      section: state.sectionCode,
      page: state.page,
      pageSize: state.pageSize,
      versionId: state.versionId,
    };
    if (state.selectedStoreGuid) query.storeGuid = state.selectedStoreGuid;
    Object.keys(state.propertyFilters || {}).forEach(function (key) {
      var values = state.propertyFilters[key];
      if (values && values.length) query[filterParamKey(key)] = values.slice();
    });
    return query;
  }

  function renderImagePlaceholder(label) {
    return (
      '<div class="pc-catalog-image pc-catalog-image--placeholder" aria-hidden="true"><span>' +
      esc(label || "Изображение недоступно") +
      "</span></div>"
    );
  }

  function renderProductImage(clientGuid, item, mode) {
    if (item.primaryImageAssetId) {
      var src = buildApiUrl(clientGuid, "media/" + encodeURIComponent(item.primaryImageAssetId));
      var fitClass =
        mode === "list"
          ? " pc-catalog-image--list"
          : mode === "compact"
            ? " pc-catalog-image--compact"
            : " pc-catalog-image--large";
      return (
        '<button type="button" class="pc-catalog-image pc-catalog-image--photo' +
        fitClass +
        '" data-catalog-zoom="' +
        esc(src) +
        '" aria-label="Увеличить фото ' +
        esc(item.name) +
        '"><img src="' +
        esc(src) +
        '" alt="" loading="lazy" data-catalog-media-img /></button>'
      );
    }
    if (!item.primaryImagePath) {
      return renderImagePlaceholder("Изображение не передано");
    }
    return renderImagePlaceholder("Просмотр изображения пока недоступен");
  }

  function renderKeyProperties(item) {
    if (!item.keyProperties || !item.keyProperties.length) return "";
    return item.keyProperties
      .map(function (prop) {
        return (
          '<div class="pc-catalog-prop"><span class="pc-label">' +
          esc(prop.name) +
          '</span> <span class="pc-value">' +
          esc(prop.value) +
          "</span></div>"
        );
      })
      .join("");
  }

  function mountWorkspace(root, clientGuid, clientInfo) {
    if (!root || !api) return;

    var saved = readSessionState(clientGuid);
    var state = {
      opId: 0,
      outletContextGen: 0,
      detailLoadId: 0,
      delegationBound: false,
      layoutReady: false,
      clientGuid: clientGuid,
      clientName: clientInfo && clientInfo.name ? clientInfo.name : "Клиент",
      meta: null,
      versionId: null,
      sectionTree: [],
      facets: null,
      query: saved && saved.query ? saved.query : "",
      sectionCode: saved && saved.sectionCode ? saved.sectionCode : "",
      propertyFilters: (saved && saved.propertyFilters) || {},
      page: saved && saved.page ? saved.page : 1,
      pageSize: 20,
      viewMode: saved && saved.viewMode ? saved.viewMode : readViewMode(),
      selectedCode: null,
      view: "list",
      refreshing: false,
      scrollY: saved && saved.scrollY ? saved.scrollY : 0,
      lastTotal: 0,
      facetExtras: {},
      facetRequestGen: {},
      filtersExpanded: false,
      lightboxReturnFocus: null,
      outlets: [],
      selectedStoreGuid: readSelectedOutlet(clientGuid) || null,
      outletConfirmed: false,
      distributionEnabled: false,
      distributionSummary: { installed: [], planned: [] },
      distributionPanel: "catalog",
      markerSaving: false,
    };

    function serializeCatalogContext() {
      return JSON.stringify({
        versionId: state.versionId,
        query: state.query,
        sectionCode: state.sectionCode,
        propertyFilters: state.propertyFilters,
      });
    }

    function invalidateFacetRequests() {
      state.facetExtras = {};
      Object.keys(state.facetRequestGen).forEach(function (key) {
        state.facetRequestGen[key] = (state.facetRequestGen[key] || 0) + 1;
      });
    }

    function persistState() {
      writeViewMode(state.viewMode);
      writeSessionState(clientGuid, state);
    }

    function setHtml(html) {
      root.innerHTML = html;
    }

    function renderHeader() {
      return (
        '<header class="pc-catalog-workspace-header">' +
        '<div class="pc-catalog-workspace-nav">' +
        '<a class="pc-link" href="/clients/' +
        encodeURIComponent(clientGuid) +
        '">← К карточке клиента</a>' +
        "</div>" +
        '<h1 class="pc-catalog-workspace-title">Каталог образцов</h1>' +
        '<p class="pc-subtitle">' +
        esc(state.clientName) +
        " · просмотр для сценария «Внести дистрибуцию»</p></header>"
      );
    }

    function renderDistributionBadges(item) {
      if (!item.distribution) return "";
      var parts = [];
      if (item.distribution.installed) parts.push('<span class="pc-catalog-marker pc-catalog-marker--installed">Установлено</span>');
      if (item.distribution.planned) parts.push('<span class="pc-catalog-marker pc-catalog-marker--planned">Нужно поставить</span>');
      return parts.length ? '<div class="pc-catalog-markers">' + parts.join("") + "</div>" : "";
    }

    function renderDistributionActions(productCode, distribution) {
      if (!state.distributionEnabled) return "";
      var dist = distribution || { installed: false, planned: false };
      return (
        '<div class="pc-catalog-distribution-actions">' +
        '<button type="button" class="pc-catalog-btn pc-catalog-btn--ghost' +
        (dist.installed ? " pc-catalog-btn--active" : "") +
        '" data-distribution-action="set" data-marker-kind="installed" data-product-code="' +
        esc(productCode) +
        '">Установлено</button>' +
        '<button type="button" class="pc-catalog-btn pc-catalog-btn--ghost' +
        (dist.planned ? " pc-catalog-btn--active" : "") +
        '" data-distribution-action="set" data-marker-kind="planned" data-product-code="' +
        esc(productCode) +
        '">Нужно поставить</button>' +
        (dist.installed
          ? '<button type="button" class="pc-link" data-distribution-action="clear" data-marker-kind="installed" data-product-code="' +
            esc(productCode) +
            '">Снять факт</button>'
          : "") +
        (dist.planned
          ? '<button type="button" class="pc-link" data-distribution-action="clear" data-marker-kind="planned" data-product-code="' +
            esc(productCode) +
            '">Снять план</button>'
          : "") +
        "</div>"
      );
    }

    function renderOutletPicker() {
      if (!state.outlets.length) {
        return (
          '<div class="pc-catalog-outlet-picker pc-catalog-outlet-picker--empty">' +
          '<p class="pc-label">Торговые точки клиента не импортированы из 1С. Сохранение дистрибуции недоступно.</p></div>'
        );
      }
      var options = state.outlets
        .map(function (outlet) {
          var selected = state.selectedStoreGuid === outlet.guidStore ? " selected" : "";
          var blocked = outlet.distributionWritable ? "" : " disabled";
          var suffix =
            " · " +
            esc(outlet.closureStatusLabel) +
            (outlet.guidStoreShortLabel ? " · " + esc(outlet.guidStoreShortLabel) : "");
          return (
            '<option value="' +
            esc(outlet.guidStore) +
            '"' +
            selected +
            blocked +
            ">" +
            esc(outlet.displayName || outlet.storeAddress || outlet.guidStoreShortLabel) +
            suffix +
            "</option>"
          );
        })
        .join("");
      var selectedOutlet = state.outlets.find(function (item) {
        return item.guidStore === state.selectedStoreGuid;
      });
      var notice = state.outletUnavailableReason
        ? '<p class="pc-catalog-note">' + esc(state.outletUnavailableReason) + "</p>"
        : selectedOutlet && !selectedOutlet.distributionWritable
          ? '<p class="pc-catalog-note">' + esc(selectedOutlet.distributionBlockedReason || "") + "</p>"
          : state.distributionEnabled
            ? '<p class="pc-label">Выбрана торговая точка. Отметки сохраняются для этой ТТ.</p>'
            : '<p class="pc-label">Выберите торговую точку для сохранения дистрибуции.</p>';
      var singleConfirm =
        state.outlets.length === 1 && !state.outletConfirmed
          ? '<button type="button" class="pc-catalog-btn" data-catalog-action="confirm-outlet">Подтвердить торговую точку</button>'
          : "";
      return (
        '<div class="pc-catalog-outlet-picker">' +
        '<label class="pc-catalog-field"><span class="pc-label">Торговая точка</span>' +
        '<select class="pc-catalog-input" data-catalog-outlet-select aria-label="Выбор торговой точки">' +
        '<option value="">— выберите торговую точку —</option>' +
        options +
        "</select></label>" +
        singleConfirm +
        notice +
        "</div>"
      );
    }

    function renderDistributionLists() {
      if (!state.selectedStoreGuid) {
        return renderState("Выберите торговую точку, чтобы просмотреть сохранённые отметки.", "info");
      }
      var installed = state.distributionSummary.installed || [];
      var planned = state.distributionSummary.planned || [];
      function renderRows(items, emptyLabel) {
        if (!items.length) return '<p class="pc-label">' + esc(emptyLabel) + "</p>";
        return (
          '<ul class="pc-catalog-distribution-list">' +
          items
            .map(function (row) {
              var name = row.productName || row.productCode;
              var stale = row.inCurrentCatalog ? "" : ' <span class="pc-catalog-note">(нет в текущем каталоге)</span>';
              return (
                "<li><strong>" +
                esc(name) +
                "</strong> · код " +
                esc(row.productCode) +
                stale +
                "</li>"
              );
            })
            .join("") +
          "</ul>"
        );
      }
      return (
        '<div class="pc-catalog-distribution-panels">' +
        '<div class="pc-catalog-view-modes">' +
        '<button type="button" class="pc-catalog-view-modes__btn' +
        (state.distributionPanel === "catalog" ? " pc-catalog-view-modes__btn--active" : "") +
        '" data-distribution-panel="catalog">Каталог</button>' +
        '<button type="button" class="pc-catalog-view-modes__btn' +
        (state.distributionPanel === "installed" ? " pc-catalog-view-modes__btn--active" : "") +
        '" data-distribution-panel="installed">Установлено (' +
        esc(String(installed.length)) +
        ")</button>" +
        '<button type="button" class="pc-catalog-view-modes__btn' +
        (state.distributionPanel === "planned" ? " pc-catalog-view-modes__btn--active" : "") +
        '" data-distribution-panel="planned">Нужно поставить (' +
        esc(String(planned.length)) +
        ")</button></div>" +
        (state.distributionPanel === "installed"
          ? '<section class="pc-card pc-space"><div class="pc-cardhead"><h2>Установлено</h2></div><div class="pc-pad">' +
            renderRows(installed, "Фактических образцов пока нет.") +
            "</div></section>"
          : state.distributionPanel === "planned"
            ? '<section class="pc-card pc-space"><div class="pc-cardhead"><h2>Нужно поставить</h2></div><div class="pc-pad">' +
              renderRows(planned, "План установки пока пуст.") +
              "</div></section>"
            : "") +
        "</div>"
      );
    }

    function renderMetaBanner(meta) {
      if (!meta || meta.state !== "ready") {
        return renderState(meta && meta.message ? meta.message : "Каталог не импортирован.", "empty");
      }
      var note = meta.classificationIncomplete && meta.message
        ? '<p class="pc-label">' + esc(meta.message) + "</p>"
        : "";
      return (
        renderOutletPicker() +
        renderDistributionLists() +
        '<div class="pc-catalog-meta">' +
        '<p class="pc-label">Снимок каталога · обновлён ' +
        esc(formatImportedAt(meta.importedAt)) +
        " · товаров " +
        esc(String(meta.productCount)) +
        "</p>" +
        note +
        '<p class="pc-label">Цены и остатки в этом снимке не импортировались и не показываются.</p></div>'
      );
    }

    function renderSectionTreeNodes(nodes, depth) {
      if (!nodes || !nodes.length) return "";
      return nodes
        .map(function (node) {
          var selected = state.sectionCode === node.code ? " pc-catalog-tree__item--selected" : "";
          var indent = ' style="--tree-depth:' + depth + '"';
          var children =
            node.children && node.children.length
              ? '<ul class="pc-catalog-tree">' +
                renderSectionTreeNodes(node.children, depth + 1) +
                "</ul>"
              : "";
          return (
            '<li class="pc-catalog-tree__item' +
            selected +
            '"' +
            indent +
            '><button type="button" class="pc-catalog-tree__btn" data-section-code="' +
            esc(node.code) +
            '">' +
            esc(node.name) +
            "</button>" +
            children +
            "</li>"
          );
        })
        .join("");
    }

    function renderSectionTree() {
      if (!state.sectionTree.length) {
        return '<p class="pc-label">Разделы не переданы в снимке.</p>';
      }
      return (
        '<nav class="pc-catalog-filters-section" aria-label="Разделы каталога">' +
        '<button type="button" class="pc-link pc-catalog-tree__reset" data-section-code="">Все разделы</button>' +
        '<ul class="pc-catalog-tree">' +
        renderSectionTreeNodes(state.sectionTree, 0) +
        "</ul></nav>"
      );
    }

    function renderFacetGroups() {
      if (!state.facets || !state.facets.facets || !state.facets.facets.length) {
        return '<p class="pc-label">Дополнительные фильтры появятся после подтверждения свойств в снимке каталога.</p>';
      }
      return state.facets.facets
        .map(function (group) {
          var selected = state.propertyFilters[group.key] || [];
          var extras = state.facetExtras[group.key] || null;
          var mergedValues = group.values.slice();
          if (extras && extras.values) {
            extras.values.forEach(function (entry) {
              if (mergedValues.some(function (item) { return item.value === entry.value; })) return;
              mergedValues.push(entry);
            });
          }
          var mergedHtml = mergedValues
            .map(function (entry) {
              var isOn = selected.indexOf(entry.value) >= 0;
              return (
                '<label class="pc-catalog-facet-option">' +
                '<input type="checkbox" data-filter-key="' +
                esc(group.key) +
                '" data-filter-value="' +
                esc(entry.value) +
                '"' +
                (isOn ? " checked" : "") +
                " />" +
                '<span>' +
                esc(entry.value) +
                " (" +
                esc(String(entry.count)) +
                ")</span></label>"
              );
            })
            .join("");
          var truncatedNote = group.valuesTruncated
            ? '<p class="pc-label">Показаны первые ' +
              esc(String(group.values.length)) +
              " из " +
              esc(String(group.totalValues)) +
              " значений.</p>"
            : "";
          var searchBlock = group.valuesTruncated
            ? '<label class="pc-catalog-field pc-catalog-facet-search"><span class="pc-label">Поиск значений</span>' +
              '<input class="pc-catalog-input" type="search" data-facet-search="' +
              esc(group.key) +
              '" value="' +
              esc((extras && extras.q) || "") +
              '" maxlength="64" autocomplete="off" placeholder="Начните ввод..." /></label>' +
              (extras && extras.loading ? '<p class="pc-label">Поиск…</p>' : "") +
              (extras && extras.error ? '<p class="pc-label">' + esc(extras.error) + "</p>" : "") +
              (extras && extras.hasMore
                ? '<button type="button" class="pc-link" data-facet-more="' + esc(group.key) + '">Показать ещё</button>'
                : "")
            : "";
          return (
            '<fieldset class="pc-catalog-facet"><legend>' +
            esc(group.label) +
            "</legend>" +
            truncatedNote +
            searchBlock +
            mergedHtml +
            "</fieldset>"
          );
        })
        .join("");
    }

    function renderActiveFilters() {
      var chips = [];
      if (state.query) {
        chips.push({ kind: "q", label: "Поиск: " + state.query });
      }
      if (state.sectionCode) {
        var sectionName = state.sectionCode;
        function findName(nodes) {
          nodes.forEach(function (n) {
            if (n.code === state.sectionCode) sectionName = n.name;
            if (n.children) findName(n.children);
          });
        }
        findName(state.sectionTree);
        chips.push({ kind: "section", label: "Раздел: " + sectionName });
      }
      Object.keys(state.propertyFilters).forEach(function (key) {
        (state.propertyFilters[key] || []).forEach(function (value) {
          chips.push({ kind: "filter:" + key + ":" + value, label: value });
        });
      });
      if (!chips.length) return "";
      return (
        '<div class="pc-catalog-active-filters">' +
        chips
          .map(function (chip) {
            return (
              '<button type="button" class="pc-catalog-chip" data-clear-filter="' +
              esc(chip.kind) +
              '">' +
              esc(chip.label) +
              " ×</button>"
            );
          })
          .join("") +
        '<button type="button" class="pc-link" data-catalog-action="reset-filters">Сбросить всё</button></div>'
      );
    }

    function renderViewModeToggle() {
      var modes = [
        { id: "large", label: "Крупные карточки" },
        { id: "compact", label: "Компактные" },
        { id: "list", label: "Список" },
      ];
      return (
        '<div class="pc-catalog-view-modes" role="toolbar" aria-label="Режим отображения">' +
        modes
          .map(function (mode) {
            var selected = state.viewMode === mode.id ? " pc-catalog-view-modes__btn--active" : "";
            return (
              '<button type="button" class="pc-catalog-view-modes__btn' +
              selected +
              '" data-view-mode="' +
              esc(mode.id) +
              '">' +
              esc(mode.label) +
              "</button>"
            );
          })
          .join("") +
        "</div>"
      );
    }

    function renderToolbar() {
      return (
        '<form class="pc-catalog-toolbar pc-catalog-toolbar--workspace" data-catalog-search-form>' +
        '<label class="pc-catalog-field"><span class="pc-label">Поиск по названию или коду 1С</span>' +
        '<input class="pc-catalog-input" type="search" name="q" value="' +
        esc(state.query) +
        '" maxlength="' +
        MAX_QUERY_LENGTH +
        '" autocomplete="off" /></label>' +
        '<button type="submit" class="pc-catalog-btn">Найти</button></form>' +
        renderViewModeToggle() +
        renderActiveFilters()
      );
    }

    function renderFiltersPanel() {
      return (
        '<aside class="pc-catalog-filters-panel">' +
        "<h2 class=\"pc-label\">Фильтры</h2>" +
        renderSectionTree() +
        '<div class="pc-catalog-facets">' +
        renderFacetGroups() +
        "</div></aside>"
      );
    }

    function renderProductCard(item) {
      var groupNote = groupStatusLabel(item.groupStatus);
      var articleLine = item.article
        ? '<div class="pc-label">Артикул: ' + esc(item.article) + "</div>"
        : "";
      var bodyClass =
        state.viewMode === "list"
          ? " pc-catalog-card__body--list"
          : state.viewMode === "compact"
            ? " pc-catalog-card__body--compact"
            : "";
      var cardClass =
        "pc-catalog-card pc-catalog-card--" +
        state.viewMode +
        (state.viewMode === "list" ? " pc-catalog-card--row" : "");
      return (
        '<article class="' +
        cardClass +
        '">' +
        renderProductImage(state.clientGuid, item, state.viewMode) +
        '<div class="pc-catalog-card__body' +
        bodyClass +
        '">' +
        '<div class="pc-catalog-card__title">' +
        esc(item.name) +
        "</div>" +
        '<div class="pc-label">Код 1С: ' +
        esc(item.code) +
        "</div>" +
        articleLine +
        renderKeyProperties(item) +
        (groupNote ? '<div class="pc-catalog-note">' + esc(groupNote) + "</div>" : "") +
        renderDistributionBadges(item) +
        renderDistributionActions(item.code, item.distribution) +
        '<button type="button" class="pc-link" data-catalog-open="' +
        esc(item.code) +
        '">Подробнее</button></div></article>'
      );
    }

    function captureSearchFocus() {
      var input = root.querySelector('[data-catalog-search-form] [name="q"]');
      if (input && document.activeElement === input) {
        return { input: input, start: input.selectionStart, end: input.selectionEnd };
      }
      return null;
    }

    function restoreSearchFocus(focus) {
      if (!focus || !focus.input || !root.contains(focus.input)) return;
      focus.input.focus();
      try {
        if (typeof focus.start === "number" && typeof focus.end === "number") {
          focus.input.setSelectionRange(focus.start, focus.end);
        }
      } catch (_error) {
        focus.input.focus();
      }
    }

    function ensureListLayout(resultsHtml) {
      if (!state.layoutReady || !root.querySelector("[data-catalog-workspace-layout]")) {
        setHtml(
          renderHeader() +
            '<div data-catalog-meta-banner>' +
            renderMetaBanner(state.meta) +
            "</div>" +
            '<div class="pc-catalog-workspace-layout" data-catalog-workspace-layout>' +
            '<button type="button" class="pc-catalog-filters-toggle" data-catalog-action="toggle-filters">Фильтры</button>' +
            '<aside class="pc-catalog-filters-panel' +
            (state.filtersExpanded ? " pc-catalog-filters-panel--expanded" : "") +
            '" data-catalog-filters-panel>' +
            "<h2 class=\"pc-label\">Фильтры</h2>" +
            '<div data-catalog-section-tree>' +
            renderSectionTree() +
            "</div>" +
            '<div class="pc-catalog-facets" data-catalog-facets>' +
            renderFacetGroups() +
            "</div></aside>" +
            '<div class="pc-catalog-workspace-main">' +
            '<form class="pc-catalog-toolbar pc-catalog-toolbar--workspace" data-catalog-search-form>' +
            '<label class="pc-catalog-field"><span class="pc-label">Поиск по названию или коду 1С</span>' +
            '<input class="pc-catalog-input" type="search" name="q" value="' +
            esc(state.query) +
            '" maxlength="' +
            MAX_QUERY_LENGTH +
            '" autocomplete="off" /></label>' +
            '<button type="submit" class="pc-catalog-btn">Найти</button></form>' +
            '<div data-catalog-toolbar-extras>' +
            renderViewModeToggle() +
            renderActiveFilters() +
            "</div>" +
            '<div class="pc-catalog-results-count pc-label" data-results-count></div>' +
            '<div class="pc-catalog-results" data-catalog-results aria-live="polite">' +
            (resultsHtml || renderState("Загрузка каталога…", "loading")) +
            "</div></div></div>",
        );
        state.layoutReady = true;
        bindDelegationOnce();
        return;
      }
      var metaBanner = root.querySelector("[data-catalog-meta-banner]");
      if (metaBanner) metaBanner.innerHTML = renderMetaBanner(state.meta);
      refreshFilterChrome();
      if (resultsHtml !== undefined) {
        setResultsHtml(resultsHtml);
      }
    }

    function refreshFilterChrome() {
      var focus = captureSearchFocus();
      var panel = root.querySelector("[data-catalog-filters-panel]");
      if (panel) {
        panel.classList.toggle("pc-catalog-filters-panel--expanded", state.filtersExpanded);
      }
      var sectionTree = root.querySelector("[data-catalog-section-tree]");
      if (sectionTree) sectionTree.innerHTML = renderSectionTree();
      var facets = root.querySelector("[data-catalog-facets]");
      if (facets) facets.innerHTML = renderFacetGroups();
      var extras = root.querySelector("[data-catalog-toolbar-extras]");
      if (extras) extras.innerHTML = renderViewModeToggle() + renderActiveFilters();
      var qInput = root.querySelector('[data-catalog-search-form] [name="q"]');
      if (qInput && qInput.value !== state.query) qInput.value = state.query;
      restoreSearchFocus(focus);
    }

    function updateResultsCount(total) {
      var el = root.querySelector("[data-results-count]");
      if (!el) return;
      el.textContent = total !== undefined ? "Найдено: " + total : "";
    }

    function setResultsHtml(html) {
      var results = root.querySelector("[data-catalog-results]");
      if (results) {
        results.innerHTML = html;
        return true;
      }
      return false;
    }

    function showListMessage(message, tone, actions) {
      var html =
        renderState(message, tone) +
        (actions
          ? '<div class="pc-catalog-actions">' +
            actions
              .map(function (action) {
                return (
                  '<button type="button" class="pc-catalog-btn' +
                  (action.ghost ? " pc-catalog-btn--ghost" : "") +
                  '" data-catalog-action="' +
                  esc(action.id) +
                  '">' +
                  esc(action.label) +
                  "</button>"
                );
              })
              .join("") +
            "</div>"
          : "");
      if (!setResultsHtml(html)) ensureListLayout(html);
    }

    function captureOutletContext() {
      return {
        gen: state.outletContextGen,
        storeGuid: state.selectedStoreGuid || "",
      };
    }

    function isOutletContextCurrent(capture) {
      return (
        capture.gen === state.outletContextGen &&
        capture.storeGuid === (state.selectedStoreGuid || "") &&
        root.isConnected
      );
    }

    function beginOutletContext(storeGuid) {
      state.outletContextGen += 1;
      state.selectedStoreGuid = storeGuid || null;
      state.outletConfirmed = false;
      state.distributionEnabled = false;
      state.distributionSummary = { installed: [], planned: [] };
      state.markerSaving = false;
      writeSelectedOutlet(state.clientGuid, state.selectedStoreGuid || "");
      return state.outletContextGen;
    }

    function clearOutletSelection(reason) {
      beginOutletContext(null);
      if (reason) state.outletUnavailableReason = reason;
      else delete state.outletUnavailableReason;
    }

    function applyMetaDistribution(meta, outletCapture) {
      state.outlets = meta.outlets || state.outlets || [];
      if (meta.selectedStoreGuid !== undefined) {
        state.selectedStoreGuid = meta.selectedStoreGuid;
      }
      state.outletConfirmed = !!meta.outletConfirmed;
      state.distributionEnabled = !!meta.distributionEnabled;
      if (meta.outletConfirmed && meta.selectedStoreGuid) {
        writeSelectedOutlet(state.clientGuid, meta.selectedStoreGuid);
        delete state.outletUnavailableReason;
      } else if (outletCapture && outletCapture.storeGuid) {
        writeSelectedOutlet(state.clientGuid, "");
        if (meta.futureActionsBlockedReason) {
          state.outletUnavailableReason = meta.futureActionsBlockedReason;
        }
      } else if (!meta.selectedStoreGuid) {
        writeSelectedOutlet(state.clientGuid, "");
      }
    }

    function loadDistributionSummary(outletCapture) {
      var capture = outletCapture || captureOutletContext();
      if (!capture.storeGuid) {
        if (isOutletContextCurrent(capture)) {
          state.distributionSummary = { installed: [], planned: [] };
        }
        return Promise.resolve();
      }
      return api
        .apiRequest(
          "/api/clients/" +
            encodeURIComponent(state.clientGuid) +
            "/catalog/outlets/" +
            encodeURIComponent(capture.storeGuid) +
            "/distribution",
        )
        .then(function (result) {
          if (!isOutletContextCurrent(capture)) return;
          if (result.response.status === 403) {
            handleAccessDenied();
            return;
          }
          if (result.response.status === 404) {
            clearOutletSelection("Торговая точка не найдена или недоступна.");
            var summaryBanner = root.querySelector("[data-catalog-meta-banner]");
            if (summaryBanner) summaryBanner.innerHTML = renderMetaBanner(state.meta);
            return;
          }
          if (result.response.status === 200 && result.data) {
            state.distributionSummary = {
              installed: result.data.installed || [],
              planned: result.data.planned || [],
            };
          }
        })
        .catch(function () {
          if (!isOutletContextCurrent(capture)) return;
          state.distributionSummary = { installed: [], planned: [] };
        });
    }

    function saveDistributionMarker(action, markerKind, productCode) {
      var outletCapture = captureOutletContext();
      var versionId = state.versionId;
      if (!state.distributionEnabled || !outletCapture.storeGuid || state.markerSaving) {
        return Promise.resolve();
      }
      state.markerSaving = true;
      return api
        .apiRequest(
          "/api/clients/" +
            encodeURIComponent(state.clientGuid) +
            "/catalog/outlets/" +
            encodeURIComponent(outletCapture.storeGuid) +
            "/distribution/markers",
          {
            method: "POST",
            body: {
              action: action,
              markerKind: markerKind,
              productCode: productCode,
              versionId: versionId,
            },
          },
        )
        .then(function (result) {
          if (!isOutletContextCurrent(outletCapture)) {
            state.markerSaving = false;
            return;
          }
          state.markerSaving = false;
          if (result.response.status === 409 && result.data) {
            handleVersionConflict(result.data.message);
            return;
          }
          if (result.response.status === 403) {
            handleAccessDenied();
            return;
          }
          if (result.response.status === 404) {
            clearOutletSelection(
              result.data && result.data.message
                ? result.data.message
                : "Торговая точка не найдена или недоступна.",
            );
            alert(result.data && result.data.message ? result.data.message : "Сохранение недоступно.");
            var saveBanner = root.querySelector("[data-catalog-meta-banner]");
            if (saveBanner) saveBanner.innerHTML = renderMetaBanner(state.meta);
            return;
          }
          if (result.response.status === 422) {
            alert(result.data && result.data.message ? result.data.message : "Сохранение недоступно.");
            return;
          }
          if (result.response.status !== 200) {
            alert("Не удалось сохранить отметку.");
            return;
          }
          return loadDistributionSummary(outletCapture).then(function () {
            if (!isOutletContextCurrent(outletCapture)) return;
            if (state.view === "detail" && state.selectedCode === productCode) {
              loadDetail(productCode, outletCapture);
            } else {
              runCatalogQuery({ includeFacets: false, includeProducts: true });
            }
            var metaBanner = root.querySelector("[data-catalog-meta-banner]");
            if (metaBanner) metaBanner.innerHTML = renderMetaBanner(state.meta);
          });
        })
        .catch(function () {
          if (!isOutletContextCurrent(outletCapture)) return;
          state.markerSaving = false;
          alert("Ошибка сети при сохранении.");
        });
    }

    function selectOutlet(storeGuid) {
      var requested = storeGuid || null;
      if (requested === state.selectedStoreGuid && state.outletConfirmed) {
        return Promise.resolve();
      }
      var outletCapture = {
        gen: beginOutletContext(requested),
        storeGuid: requested || "",
      };
      beginOperation();
      state.page = 1;
      persistState();
      var metaBanner = root.querySelector("[data-catalog-meta-banner]");
      if (metaBanner) metaBanner.innerHTML = renderMetaBanner(state.meta);
      return api
        .apiRequest(
          buildApiUrl(
            state.clientGuid,
            "meta",
            outletCapture.storeGuid ? { storeGuid: outletCapture.storeGuid } : null,
          ),
        )
        .then(function (result) {
          if (!isOutletContextCurrent(outletCapture)) return;
          if (result.response.status === 403 || result.response.status === 404) {
            clearOutletSelection("Торговая точка недоступна для этой карточки.");
            handleAccessDenied();
            return;
          }
          if (result.response.status === 200 && result.data) {
            state.meta = result.data;
            applyMetaDistribution(result.data, outletCapture);
            if (result.data.versionId) applySnapshotVersion(result.data.versionId);
          }
          return loadDistributionSummary(outletCapture);
        })
        .then(function () {
          if (!isOutletContextCurrent(outletCapture)) return;
          if (metaBanner) metaBanner.innerHTML = renderMetaBanner(state.meta);
          if (state.distributionPanel === "catalog") {
            runCatalogQuery({ includeFacets: false, includeProducts: true });
          }
        })
        .catch(function () {
          if (!isOutletContextCurrent(outletCapture)) return;
          clearOutletSelection(null);
          showListMessage("Ошибка сети при переключении торговой точки.", "error", [
            { id: "retry-meta", label: "Повторить", ghost: false },
          ]);
        });
    }

    function renderListResult(body) {
      if (state.distributionPanel !== "catalog") {
        setResultsHtml(renderDistributionLists());
        return;
      }
      state.lastTotal = body.total || 0;
      updateResultsCount(body.total);
      if (body.state === "empty") {
        showListMessage(body.message || "Каталог пуст.", "empty");
        return;
      }
      if (!body.items || !body.items.length) {
        showListMessage("По запросу ничего не найдено.", "empty", [
          { id: "reset-filters", label: "Сбросить фильтры", ghost: true },
        ]);
        return;
      }
      var gridClass =
        state.viewMode === "list"
          ? "pc-catalog-list"
          : state.viewMode === "compact"
            ? "pc-catalog-grid pc-catalog-grid--compact"
            : "pc-catalog-grid pc-catalog-grid--large";
      var maxPage = Math.max(1, Math.ceil(body.total / body.pageSize));
      if (body.query !== undefined) state.query = body.query;
      setResultsHtml(
        '<div class="' +
          gridClass +
          '">' +
          body.items.map(renderProductCard).join("") +
          "</div>" +
          '<div class="pc-catalog-pagination">' +
          '<button type="button" class="pc-catalog-btn pc-catalog-btn--ghost" data-catalog-page-nav="prev"' +
          (body.page <= 1 ? " disabled" : "") +
          ">Назад</button>" +
          '<span class="pc-label">Страница ' +
          esc(String(body.page)) +
          " из " +
          esc(String(maxPage)) +
          " · " +
          esc(String(body.total)) +
          " товаров</span>" +
          '<button type="button" class="pc-catalog-btn pc-catalog-btn--ghost" data-catalog-page-nav="next"' +
          (body.page >= maxPage ? " disabled" : "") +
          ">Вперёд</button></div>",
      );
      if (state.scrollY) {
        window.scrollTo(0, state.scrollY);
        state.scrollY = 0;
      }
    }

    function renderDetailShell(contentHtml) {
      setHtml(
        renderHeader() +
          '<div class="pc-catalog-detail">' +
          '<div class="pc-catalog-detail__actions">' +
          '<button type="button" class="pc-link" data-catalog-back>← К списку</button>' +
          '<button type="button" class="pc-link" data-catalog-refresh>Обновить каталог</button></div>' +
          contentHtml +
          "</div>",
      );
    }

    function renderDetail(product, metaNote) {
      var groupLine = product.groupCode ? "Код группы: " + product.groupCode : "Группа не указана";
      var groupNote = groupStatusLabel(product.groupStatus);
      var articleLine = product.article
        ? '<div class="pc-field"><div class="pc-label">Артикул</div><div class="pc-value">' +
          esc(product.article) +
          "</div></div>"
        : "";
      var properties =
        product.properties && product.properties.length
          ? product.properties
              .map(function (property) {
                return (
                  '<div class="pc-field"><div class="pc-label">' +
                  esc(property.name || property.code) +
                  '</div><div class="pc-value">' +
                  esc(property.value || "—") +
                  "</div></div>"
                );
              })
              .join("")
          : '<div class="pc-unavailable">Свойства не переданы в снимке.</div>';
      var images =
        product.imageAssetIds && product.imageAssetIds.length
          ? product.imageAssetIds
              .map(function (assetId) {
                var src = buildApiUrl(state.clientGuid, "media/" + encodeURIComponent(assetId));
                return (
                  '<button type="button" class="pc-catalog-image pc-catalog-image--photo" data-catalog-zoom="' +
                  esc(src) +
                  '"><img src="' +
                  esc(src) +
                  '" alt="" loading="lazy" data-catalog-media-img /></button>'
                );
              })
              .join("")
          : product.imagePaths && product.imagePaths.length
            ? product.imagePaths
                .map(function () {
                  return renderImagePlaceholder("Просмотр изображения пока недоступен");
                })
                .join("")
            : renderImagePlaceholder("Изображения не переданы");
      renderDetailShell(
        '<div class="pc-grid pc-two">' +
          '<section class="pc-card"><div class="pc-cardhead"><h2>' +
          esc(product.name) +
          '</h2><span class="pc-source">Код 1С ' +
          esc(product.code) +
          '</span></div><div class="pc-pad">' +
          articleLine +
          '<div class="pc-field"><div class="pc-label">Группа</div><div class="pc-value">' +
          esc(groupLine) +
          "</div>" +
          (groupNote ? '<div class="pc-catalog-note">' + esc(groupNote) + "</div>" : "") +
          "</div>" +
          (product.sectionNames && product.sectionNames.length
            ? '<div class="pc-field"><div class="pc-label">Разделы</div><div class="pc-value">' +
              esc(product.sectionNames.join(", ")) +
              "</div></div>"
            : "") +
          '</div></section><section class="pc-card"><div class="pc-cardhead"><h2>Изображения</h2></div><div class="pc-pad pc-catalog-images">' +
          images +
          '</div></section></div><section class="pc-card pc-space"><div class="pc-cardhead"><h2>Характеристики</h2></div><div class="pc-pad">' +
          properties +
          '</div></section>' +
          renderDistributionActions(product.code, product.distribution) +
          (metaNote
            ? '<div class="pc-catalog-future"><p class="pc-label">' + esc(metaNote) + "</p></div>"
            : ""),
      );
    }

    function closeLightbox() {
      document.querySelectorAll(".pc-catalog-lightbox").forEach(function (node) {
        node.remove();
      });
      if (state.lightboxReturnFocus && root.contains(state.lightboxReturnFocus)) {
        try {
          state.lightboxReturnFocus.focus();
        } catch (_error) {
          /* ignore */
        }
      }
      state.lightboxReturnFocus = null;
    }

    function openLightbox(src, trigger) {
      closeLightbox();
      state.lightboxReturnFocus = trigger || document.activeElement;
      var overlay = document.createElement("div");
      overlay.className = "pc-catalog-lightbox";
      overlay.setAttribute("role", "dialog");
      overlay.setAttribute("aria-modal", "true");
      overlay.setAttribute("aria-label", "Просмотр изображения");
      overlay.innerHTML =
        '<div class="pc-catalog-lightbox__backdrop" data-lightbox-close></div>' +
        '<figure class="pc-catalog-lightbox__figure">' +
        '<button type="button" class="pc-catalog-lightbox__close" data-lightbox-close aria-label="Закрыть">×</button>' +
        '<img src="' +
        esc(src) +
        '" alt="" data-catalog-media-img /></figure>';
      document.body.appendChild(overlay);
      var closeBtn = overlay.querySelector(".pc-catalog-lightbox__close");
      if (closeBtn) closeBtn.focus();
      function onKeyDown(event) {
        if (event.key === "Escape") {
          event.preventDefault();
          closeLightbox();
        }
      }
      overlay.__catalogLightboxKeydown = onKeyDown;
      document.addEventListener("keydown", onKeyDown);
      overlay.querySelectorAll("[data-lightbox-close]").forEach(function (el) {
        el.addEventListener("click", function () {
          document.removeEventListener("keydown", onKeyDown);
          closeLightbox();
        });
      });
      overlay.addEventListener("remove", function () {
        document.removeEventListener("keydown", onKeyDown);
      });
    }

    function bindDelegationOnce() {
      if (state.delegationBound) return;
      state.delegationBound = true;

      root.addEventListener("submit", function (event) {
        var form = event.target.closest("[data-catalog-search-form]");
        if (!form || !root.contains(form)) return;
        event.preventDefault();
        var qInput = form.querySelector('[name="q"]');
        if (qInput) state.query = qInput.value.trim().slice(0, MAX_QUERY_LENGTH);
        state.page = 1;
        state.selectedCode = null;
        persistState();
        runCatalogQuery({ includeFacets: true, includeProducts: true });
      });

      root.addEventListener("change", function (event) {
        var select = event.target.closest("[data-catalog-outlet-select]");
        if (!select || !root.contains(select)) return;
        selectOutlet(select.value || null);
      });

      root.addEventListener("click", function (event) {
        var target = event.target.closest(
          "[data-section-code], [data-view-mode], [data-clear-filter], [data-catalog-action], [data-catalog-page-nav], [data-catalog-open], [data-catalog-zoom], [data-catalog-back], [data-catalog-refresh], [data-distribution-action], [data-distribution-panel]",
        );
        if (!target || !root.contains(target)) return;

        var distributionPanel = target.getAttribute("data-distribution-panel");
        if (distributionPanel) {
          state.distributionPanel = distributionPanel;
          if (distributionPanel === "catalog") {
            runCatalogQuery({ includeFacets: false, includeProducts: true });
          } else {
            loadDistributionSummary().then(function () {
              setResultsHtml(renderDistributionLists());
              var metaBanner = root.querySelector("[data-catalog-meta-banner]");
              if (metaBanner) metaBanner.innerHTML = renderMetaBanner(state.meta);
            });
          }
          return;
        }

        var distAction = target.getAttribute("data-distribution-action");
        if (distAction) {
          var productCode = target.getAttribute("data-product-code") || "";
          var markerKind = target.getAttribute("data-marker-kind") || "";
          if (productCode && markerKind) saveDistributionMarker(distAction, markerKind, productCode);
          return;
        }

        if (target.hasAttribute("data-section-code")) {
          state.sectionCode = target.getAttribute("data-section-code") || "";
          state.page = 1;
          persistState();
          runCatalogQuery({ includeFacets: true, includeProducts: true });
          return;
        }

        var viewMode = target.getAttribute("data-view-mode");
        if (viewMode) {
          if (!VALID_VIEW_MODES[viewMode]) return;
          state.viewMode = viewMode;
          persistState();
          refreshFilterChrome();
          if (state.facets) {
            setResultsHtml(renderState("Обновление вида…", "loading"));
            runCatalogQuery({ includeFacets: false, includeProducts: true });
          }
          return;
        }

        if (target.hasAttribute("data-clear-filter")) {
          var kind = target.getAttribute("data-clear-filter") || "";
          if (kind === "q") state.query = "";
          else if (kind === "section") state.sectionCode = "";
          else if (kind.indexOf("filter:") === 0) {
            var parts = kind.split(":");
            var key = parts[1];
            var value = parts.slice(2).join(":");
            var list = (state.propertyFilters[key] || []).filter(function (item) {
              return item !== value;
            });
            if (list.length) state.propertyFilters[key] = list;
            else delete state.propertyFilters[key];
          }
          state.page = 1;
          persistState();
          runCatalogQuery({ includeFacets: true, includeProducts: true });
          return;
        }

        var action = target.getAttribute("data-catalog-action");
        if (action) {
          if (action === "retry-meta") loadAll(true);
          if (action === "retry-list") runCatalogQuery({ includeFacets: true, includeProducts: true });
          if (action === "retry-detail" && state.selectedCode) loadDetail(state.selectedCode);
          if (action === "refresh") refreshCatalog();
          if (action === "back") goBackToList();
          if (action === "first-page") {
            state.page = 1;
            runCatalogQuery({ includeFacets: false, includeProducts: true });
          }
          if (action === "reset-filters") {
            state.query = "";
            state.sectionCode = "";
            state.propertyFilters = {};
            state.facetExtras = {};
            state.page = 1;
            persistState();
            runCatalogQuery({ includeFacets: true, includeProducts: true });
          }
          if (action === "toggle-filters") {
            state.filtersExpanded = !state.filtersExpanded;
            refreshFilterChrome();
          }
          if (action === "confirm-outlet" && state.outlets.length === 1) {
            selectOutlet(state.outlets[0].guidStore);
          }
          return;
        }

        var pageNav = target.getAttribute("data-catalog-page-nav");
        if (pageNav) {
          var maxPage = Math.max(1, Math.ceil((state.lastTotal || 0) / state.pageSize));
          if (pageNav === "prev" && state.page > 1) {
            state.page -= 1;
            persistState();
            runCatalogQuery({ includeFacets: false, includeProducts: true });
          }
          if (pageNav === "next" && state.page < maxPage) {
            state.page += 1;
            persistState();
            runCatalogQuery({ includeFacets: false, includeProducts: true });
          }
          return;
        }

        var productCode = target.getAttribute("data-catalog-open");
        if (productCode) {
          state.scrollY = window.scrollY;
          persistState();
          state.selectedCode = productCode;
          state.view = "detail";
          loadDetail(productCode);
          return;
        }

        var zoomSrc = target.getAttribute("data-catalog-zoom");
        if (zoomSrc) {
          openLightbox(zoomSrc, target);
          return;
        }

        var facetMore = target.getAttribute("data-facet-more");
        if (facetMore) {
          var extra = state.facetExtras[facetMore] || {};
          loadFacetValues(facetMore, extra.q || "", (extra.offset || 0) + 100, true);
          return;
        }

        if (target.hasAttribute("data-catalog-back")) {
          goBackToList();
          return;
        }
        if (target.hasAttribute("data-catalog-refresh")) {
          refreshCatalog();
        }
      });

      var facetSearchTimer = null;
      root.addEventListener("input", function (event) {
        var searchInput = event.target.closest("[data-facet-search]");
        if (!searchInput || !root.contains(searchInput)) return;
        var facetKey = searchInput.getAttribute("data-facet-search");
        if (!facetKey) return;
        clearTimeout(facetSearchTimer);
        facetSearchTimer = setTimeout(function () {
          loadFacetValues(facetKey, searchInput.value.trim(), 0, false);
        }, 300);
      });

      root.addEventListener(
        "error",
        function (event) {
          var img = event.target;
          if (!img || img.tagName !== "IMG" || !img.hasAttribute("data-catalog-media-img")) return;
          if (!root.contains(img) && !img.closest(".pc-catalog-lightbox")) return;
          img.removeAttribute("src");
          img.classList.add("pc-catalog-image--broken");
          var parent = img.closest(".pc-catalog-image");
          if (parent) {
            parent.classList.add("pc-catalog-image--broken-fallback");
            parent.setAttribute("aria-label", "Изображение недоступно");
            parent.removeAttribute("data-catalog-zoom");
          }
        },
        true,
      );

      root.addEventListener("change", function (event) {
        var input = event.target.closest("[data-filter-key]");
        if (!input || !root.contains(input)) return;
        var key = input.getAttribute("data-filter-key");
        var value = input.getAttribute("data-filter-value");
        if (!key || !value) return;
        var list = state.propertyFilters[key] ? state.propertyFilters[key].slice() : [];
        if (input.checked) {
          if (list.indexOf(value) < 0) list.push(value);
        } else {
          list = list.filter(function (item) {
            return item !== value;
          });
        }
        if (list.length) state.propertyFilters[key] = list;
        else delete state.propertyFilters[key];
        state.page = 1;
        persistState();
        runCatalogQuery({ includeFacets: true, includeProducts: true });
      });
    }

    function invalidateDetailRequests() {
      state.detailLoadId += 1;
      state.selectedCode = null;
      state.view = "list";
    }

    function isDetailResponseCurrent(detailLoadId, code, outletCapture) {
      return (
        detailLoadId === state.detailLoadId &&
        state.view === "detail" &&
        state.selectedCode === code &&
        (!outletCapture || isOutletContextCurrent(outletCapture)) &&
        root.isConnected
      );
    }

    function goBackToList() {
      invalidateDetailRequests();
      ensureListLayout();
      runCatalogQuery({ includeFacets: true, includeProducts: true });
    }

    function refreshCatalog() {
      if (state.refreshing) return;
      state.refreshing = true;
      state.selectedCode = null;
      state.view = "list";
      Promise.resolve(loadAll(true)).finally(function () {
        state.refreshing = false;
      });
    }

    function clearProtectedState() {
      closeLightbox();
      clearSessionState(clientGuid);
      writeSelectedOutlet(clientGuid, "");
      invalidateFacetRequests();
      state.meta = null;
      state.versionId = null;
      state.sectionTree = [];
      state.facets = null;
      state.propertyFilters = {};
      state.query = "";
      state.sectionCode = "";
      state.page = 1;
      state.selectedCode = null;
      state.lastTotal = 0;
      state.layoutReady = false;
      state.filtersExpanded = false;
    }

    function handleAccessDenied() {
      invalidateDetailRequests();
      clearProtectedState();
      setHtml(
        renderHeader() +
          renderState("Каталог недоступен для этой карточки.", "error") +
          '<div class="pc-catalog-actions"><button type="button" class="pc-catalog-btn" data-catalog-action="retry-meta">Повторить</button></div>',
      );
    }

    function handleVersionConflict(message) {
      showListMessage(message || "Каталог обновился. Обновите данные.", "error", [
        { id: "refresh", label: "Обновить каталог", ghost: false },
      ]);
    }

    function isCurrentOp(opId) {
      return opId === state.opId && root.isConnected;
    }

    function beginOperation() {
      return ++state.opId;
    }

    function applySnapshotVersion(versionId) {
      if (!versionId) return;
      state.versionId = versionId;
      if (state.meta) state.meta.versionId = versionId;
    }

    function confirmCatalogAccess(detailLoadId) {
      var metaQuery = state.selectedStoreGuid ? { storeGuid: state.selectedStoreGuid } : null;
      return api.apiRequest(buildApiUrl(state.clientGuid, "meta", metaQuery)).then(function (metaResult) {
        if (detailLoadId !== state.detailLoadId || !root.isConnected) return { kind: "stale" };
        if (metaResult.response.status === 403 || metaResult.response.status === 404) {
          return { kind: "denied" };
        }
        if (metaResult.response.status === 200 && metaResult.data) {
          state.meta = metaResult.data;
          applyMetaDistribution(metaResult.data, captureOutletContext());
          if (metaResult.data.versionId) state.versionId = metaResult.data.versionId;
          return { kind: "allowed" };
        }
        return { kind: "denied" };
      });
    }

    function handleCatalogResponseStatus(result, opId) {
      if (!isCurrentOp(opId)) return "stale";
      if (result.response.status === 403 || result.response.status === 404) {
        handleAccessDenied();
        return "stop";
      }
      if (result.response.status === 409 && result.data) {
        handleVersionConflict(result.data.message);
        return "stop";
      }
      if (result.response.status === 422 && result.data) {
        showListMessage(
          result.data.message || "Выбранный фильтр недоступен в текущем снимке.",
          "error",
          [{ id: "reset-filters", label: "Сбросить фильтры", ghost: true }],
        );
        return "stop";
      }
      return "ok";
    }

    function fetchSectionsTree(opId) {
      return api
        .apiRequest(
          buildApiUrl(state.clientGuid, "sections-tree", { versionId: state.versionId }),
        )
        .then(function (result) {
          var status = handleCatalogResponseStatus(result, opId);
          if (status !== "ok") return status;
          if (result.response.status !== 200 || !result.data || !result.data.tree) {
            showListMessage("Не удалось загрузить разделы каталога.", "error", [
              { id: "retry-list", label: "Повторить", ghost: false },
            ]);
            return "stop";
          }
          state.sectionTree = result.data.tree;
          if (result.data.versionId) applySnapshotVersion(result.data.versionId);
          return "ok";
        })
        .catch(function () {
          if (!isCurrentOp(opId)) return "stale";
          showListMessage("Ошибка сети при загрузке разделов.", "error", [
            { id: "retry-list", label: "Повторить", ghost: false },
          ]);
          return "stop";
        });
    }

    function fetchFacets(opId) {
      return api
        .apiRequest(buildApiUrl(state.clientGuid, "facets", buildListQuery(state)))
        .then(function (result) {
          var status = handleCatalogResponseStatus(result, opId);
          if (status !== "ok") return status;
          if (result.response.status !== 200 || !result.data) {
            showListMessage("Не удалось загрузить фильтры.", "error", [
              { id: "retry-list", label: "Повторить", ghost: false },
            ]);
            return "stop";
          }
          state.facets = result.data;
          if (result.data.versionId) applySnapshotVersion(result.data.versionId);
          refreshFilterChrome();
          return "ok";
        })
        .catch(function () {
          if (!isCurrentOp(opId)) return "stale";
          showListMessage("Не удалось загрузить фильтры.", "error", [
            { id: "retry-list", label: "Повторить", ghost: false },
          ]);
          return "stop";
        });
    }

    function loadFacetValues(facetKey, q, offset, append) {
      if (!state.facetRequestGen[facetKey]) state.facetRequestGen[facetKey] = 0;
      var requestGen = ++state.facetRequestGen[facetKey];
      var captureOpId = state.opId;
      var captureContext = serializeCatalogContext();
      var requestQuery = buildListQuery(state);
      requestQuery.facetKey = facetKey;
      requestQuery.facetQ = q;
      requestQuery.facetOffset = offset || 0;
      state.facetExtras[facetKey] = Object.assign({}, state.facetExtras[facetKey] || {}, {
        q: q,
        loading: true,
        error: "",
      });
      refreshFilterChrome();

      function isFacetResponseCurrent() {
        return (
          requestGen === state.facetRequestGen[facetKey] &&
          captureOpId === state.opId &&
          captureContext === serializeCatalogContext() &&
          root.isConnected
        );
      }

      return api
        .apiRequest(buildApiUrl(state.clientGuid, "facet-values", requestQuery))
        .then(function (result) {
          if (!isFacetResponseCurrent()) return;
          if (result.response.status === 403 || result.response.status === 404) {
            invalidateFacetRequests();
            handleAccessDenied();
            return;
          }
          if (result.response.status === 409 && result.data) {
            handleVersionConflict(result.data.message);
            return;
          }
          if (result.response.status !== 200 || !result.data) {
            state.facetExtras[facetKey] = Object.assign({}, state.facetExtras[facetKey] || {}, {
              loading: false,
              error: "Не удалось найти значения.",
            });
            refreshFilterChrome();
            return;
          }
          if (result.data.versionId) applySnapshotVersion(result.data.versionId);
          var previous =
            append && state.facetExtras[facetKey] && captureContext === serializeCatalogContext()
              ? state.facetExtras[facetKey].values || []
              : [];
          var merged = previous.slice();
          (result.data.values || []).forEach(function (entry) {
            if (merged.some(function (item) { return item.value === entry.value; })) return;
            merged.push(entry);
          });
          state.facetExtras[facetKey] = {
            q: q,
            values: merged,
            offset: result.data.offset,
            hasMore: result.data.hasMore,
            loading: false,
            error: "",
          };
          refreshFilterChrome();
        })
        .catch(function () {
          if (!isFacetResponseCurrent()) return;
          state.facetExtras[facetKey] = Object.assign({}, state.facetExtras[facetKey] || {}, {
            loading: false,
            error: "Ошибка сети при поиске значений.",
          });
          refreshFilterChrome();
        });
    }

    function fetchProducts(opId) {
      return api
        .apiRequest(buildApiUrl(state.clientGuid, "products", buildListQuery(state)))
        .then(function (result) {
          var status = handleCatalogResponseStatus(result, opId);
          if (status !== "ok") return status;
          if (result.response.status !== 200 || !result.data) {
            showListMessage("Не удалось загрузить каталог.", "error", [
              { id: "retry-list", label: "Повторить", ghost: false },
            ]);
            return "stop";
          }
          if (result.data.versionId) applySnapshotVersion(result.data.versionId);
          ensureListLayout();
          renderListResult(result.data);
          refreshFilterChrome();
          return "ok";
        })
        .catch(function () {
          if (!isCurrentOp(opId)) return "stale";
          showListMessage("Ошибка сети при загрузке каталога.", "error", [
            { id: "retry-list", label: "Повторить", ghost: false },
          ]);
          return "stop";
        });
    }

    function runCatalogQuery(options) {
      var opId = beginOperation();
      invalidateFacetRequests();
      var includeFacets = options.includeFacets !== false;
      var includeProducts = options.includeProducts !== false;
      persistState();
      if (includeProducts) {
        ensureListLayout(renderState("Загрузка…", "loading"));
      } else {
        refreshFilterChrome();
      }

      var chain = Promise.resolve("ok");
      if (!state.sectionTree.length) {
        chain = chain.then(function (step) {
          if (step !== "ok" || !isCurrentOp(opId)) return step === "ok" ? "stale" : step;
          return fetchSectionsTree(opId);
        });
      }
      if (includeFacets) {
        chain = chain.then(function (step) {
          if (step !== "ok" || !isCurrentOp(opId)) return step === "ok" ? "stale" : step;
          return fetchFacets(opId);
        });
      }
      if (includeProducts) {
        chain = chain.then(function (step) {
          if (step !== "ok" || !isCurrentOp(opId)) return step === "ok" ? "stale" : step;
          return fetchProducts(opId);
        });
      }
      return chain;
    }

    function loadDetail(code, outletCapture) {
      var detailLoadId = ++state.detailLoadId;
      var capture = outletCapture || captureOutletContext();
      state.view = "detail";
      state.selectedCode = code;
      renderDetailShell(renderState("Загрузка товара…", "loading"));
      var listQuery = buildListQuery(state);
      if (capture.storeGuid) listQuery.storeGuid = capture.storeGuid;
      return api
        .apiRequest(
          buildApiUrl(state.clientGuid, "products/" + encodeURIComponent(code), listQuery),
        )
        .then(function (result) {
          if (!isDetailResponseCurrent(detailLoadId, code, capture)) return;
          if (result.response.status === 403 || result.response.status === 404) {
            return confirmCatalogAccess(detailLoadId).then(function (access) {
              if (!isDetailResponseCurrent(detailLoadId, code, capture)) return;
              if (access.kind === "denied") {
                handleAccessDenied();
                return;
              }
              if (result.response.status === 404) {
                renderDetailShell(
                  renderState("Товар не найден в текущем снимке.", "empty") +
                    '<div class="pc-catalog-actions"><button type="button" class="pc-catalog-btn pc-catalog-btn--ghost" data-catalog-action="back">← К списку</button></div>',
                );
              }
            });
          }
          if (result.response.status === 409 && result.data) {
            renderDetailShell(
              renderState(result.data.message || "Каталог обновился.", "error") +
                '<div class="pc-catalog-actions"><button type="button" class="pc-catalog-btn" data-catalog-action="refresh">Обновить каталог</button></div>',
            );
            return;
          }
          if (result.response.status !== 200 || !result.data || !result.data.product) {
            renderDetailShell(
              renderState("Не удалось загрузить товар.", "error") +
                '<div class="pc-catalog-actions"><button type="button" class="pc-catalog-btn" data-catalog-action="retry-detail">Повторить</button></div>',
            );
            return;
          }
          applySnapshotVersion(result.data.product.versionId);
          if (!isDetailResponseCurrent(detailLoadId, code, capture)) return;
          renderDetail(result.data.product, result.data.futureActionsBlockedReason);
        })
        .catch(function () {
          if (!isDetailResponseCurrent(detailLoadId, code, capture)) return;
          renderDetailShell(
            renderState("Ошибка сети при загрузке товара.", "error") +
              '<div class="pc-catalog-actions"><button type="button" class="pc-catalog-btn" data-catalog-action="retry-detail">Повторить</button></div>',
          );
        });
    }

    function loadAll(reloadList) {
      var opId = beginOperation();
      var savedOutlet = readSelectedOutlet(clientGuid) || "";
      if (savedOutlet && !state.selectedStoreGuid) {
        state.selectedStoreGuid = savedOutlet;
      }
      var outletCapture = captureOutletContext();
      var metaQuery = outletCapture.storeGuid ? { storeGuid: outletCapture.storeGuid } : null;
      state.layoutReady = false;
      setHtml(renderHeader() + renderState("Загрузка каталога…", "loading"));
      return api
        .apiRequest(buildApiUrl(state.clientGuid, "meta", metaQuery))
        .then(function (result) {
          if (!isCurrentOp(opId) || !isOutletContextCurrent(outletCapture)) return;
          if (result.response.status === 403 || result.response.status === 404) {
            handleAccessDenied();
            return;
          }
          if (result.response.status !== 200 || !result.data) {
            setHtml(
              renderHeader() +
                renderState("Не удалось загрузить каталог.", "error") +
                '<div class="pc-catalog-actions"><button type="button" class="pc-catalog-btn" data-catalog-action="retry-meta">Повторить</button></div>',
            );
            return;
          }
          state.meta = result.data;
          applyMetaDistribution(result.data, outletCapture);
          applySnapshotVersion(result.data.versionId);
          if (result.data.state !== "ready") {
            setHtml(renderHeader() + renderMetaBanner(result.data));
            return;
          }
          return loadDistributionSummary(outletCapture).then(function () {
            if (!isOutletContextCurrent(outletCapture)) return;
            if (reloadList === false) return;
            return fetchSectionsTree(opId).then(function (step) {
            if (step !== "ok" || !isCurrentOp(opId) || !isOutletContextCurrent(outletCapture)) return;
            return runCatalogQuery({ includeFacets: true, includeProducts: true });
            });
          });
        })
        .catch(function () {
          if (!isCurrentOp(opId)) return;
          setHtml(
            renderHeader() +
              renderState("Ошибка сети.", "error") +
              '<div class="pc-catalog-actions"><button type="button" class="pc-catalog-btn" data-catalog-action="retry-meta">Повторить</button></div>',
          );
        });
    }

    loadAll(true);
  }

  function renderShowcaseEntry(clientGuid) {
    return (
      '<div class="pc-catalog-workspace-entry">' +
      '<p class="pc-label">Выберите торговую точку и отметьте образцы «Установлено» / «Нужно поставить» в расширенном каталоге.</p>' +
      '<a class="pc-catalog-btn" href="/clients/' +
      encodeURIComponent(clientGuid) +
      '/catalog">Открыть каталог образцов</a></div>'
    );
  }

  window.ClientCatalogWorkspace = {
    mount: mountWorkspace,
    renderShowcaseEntry: renderShowcaseEntry,
  };
})();
