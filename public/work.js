(function () {
  "use strict";

  var api = window.TandoorRf;
  var shell = window.ClientsShell;
  var bitrix = window.ClientBitrix24;

  var accessPanel = document.getElementById("access-panel");
  var initPanel = document.getElementById("init-panel");
  var statePanel = document.getElementById("state-panel");
  var appEl = document.getElementById("work-app");
  var metaEl = document.getElementById("work-meta");
  var chipsEl = document.getElementById("work-group-chips");
  var listEl = document.getElementById("work-list");
  var paginationEl = document.getElementById("work-pagination");
  var searchInput = document.getElementById("work-search");
  var clientFilter = document.getElementById("work-client-filter");
  var responsibleFilter = document.getElementById("work-responsible-filter");
  var statusFilter = document.getElementById("work-status-filter");
  var resetBtn = document.getElementById("work-reset-filters");
  var refreshBtn = document.getElementById("work-refresh-cache");
  var refreshStatus = document.getElementById("work-refresh-status");

  var GROUPS = [
    { id: "", label: "Все открытые" },
    { id: "overdue", label: "Просрочено" },
    { id: "today", label: "Сегодня" },
    { id: "upcoming", label: "Предстоящие" },
    { id: "no_deadline", label: "Без срока" },
    { id: "completed", label: "Завершённые" },
  ];

  var state = {
    page: 1,
    pageSize: 50,
    deadlineGroup: "",
    q: "",
    clientGuid: "",
    responsibleBitrixUserId: "",
    statusLabel: "",
    lastBody: null,
  };

  var searchTimer = null;
  var loadSeq = 0;
  var activeLoadSeq = 0;

  function esc(value) {
    return shell.escapeHtml(value || "");
  }

  function hidePanels() {
    appEl.classList.add("clients-hidden");
    statePanel.classList.add("clients-hidden");
    accessPanel.classList.add("clients-hidden");
    if (initPanel) {
      initPanel.classList.add("clients-hidden");
    }
  }

  function showAccess(reason) {
    hidePanels();
    accessPanel.classList.remove("clients-hidden");
    if (reason === "forbidden") {
      shell.setPanelMessage(
        accessPanel,
        "error",
        "Нет доступа",
        "Раздел «Моя работа» доступен сотрудникам с доступом к клиентам.",
        '<a class="workspace-button workspace-button--secondary" href="/profile">В профиль</a>',
      );
      return;
    }
    shell.setPanelMessage(accessPanel, "error", "Ошибка доступа", "Повторите попытку позже.", "");
  }

  function showState(title, text, retryId) {
    hidePanels();
    statePanel.classList.remove("clients-hidden");
    shell.setPanelMessage(
      statePanel,
      "info",
      title,
      text,
      retryId
        ? '<button type="button" class="workspace-button workspace-button--primary" id="' +
          retryId +
          '">Повторить</button>'
        : "",
    );
    if (retryId) {
      var btn = document.getElementById(retryId);
      if (btn) {
        btn.addEventListener("click", function () {
          loadQueue();
        });
      }
    }
  }

  function buildQueryString() {
    var params = new URLSearchParams();
    params.set("page", String(state.page));
    params.set("pageSize", String(state.pageSize));
    params.set("status", state.deadlineGroup === "completed" ? "all" : "open");
    if (state.q) {
      params.set("q", state.q);
    }
    if (state.clientGuid) {
      params.set("clientGuid", state.clientGuid);
    }
    if (state.responsibleBitrixUserId) {
      params.set("responsibleBitrixUserId", state.responsibleBitrixUserId);
    }
    if (state.statusLabel) {
      params.set("statusLabel", state.statusLabel);
    }
    if (state.deadlineGroup) {
      params.set("deadlineGroup", state.deadlineGroup);
    }
    return params.toString();
  }

  function renderMeta(body) {
    if (!body) {
      metaEl.textContent = "";
      return;
    }
    var parts = [];
    if (body.loadedAtLabel) {
      parts.push("Экран обновлён: " + body.loadedAtLabel);
    }
    if (body.cacheLatestSyncedAtLabel) {
      parts.push("Кэш ЛК: " + body.cacheLatestSyncedAtLabel);
    }
    if (body.sync && body.sync.lastFinishedAtLabel) {
      parts.push(
        "Последняя синхронизация с Bitrix24: " +
          body.sync.lastFinishedAtLabel +
          (body.sync.partial ? " (частично)" : ""),
      );
    }
    metaEl.textContent = parts.join(" · ");
  }

  function renderChips(body) {
    var counts = (body && body.counts) || {};
    chipsEl.innerHTML = GROUPS.map(function (group) {
      var active = state.deadlineGroup === group.id ? " is-active" : "";
      var count =
        group.id === ""
          ? (counts.overdue || 0) +
            (counts.today || 0) +
            (counts.upcoming || 0) +
            (counts.no_deadline || 0)
          : counts[group.id] || 0;
      return (
        '<button type="button" class="work-chip' +
        active +
        '" data-deadline-group="' +
        esc(group.id) +
        '">' +
        esc(group.label) +
        '<span class="work-chip__count">' +
        count +
        "</span></button>"
      );
    }).join("");
    chipsEl.querySelectorAll("[data-deadline-group]").forEach(function (btn) {
      btn.addEventListener("click", function () {
        state.deadlineGroup = btn.getAttribute("data-deadline-group") || "";
        state.page = 1;
        loadQueue();
      });
    });
  }

  function fillSelect(select, options, current) {
    var html = select.id === "work-client-filter"
      ? '<option value="">Все клиенты</option>'
      : select.id === "work-responsible-filter"
        ? '<option value="">Все</option>'
        : '<option value="">Все</option>';
    (options || []).forEach(function (opt) {
      html +=
        '<option value="' +
        esc(opt.id) +
        '"' +
        (current === opt.id ? " selected" : "") +
        ">" +
        esc(opt.name) +
        "</option>";
    });
    select.innerHTML = html;
  }

  function renderOptions(body) {
    if (!body || !body.options) {
      return;
    }
    fillSelect(clientFilter, body.options.clients, state.clientGuid);
    fillSelect(responsibleFilter, body.options.responsibles, state.responsibleBitrixUserId);
    fillSelect(statusFilter, body.options.statusLabels, state.statusLabel);
  }

  function taskTitle(task) {
    if (task.accessLevel === "summary") {
      return task.briefText || "Краткое поручение";
    }
    return task.title || "Задача";
  }

  function renderClientLinks(task) {
    var clients = Array.isArray(task.clients) && task.clients.length ? task.clients : [
      { clientGuid: task.clientGuid, clientName: task.clientName },
    ];
    return clients
      .map(function (client) {
        var link =
          "/clients/" +
          encodeURIComponent(client.clientGuid) +
          "?tab=work&task=" +
          encodeURIComponent(task.taskId);
        return (
          '<a class="work-row__client pc-link" href="' +
          esc(link) +
          '">' +
          esc(client.clientName) +
          "</a>"
        );
      })
      .join("");
  }

  function renderRow(task) {
    var overdue = task.isOverdue === true ? " work-row--overdue" : "";
    var clientLink =
      "/clients/" +
      encodeURIComponent(task.clientGuid) +
      "?tab=work&task=" +
      encodeURIComponent(task.taskId);
    var deadline =
      task.accessLevel === "full" && task.deadline
        ? esc(task.deadline)
        : task.accessLevel === "summary"
          ? "—"
          : esc(task.deadline || "—");
    var checklist =
      bitrix && bitrix.renderChecklistExpandable
        ? bitrix.renderChecklistExpandable(task, task.clientGuid)
        : bitrix && bitrix.renderChecklistProgress
          ? bitrix.renderChecklistProgress(task.checklist)
          : "";
    var responsible = bitrix && bitrix.renderResponsibleBlock
      ? bitrix.renderResponsibleBlock(task.responsible)
      : "";
    var contact =
      bitrix && bitrix.renderContactAction
        ? bitrix.renderContactAction(task, task.clientGuid, false)
        : "";
    var portal =
      task.accessLevel === "full" && task.portalUrl
        ? '<a class="pc-link" href="' +
          esc(task.portalUrl) +
          '" target="_blank" rel="noopener noreferrer">Bitrix24</a>'
        : "";
    return (
      '<article class="work-row' +
      overdue +
      '" data-task-id="' +
      esc(task.taskId) +
      '">' +
      '<div class="work-row__head">' +
      renderClientLinks(task) +
      (task.isOverdue === true ? '<strong class="pc-bitrix24-overdue">Просрочено</strong>' : "") +
      "</div>" +
      '<div class="work-row__title">' +
      esc(taskTitle(task)) +
      "</div>" +
      '<div class="work-row__meta">' +
      "<span>Статус: " +
      esc(task.statusLabel || "—") +
      "</span>" +
      "<span>Срок: " +
      deadline +
      "</span>" +
      "</div>" +
      responsible +
      checklist +
      '<div class="work-row__actions">' +
      portal +
      '<a class="pc-link" href="' +
      esc(clientLink) +
      '">Карточка клиента</a>' +
      "</div>" +
      contact +
      "</article>"
    );
  }

  function bindListInteractions(body) {
    if (bitrix && bitrix.bindChecklistLazyLoad) {
      bitrix.bindChecklistLazyLoad(listEl);
    }
    if (bitrix && bitrix.bindContactActions) {
      bitrix.bindContactActions(listEl, null, appEl, {
        onSaved: function () {
          loadQueue();
        },
      });
    }
  }

  function renderList(body) {
    if (!body) {
      listEl.innerHTML = "";
      return;
    }
    if (body.state !== "ready" && body.state !== "empty") {
      listEl.innerHTML =
        '<div class="clients-empty"><p class="clients-empty__title">' +
        esc(body.message || "Данные недоступны") +
        "</p></div>";
      return;
    }
    if (!body.items || !body.items.length) {
      listEl.innerHTML =
        '<div class="clients-empty"><p class="clients-empty__title">' +
        esc(body.message || "Задачи не найдены") +
        "</p><p>Попробуйте изменить фильтры или обновить данные ЛК.</p></div>";
      return;
    }
    listEl.innerHTML = body.items.map(renderRow).join("");
    bindListInteractions(body);
  }

  function renderPagination(body) {
    if (!body || body.totalPages <= 1) {
      paginationEl.innerHTML = "";
      return;
    }
    var html = "";
    for (var page = 1; page <= body.totalPages; page += 1) {
      html +=
        '<button type="button" class="clients-pagination__btn' +
        (page === body.page ? " is-active" : "") +
        '" data-page="' +
        page +
        '">' +
        page +
        "</button>";
    }
    paginationEl.innerHTML = html;
    paginationEl.querySelectorAll("[data-page]").forEach(function (btn) {
      btn.addEventListener("click", function () {
        state.page = Number(btn.getAttribute("data-page")) || 1;
        loadQueue();
      });
    });
  }

  function applyQueueBody(body, seq) {
    if (seq !== activeLoadSeq) {
      return;
    }
    state.lastBody = body;
    hidePanels();
    appEl.classList.remove("clients-hidden");
    renderMeta(body);
    renderChips(body);
    renderOptions(body);
    renderList(body);
    renderPagination(body);
  }

  function loadQueue(options) {
    options = options || {};
    if (!api) {
      return Promise.resolve({ ok: false });
    }
    loadSeq += 1;
    var seq = loadSeq;
    activeLoadSeq = seq;
    if (!options.preserveOnError || !state.lastBody) {
      listEl.innerHTML =
        '<div class="clients-empty"><p class="clients-empty__title">Загрузка очереди…</p></div>';
    }
    return api
      .apiRequest("/api/work/tasks?" + buildQueryString())
      .then(function (result) {
        if (seq !== activeLoadSeq) {
          return { ok: true, stale: true };
        }
        if (result.response.status === 401) {
          window.location.replace("/login");
          return { ok: false, status: 401 };
        }
        if (result.response.status === 403) {
          if (options.preserveOnError && state.lastBody) {
            applyQueueBody(state.lastBody, seq);
            return { ok: false, status: 403 };
          }
          showAccess("forbidden");
          return { ok: false, status: 403 };
        }
        if (result.response.status !== 200 || !result.data) {
          if (options.preserveOnError && state.lastBody) {
            applyQueueBody(state.lastBody, seq);
            return { ok: false, status: result.response.status };
          }
          showState("Не удалось загрузить очередь", "Повторите попытку позже.", "retry-work");
          return { ok: false, status: result.response.status };
        }
        applyQueueBody(result.data, seq);
        return { ok: true, status: 200, data: result.data };
      })
      .catch(function (err) {
        if (seq !== activeLoadSeq) {
          return { ok: true, stale: true };
        }
        if (options.preserveOnError && state.lastBody) {
          applyQueueBody(state.lastBody, seq);
          return { ok: false, error: err };
        }
        showState(
          "Ошибка сети",
          api.mapRequestError(err, api.REQUEST_TIMEOUT_MS / 1000),
          "retry-work",
        );
        return { ok: false, error: err };
      });
  }

  function setRefreshStatus(text, ok) {
    if (!refreshStatus) {
      return;
    }
    refreshStatus.textContent = text;
    refreshStatus.className =
      "workspace-status " + (ok ? "workspace-status--success" : "workspace-status--error");
  }

  function bindFilters() {
    searchInput.addEventListener("input", function () {
      clearTimeout(searchTimer);
      searchTimer = setTimeout(function () {
        state.q = searchInput.value.trim();
        state.page = 1;
        loadQueue();
      }, 300);
    });
    clientFilter.addEventListener("change", function () {
      state.clientGuid = clientFilter.value;
      state.page = 1;
      loadQueue();
    });
    responsibleFilter.addEventListener("change", function () {
      state.responsibleBitrixUserId = responsibleFilter.value;
      state.page = 1;
      loadQueue();
    });
    statusFilter.addEventListener("change", function () {
      state.statusLabel = statusFilter.value;
      state.page = 1;
      loadQueue();
    });
    resetBtn.addEventListener("click", function () {
      state.q = "";
      state.clientGuid = "";
      state.responsibleBitrixUserId = "";
      state.statusLabel = "";
      state.deadlineGroup = "";
      state.page = 1;
      searchInput.value = "";
      loadQueue();
    });
    refreshBtn.addEventListener("click", function () {
      setRefreshStatus("Обновление…", true);
      loadQueue({ preserveOnError: true }).then(function (result) {
        if (!result || result.stale) {
          return;
        }
        if (result.ok && result.status === 200 && result.data && result.data.loadedAtLabel) {
          setRefreshStatus("Обновлено " + result.data.loadedAtLabel, true);
          return;
        }
        setRefreshStatus("Не удалось обновить данные ЛК", false);
      });
    });
  }

  shell.mountShell("work", { showClients: true });
  shell.ensureClientsReadAccess(function (user, reason) {
    if (reason) {
      if (reason === "forbidden") {
        showAccess("forbidden");
        return;
      }
      showState("Ошибка инициализации", "Повторите попытку позже.", "retry-init");
      return;
    }
    if (!user) {
      showState("Ошибка инициализации", "Повторите попытку позже.", "retry-init");
      return;
    }
    bindFilters();
    loadQueue();
  });
})();
