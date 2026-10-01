(function () {
  "use strict";

  var api = window.TandoorRf;
  var MAX_QUERY_LENGTH = 200;

  function esc(value) {
    return window.ClientDetailSections.escapeHtml(value || "");
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

  function renderImagePlaceholder(label) {
    return (
      '<div class="pc-catalog-image pc-catalog-image--placeholder" aria-hidden="true">' +
      '<span>' +
      esc(label || "Изображение недоступно") +
      "</span></div>"
    );
  }

  function listImagePlaceholder(item) {
    if (!item.primaryImagePath) {
      return renderImagePlaceholder("Изображение не передано");
    }
    return renderImagePlaceholder("Просмотр изображения пока недоступен");
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
      if (query[key] !== undefined && query[key] !== null && query[key] !== "") {
        params.set(key, String(query[key]));
      }
    });
    var qs = params.toString();
    return qs ? url + "?" + qs : url;
  }

  function mountShowcaseTab(root, clientGuid) {
    var container = root.querySelector("#pc-catalog-showcase");
    if (!container || !api) return Promise.resolve({ ok: false });

    var state = {
      loadId: 0,
      clientGuid: clientGuid,
      meta: null,
      versionId: null,
      query: "",
      sectionCode: "",
      page: 1,
      pageSize: 20,
      selectedCode: null,
      view: "list",
      refreshing: false,
    };

    function setHtml(html) {
      container.innerHTML = html;
    }

    function readFormIntoState() {
      var form = container.querySelector("[data-catalog-search-form]");
      if (!form) return;
      var qInput = form.querySelector('[name="q"]');
      var sectionSelect = form.querySelector('[name="section"]');
      if (qInput) state.query = qInput.value.trim().slice(0, MAX_QUERY_LENGTH);
      if (sectionSelect) state.sectionCode = sectionSelect.value.trim();
    }

    function normalizeSectionAfterMeta(meta) {
      if (!state.sectionCode || !meta || !meta.sections) return;
      var exists = meta.sections.some(function (section) {
        return section.code === state.sectionCode;
      });
      if (!exists) state.sectionCode = "";
    }

    function applyMeta(meta) {
      state.meta = meta;
      if (meta && meta.versionId) state.versionId = meta.versionId;
      normalizeSectionAfterMeta(meta);
    }

    function clearProtectedState() {
      state.meta = null;
      state.versionId = null;
      state.selectedCode = null;
    }

    function renderActionButtons(actions) {
      return (
        '<div class="pc-catalog-actions">' +
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
      );
    }

    function bindActionButtons() {
      container.querySelectorAll("[data-catalog-action]").forEach(function (button) {
        button.addEventListener("click", function () {
          var action = button.getAttribute("data-catalog-action");
          if (action === "retry-meta") loadMeta(true);
          if (action === "retry-list") loadList();
          if (action === "retry-detail" && state.selectedCode) loadDetail(state.selectedCode);
          if (action === "refresh") refreshCatalog();
          if (action === "back") goBackToList();
          if (action === "first-page") {
            state.page = 1;
            loadList();
          }
        });
      });
    }

    function bindSearchForm() {
      var form = container.querySelector("[data-catalog-search-form]");
      if (!form) return;
      form.addEventListener("submit", function (event) {
        event.preventDefault();
        readFormIntoState();
        state.page = 1;
        state.selectedCode = null;
        state.view = "list";
        loadList();
      });
      var sectionSelect = form.querySelector('[name="section"]');
      if (sectionSelect) {
        sectionSelect.addEventListener("change", function () {
          readFormIntoState();
          state.page = 1;
          state.selectedCode = null;
          state.view = "list";
          loadList();
        });
      }
    }

    function bindPagination(total) {
      var maxPage = Math.max(1, Math.ceil(total / state.pageSize));
      container.querySelectorAll("[data-catalog-page-nav]").forEach(function (button) {
        var direction = button.getAttribute("data-catalog-page-nav");
        button.disabled =
          direction === "prev" ? state.page <= 1 : state.page >= maxPage;
        button.addEventListener("click", function () {
          if (direction === "prev" && state.page > 1) {
            state.page -= 1;
            loadList();
          }
          if (direction === "next" && state.page < maxPage) {
            state.page += 1;
            loadList();
          }
        });
      });
    }

    function bindProductCards() {
      container.querySelectorAll("[data-catalog-open]").forEach(function (button) {
        button.addEventListener("click", function () {
          var code = button.getAttribute("data-catalog-open");
          if (!code) return;
          state.selectedCode = code;
          state.view = "detail";
          loadDetail(code);
        });
      });
    }

    function bindDetailActions() {
      var back = container.querySelector("[data-catalog-back]");
      if (back) back.addEventListener("click", goBackToList);
      var refresh = container.querySelector("[data-catalog-refresh]");
      if (refresh) refresh.addEventListener("click", refreshCatalog);
      bindActionButtons();
    }

    function goBackToList() {
      state.view = "list";
      state.selectedCode = null;
      renderListShell(state.meta);
      loadList();
    }

    function refreshCatalog() {
      if (state.refreshing) return;
      state.refreshing = true;
      state.selectedCode = null;
      state.view = "list";
      Promise.resolve(loadMeta(true)).finally(function () {
        state.refreshing = false;
      });
    }

    function renderToolbar(meta) {
      var sections = ((meta && meta.sections) || [])
        .map(function (section) {
          var selected = state.sectionCode === section.code ? " selected" : "";
          return (
            '<option value="' +
            esc(section.code) +
            '"' +
            selected +
            ">" +
            esc(section.name) +
            "</option>"
          );
        })
        .join("");
      return (
        '<form class="pc-catalog-toolbar" data-catalog-search-form>' +
        '<label class="pc-catalog-field"><span class="pc-label">Поиск по названию или коду</span>' +
        '<input class="pc-catalog-input" type="search" name="q" value="' +
        esc(state.query) +
        '" placeholder="Название товара или код 1С" maxlength="' +
        MAX_QUERY_LENGTH +
        '" autocomplete="off" /></label>' +
        '<label class="pc-catalog-field"><span class="pc-label">Раздел</span>' +
        '<select class="pc-catalog-input" name="section"><option value="">Все разделы</option>' +
        sections +
        "</select></label>" +
        '<button type="submit" class="pc-catalog-btn">Найти</button></form>'
      );
    }

    function renderMetaBanner(meta) {
      if (!meta || meta.state !== "ready") {
        return renderState(meta && meta.message ? meta.message : "Каталог не импортирован.", "empty");
      }
      var note = "";
      if (meta.classificationIncomplete && meta.message) {
        note = '<p class="pc-label">' + esc(meta.message) + "</p>";
      }
      return (
        '<div class="pc-catalog-meta">' +
        '<p class="pc-label">Снимок каталога · обновлён ' +
        esc(formatImportedAt(meta.importedAt)) +
        " · товаров " +
        esc(String(meta.productCount)) +
        "</p>" +
        note +
        '<p class="pc-label">Цены и остатки в этом снимке не импортировались и не показываются.</p>' +
        '<p class="pc-label">' +
        esc(meta.futureActionsBlockedReason || "") +
        "</p></div>"
      );
    }

    function renderDetailSnapshotLine(meta) {
      if (!meta || meta.state !== "ready") return "";
      return (
        '<div class="pc-catalog-meta pc-catalog-meta--compact">' +
        '<p class="pc-label">Снимок каталога · обновлён ' +
        esc(formatImportedAt(meta.importedAt)) +
        "</p></div>"
      );
    }

    function renderListShell(meta, resultsHtml) {
      setHtml(
        renderMetaBanner(meta) +
          renderToolbar(meta) +
          '<div class="pc-catalog-results" data-catalog-results aria-live="polite">' +
          (resultsHtml || renderState("Загрузка каталога…", "loading")) +
          "</div>",
      );
      bindSearchForm();
    }

    function setResultsHtml(html) {
      var results = container.querySelector("[data-catalog-results]");
      if (results) {
        results.innerHTML = html;
        return true;
      }
      return false;
    }

    function showListMessage(message, tone, actions) {
      var html =
        renderState(message, tone) + (actions ? renderActionButtons(actions) : "");
      if (!setResultsHtml(html)) renderListShell(state.meta, html);
      bindActionButtons();
    }

    function renderProductCard(item) {
      var groupNote = groupStatusLabel(item.groupStatus);
      var sections =
        item.sectionNames && item.sectionNames.length
          ? '<div class="pc-label">' + esc(item.sectionNames.join(", ")) + "</div>"
          : "";
      return (
        '<article class="pc-catalog-card">' +
        listImagePlaceholder(item) +
        '<div class="pc-catalog-card__body">' +
        '<div class="pc-catalog-card__title">' +
        esc(item.name) +
        "</div>" +
        '<div class="pc-label">Код: ' +
        esc(item.code) +
        "</div>" +
        (groupNote ? '<div class="pc-catalog-note">' + esc(groupNote) + "</div>" : "") +
        sections +
        '<button type="button" class="pc-link" data-catalog-open="' +
        esc(item.code) +
        '">Открыть характеристики</button></div></article>'
      );
    }

    function renderListResult(body) {
      if (body.state === "empty") {
        showListMessage(body.message || "Каталог пуст.", "empty");
        return;
      }
      if (!body.items || !body.items.length) {
        var maxPage = Math.max(1, Math.ceil((body.total || 0) / body.pageSize));
        if (body.total > 0 && body.page > maxPage) {
          showListMessage(
            "Запрошенная страница выходит за пределы выдачи.",
            "empty",
            [
              { id: "first-page", label: "На первую страницу", ghost: true },
              { id: "retry-list", label: "Обновить список", ghost: false },
            ],
          );
          return;
        }
        showListMessage("По запросу ничего не найдено.", "empty");
        return;
      }
      var maxPage = Math.max(1, Math.ceil(body.total / body.pageSize));
      setResultsHtml(
        '<div class="pc-catalog-grid">' +
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
          '<button type="button" class="pc-catalog-btn pc-catalog-btn--ghost" data-catalog-page-nav="next">Вперёд</button>' +
          "</div>",
      );
      bindProductCards();
      bindPagination(body.total);
    }

    function renderDetailShell(contentHtml) {
      setHtml(
        '<div class="pc-catalog-detail">' +
          '<div class="pc-catalog-detail__actions">' +
          '<button type="button" class="pc-link" data-catalog-back>← К списку</button>' +
          '<button type="button" class="pc-link" data-catalog-refresh>Обновить каталог</button></div>' +
          renderDetailSnapshotLine(state.meta) +
          contentHtml +
          "</div>",
      );
      bindDetailActions();
    }

    function renderDetail(product, metaNote) {
      var groupLine = product.groupCode
        ? "Код группы: " + product.groupCode
        : "Группа не указана";
      var groupNote = groupStatusLabel(product.groupStatus);
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
        product.imagePaths && product.imagePaths.length
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
          '</h2><span class="pc-source">Код ' +
          esc(product.code) +
          '</span></div><div class="pc-pad">' +
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
          '<div class="pc-field"><div class="pc-label">Активность в выгрузке</div><div class="pc-value">' +
          esc(product.activity || "—") +
          '</div></div></div></section>' +
          '<section class="pc-card"><div class="pc-cardhead"><h2>Изображения</h2></div><div class="pc-pad pc-catalog-images">' +
          images +
          "</div></section></div>" +
          '<section class="pc-card pc-space"><div class="pc-cardhead"><h2>Характеристики</h2></div><div class="pc-pad">' +
          properties +
          '</div></section><div class="pc-catalog-future">' +
          '<p class="pc-label">' +
          esc(
            metaNote ||
              "Сохранение факта установки или плана установки будет доступно после подключения подтверждённой торговой точки (R3.3). Сейчас выбор товара используется только для просмотра.",
          ) +
          "</p></div>",
      );
    }

    function handleAccessDenied() {
      clearProtectedState();
      setHtml(
        renderState("Каталог недоступен для этой карточки.", "error") +
          renderActionButtons([{ id: "retry-meta", label: "Повторить", ghost: false }]),
      );
      bindActionButtons();
    }

    function handleVersionConflict(message) {
      showListMessage(message || "Каталог обновился. Обновите данные.", "error", [
        { id: "refresh", label: "Обновить каталог", ghost: false },
      ]);
    }

    function loadList() {
      var loadId = ++state.loadId;
      if (state.meta && state.meta.state === "ready") {
        setResultsHtml(renderState("Загрузка…", "loading"));
      } else {
        renderListShell(state.meta, renderState("Загрузка…", "loading"));
      }
      return api
        .apiRequest(
          buildApiUrl(state.clientGuid, "products", {
            q: state.query,
            section: state.sectionCode,
            page: state.page,
            pageSize: state.pageSize,
            versionId: state.versionId,
          }),
        )
        .then(function (result) {
          if (loadId !== state.loadId || !root.isConnected || state.clientGuid !== clientGuid) return;
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
              { id: "refresh", label: "Обновить каталог", ghost: true },
            ]);
            return;
          }
          if (result.data.versionId && state.meta) {
            state.versionId = result.data.versionId;
            state.meta.versionId = result.data.versionId;
          }
          renderListResult(result.data);
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
          if (loadId !== state.loadId || !root.isConnected || state.clientGuid !== clientGuid) return;
          if (result.response.status === 403 || result.response.status === 404) {
            if (result.response.status === 404 && state.meta) {
              renderDetailShell(
                renderState("Товар не найден в текущем снимке.", "empty") +
                  renderActionButtons([
                    { id: "back", label: "← К списку", ghost: true },
                    { id: "refresh", label: "Обновить каталог", ghost: false },
                  ]),
              );
              return;
            }
            handleAccessDenied();
            return;
          }
          if (result.response.status === 409 && result.data) {
            renderDetailShell(
              renderState(result.data.message || "Каталог обновился.", "error") +
                renderActionButtons([{ id: "refresh", label: "Обновить каталог", ghost: false }]),
            );
            return;
          }
          if (result.response.status !== 200 || !result.data || !result.data.product) {
            renderDetailShell(
              renderState("Не удалось загрузить товар.", "error") +
                renderActionButtons([
                  { id: "retry-detail", label: "Повторить", ghost: false },
                  { id: "back", label: "← К списку", ghost: true },
                ]),
            );
            return;
          }
          state.versionId = result.data.product.versionId;
          renderDetail(result.data.product, result.data.futureActionsBlockedReason);
        })
        .catch(function () {
          if (loadId !== state.loadId || !root.isConnected) return;
          renderDetailShell(
            renderState("Ошибка сети при загрузке товара.", "error") +
              renderActionButtons([
                { id: "retry-detail", label: "Повторить", ghost: false },
                { id: "back", label: "← К списку", ghost: true },
              ]),
          );
        });
    }

    function loadMeta(reloadList) {
      var loadId = ++state.loadId;
      if (!state.meta) {
        setHtml(renderState("Загрузка каталога…", "loading"));
      } else if (state.meta.state === "ready") {
        renderListShell(state.meta, renderState("Загрузка каталога…", "loading"));
      }
      return api
        .apiRequest(buildApiUrl(state.clientGuid, "meta"))
        .then(function (result) {
          if (loadId !== state.loadId || !root.isConnected || state.clientGuid !== clientGuid) return;
          if (result.response.status === 403 || result.response.status === 404) {
            handleAccessDenied();
            return;
          }
          if (result.response.status !== 200 || !result.data) {
            setHtml(
              renderState("Не удалось загрузить каталог.", "error") +
                renderActionButtons([{ id: "retry-meta", label: "Повторить", ghost: false }]),
            );
            bindActionButtons();
            return;
          }
          applyMeta(result.data);
          if (result.data.state !== "ready") {
            setHtml(renderMetaBanner(result.data));
            return;
          }
          renderListShell(state.meta);
          if (reloadList !== false) return loadList();
        })
        .catch(function () {
          if (loadId !== state.loadId || !root.isConnected) return;
          setHtml(
            renderState("Ошибка сети при загрузке каталога.", "error") +
              renderActionButtons([{ id: "retry-meta", label: "Повторить", ghost: false }]),
          );
          bindActionButtons();
        });
    }

    root._catalogShowcaseLoadPromise = loadMeta(true);
    return root._catalogShowcaseLoadPromise;
  }

  window.ClientCatalog = {
    mountShowcaseTab: mountShowcaseTab,
  };
})();
