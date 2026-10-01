(function () {
  "use strict";

  var api = window.TandoorRf;
  var MAX_QUERY_LENGTH = 200;
  var VIEW_MODE_KEY = "tandoor-catalog-view-mode";
  var VALID_VIEW_MODES = { large: true, compact: true, list: true };

  function esc(value) {
    return window.ClientDetailSections.escapeHtml(value || "");
  }

  function sessionKey(clientGuid) {
    return "tandoor-catalog-workspace-" + clientGuid;
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
      if (val !== undefined && val !== null && val !== "") {
        if (Array.isArray(val)) {
          if (val.length) params.set(key, val.join(","));
        } else {
          params.set(key, String(val));
        }
      }
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
    Object.keys(state.propertyFilters || {}).forEach(function (key) {
      var values = state.propertyFilters[key];
      if (values && values.length) query[filterParamKey(key)] = values.join(",");
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
        '" alt="" loading="lazy" /></button>'
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
      loadId: 0,
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
    };

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

    function renderOutletNotice(meta) {
      var reason =
        (meta && meta.futureActionsBlockedReason) ||
        "Просмотр каталога. Сохранение дистрибуции станет доступно после подключения торговой точки.";
      return (
        '<div class="pc-catalog-meta pc-catalog-outlet-notice">' +
        '<p class="pc-label">' +
        esc(reason) +
        "</p></div>"
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
        renderOutletNotice(meta) +
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
          var values = group.values
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
          return (
            '<fieldset class="pc-catalog-facet"><legend>' +
            esc(group.label) +
            "</legend>" +
            values +
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
        '<button type="button" class="pc-link" data-catalog-open="' +
        esc(item.code) +
        '">Подробнее</button></div></article>'
      );
    }

    function renderListShell(resultsHtml) {
      setHtml(
        renderHeader() +
          renderMetaBanner(state.meta) +
          '<div class="pc-catalog-workspace-layout">' +
          renderFiltersPanel() +
          '<div class="pc-catalog-workspace-main">' +
          renderToolbar() +
          '<div class="pc-catalog-results-count pc-label" data-results-count></div>' +
          '<div class="pc-catalog-results" data-catalog-results aria-live="polite">' +
          (resultsHtml || renderState("Загрузка каталога…", "loading")) +
          "</div></div></div>",
      );
      bindShellEvents();
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
      if (!setResultsHtml(html)) renderListShell(html);
      bindActionButtons();
    }

    function renderListResult(body) {
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
      setResultsHtml(
        '<div class="' +
          gridClass +
          '">' +
          body.items.map(renderProductCard).join("") +
          "</div>" +
          '<div class="pc-catalog-pagination">' +
          '<button type="button" class="pc-catalog-btn pc-catalog-btn--ghost" data-catalog-page-nav="prev">Назад</button>' +
          '<span class="pc-label">Страница ' +
          esc(String(body.page)) +
          " из " +
          esc(String(maxPage)) +
          " · " +
          esc(String(body.total)) +
          " товаров</span>" +
          '<button type="button" class="pc-catalog-btn pc-catalog-btn--ghost" data-catalog-page-nav="next">Вперёд</button></div>',
      );
      bindProductCards();
      bindPagination(body.total);
      bindZoomButtons();
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
      bindDetailActions();
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
                  '" alt="" loading="lazy" /></button>'
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
          '</div></section><div class="pc-catalog-future"><p class="pc-label">' +
          esc(
            metaNote ||
              "Просмотр каталога. Сохранение дистрибуции станет доступно после подключения торговой точки.",
          ) +
          "</p></div>",
      );
      bindZoomButtons();
    }

    function openLightbox(src) {
      var overlay = document.createElement("div");
      overlay.className = "pc-catalog-lightbox";
      overlay.innerHTML =
        '<div class="pc-catalog-lightbox__backdrop" data-lightbox-close></div>' +
        '<figure class="pc-catalog-lightbox__figure">' +
        '<button type="button" class="pc-catalog-lightbox__close" data-lightbox-close aria-label="Закрыть">×</button>' +
        '<img src="' +
        esc(src) +
        '" alt="" /></figure>';
      document.body.appendChild(overlay);
      overlay.querySelectorAll("[data-lightbox-close]").forEach(function (el) {
        el.addEventListener("click", function () {
          overlay.remove();
        });
      });
    }

    function bindZoomButtons() {
      root.querySelectorAll("[data-catalog-zoom]").forEach(function (button) {
        button.addEventListener("click", function () {
          var src = button.getAttribute("data-catalog-zoom");
          if (src) openLightbox(src);
        });
      });
    }

    function bindActionButtons() {
      root.querySelectorAll("[data-catalog-action]").forEach(function (button) {
        button.addEventListener("click", function () {
          var action = button.getAttribute("data-catalog-action");
          if (action === "retry-meta") loadAll(true);
          if (action === "retry-list") loadList();
          if (action === "retry-detail" && state.selectedCode) loadDetail(state.selectedCode);
          if (action === "refresh") refreshCatalog();
          if (action === "back") goBackToList();
          if (action === "first-page") {
            state.page = 1;
            loadList();
          }
          if (action === "reset-filters") {
            state.query = "";
            state.sectionCode = "";
            state.propertyFilters = {};
            state.page = 1;
            persistState();
            loadFacets().then(loadList);
          }
        });
      });
    }

    function bindShellEvents() {
      bindSearchForm();
      bindSectionTree();
      bindFacetInputs();
      bindViewModes();
      bindActiveFilterChips();
      bindActionButtons();
    }

    function bindSearchForm() {
      var form = root.querySelector("[data-catalog-search-form]");
      if (!form) return;
      form.addEventListener("submit", function (event) {
        event.preventDefault();
        var qInput = form.querySelector('[name="q"]');
        if (qInput) state.query = qInput.value.trim().slice(0, MAX_QUERY_LENGTH);
        state.page = 1;
        state.selectedCode = null;
        persistState();
        loadFacets().then(loadList);
      });
    }

    function bindSectionTree() {
      root.querySelectorAll("[data-section-code]").forEach(function (button) {
        button.addEventListener("click", function () {
          state.sectionCode = button.getAttribute("data-section-code") || "";
          state.page = 1;
          persistState();
          loadFacets().then(loadList);
        });
      });
    }

    function bindFacetInputs() {
      root.querySelectorAll("[data-filter-key]").forEach(function (input) {
        input.addEventListener("change", function () {
          var key = input.getAttribute("data-filter-key");
          var value = input.getAttribute("data-filter-value");
          if (!key || !value) return;
          var list = state.propertyFilters[key] ? state.propertyFilters[key].slice() : [];
          if (input.checked) {
            if (list.indexOf(value) < 0) list.push(value);
          } else {
            list = list.filter(function (v) {
              return v !== value;
            });
          }
          if (list.length) state.propertyFilters[key] = list;
          else delete state.propertyFilters[key];
          state.page = 1;
          persistState();
          loadFacets().then(loadList);
        });
      });
    }

    function bindViewModes() {
      root.querySelectorAll("[data-view-mode]").forEach(function (button) {
        button.addEventListener("click", function () {
          var mode = button.getAttribute("data-view-mode");
          if (!VALID_VIEW_MODES[mode]) return;
          state.viewMode = mode;
          persistState();
          renderListShell(renderState("Обновление вида…", "loading"));
          loadList();
        });
      });
    }

    function bindActiveFilterChips() {
      root.querySelectorAll("[data-clear-filter]").forEach(function (button) {
        button.addEventListener("click", function () {
          var kind = button.getAttribute("data-clear-filter") || "";
          if (kind === "q") state.query = "";
          else if (kind === "section") state.sectionCode = "";
          else if (kind.indexOf("filter:") === 0) {
            var parts = kind.split(":");
            var key = parts[1];
            var value = parts.slice(2).join(":");
            var list = (state.propertyFilters[key] || []).filter(function (v) {
              return v !== value;
            });
            if (list.length) state.propertyFilters[key] = list;
            else delete state.propertyFilters[key];
          }
          state.page = 1;
          persistState();
          loadFacets().then(loadList);
        });
      });
    }

    function bindPagination(total) {
      var maxPage = Math.max(1, Math.ceil(total / state.pageSize));
      root.querySelectorAll("[data-catalog-page-nav]").forEach(function (button) {
        var direction = button.getAttribute("data-catalog-page-nav");
        button.disabled = direction === "prev" ? state.page <= 1 : state.page >= maxPage;
        button.addEventListener("click", function () {
          if (direction === "prev" && state.page > 1) {
            state.page -= 1;
            persistState();
            loadList();
          }
          if (direction === "next" && state.page < maxPage) {
            state.page += 1;
            persistState();
            loadList();
          }
        });
      });
    }

    function bindProductCards() {
      root.querySelectorAll("[data-catalog-open]").forEach(function (button) {
        button.addEventListener("click", function () {
          var code = button.getAttribute("data-catalog-open");
          if (!code) return;
          state.scrollY = window.scrollY;
          persistState();
          state.selectedCode = code;
          state.view = "detail";
          loadDetail(code);
        });
      });
    }

    function bindDetailActions() {
      var back = root.querySelector("[data-catalog-back]");
      if (back) back.addEventListener("click", goBackToList);
      var refresh = root.querySelector("[data-catalog-refresh]");
      if (refresh) refresh.addEventListener("click", refreshCatalog);
      bindActionButtons();
    }

    function goBackToList() {
      state.view = "list";
      state.selectedCode = null;
      renderListShell();
      loadFacets().then(loadList);
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

    function handleAccessDenied() {
      state.meta = null;
      state.versionId = null;
      setHtml(
        renderHeader() +
          renderState("Каталог недоступен для этой карточки.", "error") +
          '<div class="pc-catalog-actions"><button type="button" class="pc-catalog-btn" data-catalog-action="retry-meta">Повторить</button></div>',
      );
      bindActionButtons();
    }

    function handleVersionConflict(message) {
      showListMessage(message || "Каталог обновился. Обновите данные.", "error", [
        { id: "refresh", label: "Обновить каталог", ghost: false },
      ]);
    }

    function confirmCatalogAccess(loadId) {
      return api.apiRequest(buildApiUrl(state.clientGuid, "meta")).then(function (metaResult) {
        if (loadId !== state.loadId || !root.isConnected) return { kind: "stale" };
        if (metaResult.response.status === 403 || metaResult.response.status === 404) {
          return { kind: "denied" };
        }
        if (metaResult.response.status === 200 && metaResult.data) {
          state.meta = metaResult.data;
          if (metaResult.data.versionId) state.versionId = metaResult.data.versionId;
          return { kind: "allowed" };
        }
        return { kind: "denied" };
      });
    }

    function loadFacets() {
      var loadId = ++state.loadId;
      return api
        .apiRequest(buildApiUrl(state.clientGuid, "facets", buildListQuery(state)))
        .then(function (result) {
          if (loadId !== state.loadId || !root.isConnected) return;
          if (result.response.status === 409) {
            handleVersionConflict(result.data && result.data.message);
            return;
          }
          if (result.response.status === 200 && result.data) {
            state.facets = result.data;
            if (result.data.versionId) state.versionId = result.data.versionId;
          }
        })
        .catch(function () {
          /* facets are optional for list */
        });
    }

    function loadList() {
      var loadId = ++state.loadId;
      if (state.view === "list" && root.querySelector("[data-catalog-results]")) {
        setResultsHtml(renderState("Загрузка…", "loading"));
      } else {
        renderListShell(renderState("Загрузка…", "loading"));
      }
      persistState();
      return api
        .apiRequest(buildApiUrl(state.clientGuid, "products", buildListQuery(state)))
        .then(function (result) {
          if (loadId !== state.loadId || !root.isConnected) return;
          if (result.response.status === 403 || result.response.status === 404) {
            handleAccessDenied();
            return;
          }
          if (result.response.status === 409 && result.data) {
            handleVersionConflict(result.data.message);
            return;
          }
          if (result.response.status !== 200 || !result.data) {
            showListMessage("Не удалось загрузить каталог.", "error", [
              { id: "retry-list", label: "Повторить", ghost: false },
            ]);
            return;
          }
          if (result.data.versionId) state.versionId = result.data.versionId;
          if (state.view === "list" && !root.querySelector("[data-catalog-results]")) {
            renderListShell();
          }
          renderListResult(result.data);
          bindShellEvents();
        })
        .catch(function () {
          if (loadId !== state.loadId || !root.isConnected) return;
          showListMessage("Ошибка сети при загрузке каталога.", "error", [
            { id: "retry-list", label: "Повторить", ghost: false },
          ]);
        });
    }

    function loadDetail(code) {
      var loadId = ++state.loadId;
      renderDetailShell(renderState("Загрузка товара…", "loading"));
      return api
        .apiRequest(
          buildApiUrl(state.clientGuid, "products/" + encodeURIComponent(code), {
            versionId: state.versionId,
          }),
        )
        .then(function (result) {
          if (loadId !== state.loadId || !root.isConnected) return;
          if (result.response.status === 403) {
            handleAccessDenied();
            return;
          }
          if (result.response.status === 404) {
            return confirmCatalogAccess(loadId).then(function (access) {
              if (access.kind === "stale") return;
              if (access.kind === "denied") {
                handleAccessDenied();
                return;
              }
              renderDetailShell(
                renderState("Товар не найден в текущем снимке.", "empty") +
                  '<div class="pc-catalog-actions"><button type="button" class="pc-catalog-btn pc-catalog-btn--ghost" data-catalog-action="back">← К списку</button></div>',
              );
              bindActionButtons();
            });
          }
          if (result.response.status === 409 && result.data) {
            renderDetailShell(
              renderState(result.data.message || "Каталог обновился.", "error") +
                '<div class="pc-catalog-actions"><button type="button" class="pc-catalog-btn" data-catalog-action="refresh">Обновить каталог</button></div>',
            );
            bindActionButtons();
            return;
          }
          if (result.response.status !== 200 || !result.data || !result.data.product) {
            renderDetailShell(
              renderState("Не удалось загрузить товар.", "error") +
                '<div class="pc-catalog-actions"><button type="button" class="pc-catalog-btn" data-catalog-action="retry-detail">Повторить</button></div>',
            );
            bindActionButtons();
            return;
          }
          state.versionId = result.data.product.versionId;
          renderDetail(result.data.product, result.data.futureActionsBlockedReason);
        })
        .catch(function () {
          if (loadId !== state.loadId || !root.isConnected) return;
          renderDetailShell(
            renderState("Ошибка сети при загрузке товара.", "error") +
              '<div class="pc-catalog-actions"><button type="button" class="pc-catalog-btn" data-catalog-action="retry-detail">Повторить</button></div>',
          );
          bindActionButtons();
        });
    }

    function loadSectionsTree() {
      return api
        .apiRequest(
          buildApiUrl(state.clientGuid, "sections-tree", { versionId: state.versionId }),
        )
        .then(function (result) {
          if (result.response.status === 200 && result.data && result.data.tree) {
            state.sectionTree = result.data.tree;
          }
        })
        .catch(function () {
          /* optional */
        });
    }

    function loadAll(reloadList) {
      var loadId = ++state.loadId;
      setHtml(renderHeader() + renderState("Загрузка каталога…", "loading"));
      return api
        .apiRequest(buildApiUrl(state.clientGuid, "meta"))
        .then(function (result) {
          if (loadId !== state.loadId || !root.isConnected) return;
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
            bindActionButtons();
            return;
          }
          state.meta = result.data;
          if (result.data.versionId) state.versionId = result.data.versionId;
          if (result.data.state !== "ready") {
            setHtml(renderHeader() + renderMetaBanner(result.data));
            return;
          }
          return loadSectionsTree()
            .then(loadFacets)
            .then(function () {
              renderListShell();
              if (reloadList !== false) return loadList();
            });
        })
        .catch(function () {
          if (loadId !== state.loadId || !root.isConnected) return;
          setHtml(
            renderHeader() +
              renderState("Ошибка сети.", "error") +
              '<div class="pc-catalog-actions"><button type="button" class="pc-catalog-btn" data-catalog-action="retry-meta">Повторить</button></div>',
          );
          bindActionButtons();
        });
    }

    loadAll(true);
  }

  function renderShowcaseEntry(clientGuid) {
    return (
      '<div class="pc-catalog-workspace-entry">' +
      '<p class="pc-label">Для выбора образцов откройте расширенный каталог с фильтрами и режимами отображения.</p>' +
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
