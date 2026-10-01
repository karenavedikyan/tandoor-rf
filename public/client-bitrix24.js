(function () {
  "use strict";

  var api = window.TandoorRf;

  var TASK_STATE_MESSAGES = {
    not_configured: "Bitrix24 не настроен.",
    cache_not_published: "Синхронизация задач ещё не опубликована.",
    empty: "Задачи с меткой этого объекта пока не найдены.",
    no_employee_link: "Связь с порталом Bitrix24 не подтверждена.",
    access_expired: "Подтверждение доступа к Bitrix24 истекло.",
    stale_snapshot: "Данные задач устарели. Требуется повторная синхронизация.",
    future_task: "Задача содержит некорректную дату обновления.",
    pilot_filtered: "Задачи вне разрешённого списка пилота не показываются.",
    pilot_list_missing: "Список разрешённых задач пилота не настроен.",
    not_published: "Кэш задач не опубликован.",
  };

  function esc(value) {
    return window.ClientDetailSections.escapeHtml(value || "");
  }

  function renderState(message, tone) {
    return (
      '<div class="pc-pad pc-unavailable pc-bitrix24-state pc-bitrix24-state--' +
      esc(tone || "info") +
      '">' +
      esc(message) +
      "</div>"
    );
  }

  function renderChecklistProgress(checklist) {
    if (!checklist || checklist.state === "not_loaded") {
      return "";
    }
    if (checklist.state === "ready") {
      return (
        '<div class="pc-bitrix24-checklist-progress">' +
        esc(
          "Чек-лист: выполнено " +
            checklist.progress.completed +
            " из " +
            checklist.progress.total,
        ) +
        (checklist.syncedAtLabel
          ? " · обновлено " + esc(checklist.syncedAtLabel)
          : "") +
        "</div>"
      );
    }
    if (checklist.state === "empty") {
      return (
        '<div class="pc-label">Чек-лист пуст' +
        (checklist.syncedAtLabel
          ? " · загружен " + esc(checklist.syncedAtLabel)
          : "") +
        "</div>"
      );
    }
    if (checklist.state === "error") {
      return (
        '<div class="pc-label">Чек-лист временно недоступен' +
        (checklist.syncedAtLabel
          ? " · попытка " + esc(checklist.syncedAtLabel)
          : "") +
        "</div>"
      );
    }
    if (checklist.state === "partial") {
      return (
        '<div class="pc-label">Чек-лист загружен не полностью' +
        (checklist.syncedAtLabel ? " · " + esc(checklist.syncedAtLabel) : "") +
        "</div>"
      );
    }
    if (checklist.state === "stale") {
      return (
        '<div class="pc-label">Чек-лист устарел' +
        (checklist.syncedAtLabel ? " · " + esc(checklist.syncedAtLabel) : "") +
        "</div>"
      );
    }
    return "";
  }

  function renderChecklistItemNode(item, depth) {
    var stateText = item.isGroup
      ? ""
      : item.isComplete
        ? '<span class="pc-bitrix24-checklist-state pc-bitrix24-checklist-state--done" aria-label="выполнено">✓</span>'
        : '<span class="pc-bitrix24-checklist-state pc-bitrix24-checklist-state--open" aria-label="не выполнено">○</span>';
    var coExecutors =
      item.coExecutorNames && item.coExecutorNames.length
        ? '<span class="pc-bitrix24-checklist-coexecutors"> · соисполнители: ' +
          esc(item.coExecutorNames.join(", ")) +
          "</span>"
        : "";
    var children =
      item.children && item.children.length
        ? '<ul class="pc-bitrix24-checklist-list">' +
          item.children
            .map(function (child) {
              return renderChecklistItemNode(child, depth + 1);
            })
            .join("") +
          "</ul>"
        : "";
    return (
      '<li class="pc-bitrix24-checklist-item' +
      (item.isGroup ? " pc-bitrix24-checklist-item--group" : "") +
      '" style="--checklist-depth:' +
      depth +
      '">' +
      stateText +
      '<span class="pc-bitrix24-checklist-title">' +
      esc(item.title) +
      coExecutors +
      "</span>" +
      children +
      "</li>"
    );
  }

  function renderChecklistDetails(checklist) {
    var progress = renderChecklistProgress(checklist);
    if (
      !checklist ||
      checklist.state !== "ready" ||
      !checklist.items ||
      !checklist.items.length
    ) {
      return progress;
    }
    return (
      progress +
      '<details class="pc-bitrix24-checklist">' +
      '<summary class="pc-bitrix24-checklist-summary">Пункты чек-листа</summary>' +
      '<ul class="pc-bitrix24-checklist-list pc-bitrix24-checklist-list--root">' +
      checklist.items
        .map(function (item) {
          return renderChecklistItemNode(item, 0);
        })
        .join("") +
      "</ul></details>"
    );
  }

  function renderChecklistExpandable(task, clientGuid) {
    if (!task || task.accessLevel === "summary") {
      return "";
    }
    var progress = renderChecklistProgress(task.checklist);
    var details =
      task.checklist && task.checklist.state === "ready"
        ? '<details class="pc-bitrix24-checklist pc-bitrix24-checklist--lazy">' +
          '<summary class="pc-bitrix24-checklist-summary">Пункты чек-листа</summary>' +
          '<div class="pc-bitrix24-checklist-lazy-host pc-label">Раскройте для загрузки пунктов из кэша ЛК.</div>' +
          "</details>"
        : "";
    return (
      '<div class="pc-bitrix24-checklist-block" data-task-id="' +
      esc(task.taskId) +
      '" data-client-guid="' +
      esc(clientGuid) +
      '">' +
      '<div class="pc-bitrix24-checklist-progress-host">' +
      progress +
      "</div>" +
      details +
      "</div>"
    );
  }

  function applyChecklistBlockState(block, checklist, options) {
    options = options || {};
    var progressHost = block.querySelector(".pc-bitrix24-checklist-progress-host");
    if (progressHost) {
      progressHost.innerHTML = renderChecklistProgress(checklist);
    }
    var details = block.querySelector(".pc-bitrix24-checklist--lazy");
    if (!details) {
      return;
    }
    var host = details.querySelector(".pc-bitrix24-checklist-lazy-host");
    if (!host) {
      return;
    }
    if (options.errorMessage) {
      host.innerHTML =
        esc(options.errorMessage) +
        ' <button type="button" class="pc-link pc-bitrix24-checklist-retry">Повторить</button>';
      details.dataset.loaded = "";
      return;
    }
    if (
      !checklist ||
      checklist.state === "stale" ||
      checklist.state === "error" ||
      checklist.state === "partial"
    ) {
      host.innerHTML = renderChecklistProgress(checklist);
      details.dataset.loaded = "1";
      details.open = true;
      return;
    }
    if (checklist.state === "ready" && checklist.items && checklist.items.length) {
      host.innerHTML = renderChecklistItemsHtml(checklist);
      details.dataset.loaded = "1";
      details.open = true;
      return;
    }
    host.textContent = "Пункты чек-листа недоступны.";
    details.dataset.loaded = "1";
  }

  function syncWorkRowTaskAccess(row, task) {
    if (!row) {
      return;
    }
    var titleEl = row.querySelector(".work-row__title");
    var metaDeadline = row.querySelector(".work-row__meta span:last-child");
    var actions = row.querySelector(".work-row__actions");
    var block = row.querySelector(".pc-bitrix24-checklist-block");
    if (!task) {
      row.remove();
      return;
    }
    if (task.accessLevel === "summary") {
      if (titleEl) {
        titleEl.textContent = task.briefText || "Краткое поручение";
      }
      if (metaDeadline) {
        metaDeadline.textContent = "Срок: недоступен";
      }
      if (block) {
        block.remove();
      }
      row.classList.remove("work-row--overdue");
      row.querySelectorAll(".pc-bitrix24-overdue, .pc-bitrix24-contact").forEach(function (node) {
        node.remove();
      });
      if (actions) {
        actions.querySelectorAll('a[href*="bitrix24"], a.pc-link[target="_blank"]').forEach(function (link) {
          if (/Bitrix24/i.test(link.textContent || "")) {
            link.remove();
          }
        });
      }
      return;
    }
    if (block && task.checklist) {
      applyChecklistBlockState(block, task.checklist);
    }
  }

  function renderChecklistItemsHtml(checklist) {
    if (
      !checklist ||
      checklist.state !== "ready" ||
      !checklist.items ||
      !checklist.items.length
    ) {
      return renderChecklistProgress(checklist);
    }
    return (
      '<ul class="pc-bitrix24-checklist-list pc-bitrix24-checklist-list--root">' +
      checklist.items
        .map(function (item) {
          return renderChecklistItemNode(item, 0);
        })
        .join("") +
      "</ul>"
    );
  }

  function bindChecklistLazyLoad(container, options) {
    options = options || {};
    container.querySelectorAll(".pc-bitrix24-checklist-block").forEach(function (block) {
      var details = block.querySelector(".pc-bitrix24-checklist--lazy");
      if (!details || details.dataset.lazyBound === "1") {
        return;
      }
      details.dataset.lazyBound = "1";
      if (!block.dataset.loadSeq) {
        block.dataset.loadSeq = "0";
      }
      function setPending(pending) {
        details.classList.toggle("pc-bitrix24-checklist--pending", pending);
        details.querySelectorAll("summary").forEach(function (summary) {
          summary.setAttribute("aria-busy", pending ? "true" : "false");
        });
      }
      function loadChecklistItems() {
        if (details.classList.contains("pc-bitrix24-checklist--pending")) {
          return;
        }
        var clientGuid = block.getAttribute("data-client-guid");
        var taskId = block.getAttribute("data-task-id");
        if (!clientGuid || !taskId || !api) {
          return;
        }
        var seq = Number(block.dataset.loadSeq || "0") + 1;
        block.dataset.loadSeq = String(seq);
        setPending(true);
        var host = details.querySelector(".pc-bitrix24-checklist-lazy-host");
        if (host) {
          host.textContent = "Загрузка пунктов…";
        }
        api
          .apiRequest(
            "/api/clients/" + encodeURIComponent(clientGuid) + "/bitrix24/tasks",
          )
          .then(function (result) {
            if (!block.isConnected || Number(block.dataset.loadSeq) !== seq) {
              return;
            }
            var row = block.closest(".work-row");
            if (result.response.status === 401) {
              if (typeof options.onAccessDenied === "function") {
                options.onAccessDenied();
              }
              window.location.replace("/login");
              return;
            }
            if (result.response.status === 404) {
              syncWorkRowTaskAccess(row, null);
              if (typeof options.onAccessChanged === "function") {
                options.onAccessChanged();
              }
              return;
            }
            if (result.response.status === 403) {
              syncWorkRowTaskAccess(row, null);
              if (typeof options.onAccessDenied === "function") {
                options.onAccessDenied();
              }
              return;
            }
            if (result.response.status !== 200 || !result.data || !result.data.tasks) {
              applyChecklistBlockState(block, null, {
                errorMessage: "Не удалось загрузить пункты чек-листа.",
              });
              return;
            }
            var task = result.data.tasks.find(function (entry) {
              return String(entry.taskId) === String(taskId);
            });
            if (!task) {
              syncWorkRowTaskAccess(row, null);
              if (typeof options.onAccessChanged === "function") {
                options.onAccessChanged();
              }
              return;
            }
            if (task.accessLevel !== "full") {
              syncWorkRowTaskAccess(row, task);
              if (typeof options.onAccessChanged === "function") {
                options.onAccessChanged();
              }
              return;
            }
            applyChecklistBlockState(block, task.checklist || null);
          })
          .catch(function () {
            if (!block.isConnected || Number(block.dataset.loadSeq) !== seq) {
              return;
            }
            applyChecklistBlockState(block, null, {
              errorMessage: "Ошибка сети при загрузке пунктов.",
            });
          })
          .finally(function () {
            if (Number(block.dataset.loadSeq) === seq) {
              setPending(false);
            }
          });
      }
      details.addEventListener("toggle", function () {
        if (!details.open || details.dataset.loaded === "1" || details.classList.contains("pc-bitrix24-checklist--pending")) {
          return;
        }
        loadChecklistItems();
      });
      details.addEventListener("click", function (event) {
        var retry = event.target.closest(".pc-bitrix24-checklist-retry");
        if (!retry || !details.contains(retry)) {
          return;
        }
        event.preventDefault();
        details.dataset.loaded = "";
        loadChecklistItems();
      });
    });
  }

  function renderResponsibleBlock(responsible) {
    if (!responsible) {
      return '<div class="pc-label">Ответственный: данные не подтверждены</div>';
    }
    if (responsible.state === "confirmed" && responsible.displayName) {
      var contact =
        responsible.internalContactEmail
          ? ' · <a class="pc-link" href="mailto:' +
            esc(responsible.internalContactEmail) +
            '">Внутренние контакты</a>'
          : "";
      return (
        '<div class="pc-label">Ответственный: ' +
        esc(responsible.displayName) +
        contact +
        "</div>"
      );
    }
    return '<div class="pc-label">Ответственный: имя не подтверждено</div>';
  }

  function renderContactAction(task, clientGuid, compact) {
    if (!task.contactAction || !task.contactAction.canMark) {
      return "";
    }
    var action = task.contactAction;
    var taskKey = esc(task.taskId);
    var checked = action.marked ? " checked" : "";
    var completed =
      action.marked && action.markedAtLabel
        ? '<div class="pc-bitrix24-contact-done">выполнил ' +
          esc(action.markedByDisplayName || "") +
          ", " +
          esc(action.markedAtLabel) +
          "</div>"
        : "";
    var commentBlock = action.comment
      ? '<div class="pc-bitrix24-contact-comment">' + esc(action.comment) + "</div>"
      : "";
    var clientAttr = clientGuid
      ? ' data-client-guid="' + esc(clientGuid) + '"'
      : "";
    if (compact) {
      return '<div class="pc-bitrix24-contact" data-task-id="' + taskKey + '"' + clientAttr + '">' +
        '<label class="pc-bitrix24-contact-label">' +
        '<input type="checkbox" class="pc-bitrix24-contact-checkbox"' + checked +
        ' aria-label="Связаться с ответственным" /><span>Связаться с ответственным</span></label>' +
        completed +
        '<span class="workspace-status pc-bitrix24-contact-status" role="status" aria-live="polite"></span></div>';
    }
    return (
      '<div class="pc-bitrix24-contact" data-task-id="' +
      taskKey +
      '"' +
      clientAttr +
      ">" +
      '<label class="pc-bitrix24-contact-label">' +
      '<input type="checkbox" class="pc-bitrix24-contact-checkbox"' +
      checked +
      ' aria-label="Связаться с ответственным" />' +
      "<span>Связаться с ответственным</span>" +
      "</label>" +
      completed +
      commentBlock +
      '<div class="pc-bitrix24-contact-actions">' +
      (action.marked && !compact
        ? '<label class="pc-label">Комментарий к выполненному действию' +
          '<textarea class="pc-bitrix24-contact-comment-input" maxlength="2000" rows="2">' +
          esc(action.comment || "") + '</textarea></label>' +
          '<button type="button" class="workspace-button workspace-button--secondary pc-bitrix24-contact-comment-btn">Сохранить комментарий</button>' +
          '<button type="button" class="workspace-button workspace-button--secondary pc-bitrix24-contact-revoke-btn">Отменить отметку</button>'
        : "") +
      "</div>" +
      '<div class="pc-label">Отметка сохраняется только для вас в ЛК. Задача в Битрикс24 не закрывается.</div>' +
      '<span class="workspace-status pc-bitrix24-contact-status" role="status" aria-live="polite"></span>' +
      "</div>"
    );
  }

  function renderTaskRow(task, clientGuid) {
    var objectLabel = task.boundObjectLabel
      ? esc("Объект: " + task.boundObjectLabel)
      : "";
    var contactHtml = renderContactAction(task, clientGuid);
    if (task.accessLevel === "summary") {
      return (
        '<article class="pc-bitrix24-task pc-bitrix24-task--summary">' +
        '<div class="pc-value">' +
        esc(task.briefText || "Краткое поручение") +
        "</div>" +
        '<div class="pc-label">Статус: ' +
        esc(task.statusLabel) +
        "</div>" +
        (objectLabel ? '<div class="pc-label">' + objectLabel + "</div>" : "") +
        renderResponsibleBlock(task.responsible) +
        contactHtml +
        "</article>"
      );
    }
    var deadline = task.deadline ? esc(task.deadline) : "—";
    var link = task.portalUrl
      ? '<a class="pc-link pc-bitrix24-open-task" href="' +
        esc(task.portalUrl) +
        '" target="_blank" rel="noopener noreferrer">Открыть в Битрикс24</a>'
      : "";
    return (
      '<article class="pc-bitrix24-task" data-task-id="' +
      esc(task.taskId) +
      '">' +
      '<div class="pc-value">' +
      esc(task.title) +
      "</div>" +
      '<div class="pc-label">Статус: ' +
      esc(task.statusLabel) +
      " · Срок: " +
      deadline +
      " · Обновлено: " +
      esc(task.changedAt || "—") +
      "</div>" +
      (objectLabel ? '<div class="pc-label">' + objectLabel + "</div>" : "") +
      renderResponsibleBlock(task.responsible) +
      link +
      renderChecklistDetails(task.checklist) +
      contactHtml +
      "</article>"
    );
  }

  function tasksMessage(body) {
    if (body.message) {
      return body.message;
    }
    return TASK_STATE_MESSAGES[body.state] || TASK_STATE_MESSAGES.empty;
  }

  function partialCount(count, unknown) {
    return unknown ? (count ? "не менее " + count : "нет данных") : String(count);
  }

  function renderBitrix24SyncBlock() {
    return (
      '<div class="pc-bitrix24-sync-block">' +
      '<div class="pc-bitrix24-sync-toolbar" data-bitrix24-sync-toolbar data-testid="bitrix24-sync-toolbar">' +
      '<button type="button" class="workspace-button workspace-button--primary pc-bitrix24-sync-btn" data-testid="bitrix24-sync-btn">Синхронизировать с Битрикс24</button>' +
      '<span class="workspace-status pc-bitrix24-sync-status" role="status" aria-live="polite"></span>' +
      "</div>" +
      '<p class="pc-label pc-bitrix24-cache-note">«Обновить данные ЛК» перечитывает сохранённые данные из кэша ЛК и не запускает обмен с Bitrix24.</p>' +
      '<button type="button" class="pc-link pc-bitrix24-refresh-cache" data-testid="refresh-bitrix24-cache">Обновить данные ЛК</button>' +
      "</div>"
    );
  }

  function ensureSyncState(root) {
    if (!root._bitrix24SyncState) {
      root._bitrix24SyncState = {
        phase: "idle",
        message: "",
        lastSuccessAtLabel: null,
        retryAfterMs: null,
        retryTimer: null,
      };
    }
    return root._bitrix24SyncState;
  }

  function paintSyncToolbars(root) {
    var state = ensureSyncState(root);
    var running = state.phase === "running";
    var cooldown = state.phase === "cooldown";
    var disabled = running || cooldown;
    root.querySelectorAll("[data-bitrix24-sync-toolbar]").forEach(function (toolbar) {
      var btn = toolbar.querySelector(".pc-bitrix24-sync-btn");
      var status = toolbar.querySelector(".pc-bitrix24-sync-status");
      if (btn) {
        btn.disabled = disabled;
        btn.textContent = running
          ? "Синхронизация…"
          : "Синхронизировать с Битрикс24";
      }
      if (status) {
        var text = "";
        if (running) {
          text = state.message || "Синхронизация…";
        } else if (state.phase === "success" && state.lastSuccessAtLabel) {
          text = "Обновлено " + state.lastSuccessAtLabel;
        } else if (state.phase === "error" || state.phase === "cooldown") {
          text = state.message || "";
        }
        status.textContent = text;
        status.className =
          "workspace-status pc-bitrix24-sync-status " +
          (state.phase === "success"
            ? "workspace-status--success"
            : state.phase === "error" || state.phase === "cooldown"
              ? "workspace-status--error"
              : "");
      }
    });
  }

  function scheduleSyncRetry(root) {
    var state = ensureSyncState(root);
    if (state.retryTimer) {
      clearTimeout(state.retryTimer);
    }
    var delayMs = Math.max(1000, Number(state.retryAfterMs) || 30000);
    state.retryTimer = setTimeout(function () {
      if (state.phase === "cooldown") {
        state.phase = "idle";
        state.message = "";
        paintSyncToolbars(root);
      }
    }, delayMs);
  }

  function captureBitrix24UiState(root) {
    var tabEl = root.querySelector('.pc-tabs button[aria-selected="true"]');
    return {
      tab: tabEl ? tabEl.getAttribute("data-card-tab") : null,
      openChecklistTaskIds: Array.prototype.slice
        .call(root.querySelectorAll(".pc-bitrix24-checklist[open]"))
        .map(function (details) {
          var task = details.closest(".pc-bitrix24-task[data-task-id]");
          return task ? task.getAttribute("data-task-id") : null;
        })
        .filter(Boolean),
    };
  }

  function restoreBitrix24UiState(root, uiState) {
    if (!uiState) {
      return;
    }
    var currentTabEl = root.querySelector('.pc-tabs button[aria-selected="true"]');
    var currentTab = currentTabEl ? currentTabEl.getAttribute("data-card-tab") : null;
    if (uiState.tab && currentTab === uiState.tab) {
      var tabBtn = root.querySelector('[data-card-tab="' + uiState.tab + '"]');
      if (tabBtn && tabBtn.getAttribute("aria-selected") !== "true") {
        tabBtn.click();
      }
    }
    (uiState.openChecklistTaskIds || []).forEach(function (taskId) {
      var task = root.querySelector('.pc-bitrix24-task[data-task-id="' + taskId + '"]');
      var details = task && task.querySelector(".pc-bitrix24-checklist");
      if (details) {
        details.open = true;
      }
    });
  }

  function ensureSyncControls(root, clientGuid) {
    root._bitrix24ClientGuid = clientGuid;
    if (root._bitrix24SyncBound) {
      paintSyncToolbars(root);
      return;
    }
    root._bitrix24SyncBound = true;
    root.addEventListener("click", function (event) {
      var syncBtn = event.target.closest(".pc-bitrix24-sync-btn");
      if (syncBtn && root.contains(syncBtn)) {
        event.preventDefault();
        startManualSync(root, clientGuid);
        return;
      }
      var refreshBtn = event.target.closest(".pc-bitrix24-refresh-cache");
      if (refreshBtn && root.contains(refreshBtn)) {
        event.preventDefault();
        reloadBitrix24Data(root, clientGuid);
      }
    });
    paintSyncToolbars(root);
  }

  var SYNC_REQUEST_TIMEOUT_MS = 70000;

  function startManualSync(root, clientGuid) {
    var state = ensureSyncState(root);
    if (state.phase === "running" || state.phase === "cooldown") {
      return Promise.resolve();
    }
    var uiState = captureBitrix24UiState(root);
    state.phase = "running";
    state.message = "Синхронизация…";
    paintSyncToolbars(root);
    return api
      .apiRequest(
        "/api/clients/" + encodeURIComponent(clientGuid) + "/bitrix24/sync",
        { method: "POST", body: {}, timeoutMs: SYNC_REQUEST_TIMEOUT_MS },
      )
      .then(function (result) {
        if (result.response.status === 429) {
          state.phase = "cooldown";
          state.message =
            (result.data && result.data.message) ||
            "Повторный запуск пока недоступен.";
          state.retryAfterMs = (result.data && result.data.retryAfterMs) || 30000;
          scheduleSyncRetry(root);
          paintSyncToolbars(root);
          return;
        }
        if (result.response.status === 200 && result.data) {
          var body = result.data;
          var syncSucceeded = body.status === "success" && body.complete;
          if (syncSucceeded) {
            state.phase = "success";
            state.lastSuccessAtLabel = body.syncedAtLabel || null;
            state.message = body.message || "";
          } else {
            state.phase = "error";
            state.message = body.message || "Не удалось синхронизировать.";
          }
          // Partial/failure can have invalidated a previously ready cache snapshot.
          return reloadBitrix24Data(root, clientGuid, uiState).then(function (reloadResult) {
            if (reloadResult && !reloadResult.ok) {
              state.phase = "error";
              state.message =
                reloadResult.error ||
                "Синхронизация выполнена, но не удалось обновить карточку.";
            }
            paintSyncToolbars(root);
          });
        }
        state.phase = "error";
        state.message =
          (result.data && (result.data.message || result.data.error?.message)) ||
          "Не удалось синхронизировать.";
        return reloadBitrix24Data(root, clientGuid, uiState).then(function () {
          paintSyncToolbars(root);
        });
      })
      .catch(function (err) {
        state.phase = "error";
        state.message =
          err && err.name === "AbortError"
            ? api.mapRequestError(err, Math.round(SYNC_REQUEST_TIMEOUT_MS / 1000))
            : "Ошибка сети.";
        return reloadBitrix24Data(root, clientGuid, uiState).then(function () {
          paintSyncToolbars(root);
        });
      });
  }

  function renderClaimRow(claim, clientGuid) {
    var workLink =
      "/clients/" +
      encodeURIComponent(clientGuid) +
      "?tab=work&task=" +
      encodeURIComponent(claim.taskId);
    return (
      '<article class="pc-bitrix24-claim pc-bitrix24-task pc-bitrix24-task--summary" data-task-id="' +
      esc(claim.taskId) +
      '">' +
      '<div class="pc-value pc-bitrix24-claim__text">' +
      esc(claim.briefText || "Сводка недоступна") +
      "</div>" +
      '<div class="pc-label">Опубликовано: ' +
      esc(claim.publishedAtLabel || "—") +
      (claim.cacheSyncedAtLabel
        ? " · данные кэша: " + esc(claim.cacheSyncedAtLabel)
        : "") +
      "</div>" +
      renderResponsibleBlock(claim.responsible) +
      '<div class="pc-label">Технический статус задачи в кэше не является статусом решения рекламации.</div>' +
      '<a class="pc-link" href="' +
      esc(workLink) +
      '">Открыть в разделе «Работа»</a>' +
      renderContactAction(claim, clientGuid, false) +
      "</article>"
    );
  }

  function renderOverviewTask(task, clientGuid) {
    var title = task.accessLevel === "summary" ? task.briefText : task.title;
    return '<article class="pc-bitrix24-task pc-bitrix24-overview-task" data-overview-task-id="' +
      esc(task.taskId) + '">' +
      '<div class="pc-value">' + esc(title || "Поручение") + '</div>' +
      '<div class="pc-label">' + esc(task.statusLabel) +
      (task.isOverdue === true ? ' · <strong class="pc-bitrix24-overdue">Просрочена</strong>' : '') +
      (task.accessLevel === "full" && task.deadline ? ' · До: ' + esc(task.deadline) : '') +
      '</div>' +
      renderChecklistProgress(task.checklist) +
      renderResponsibleBlock(task.responsible) +
      renderContactAction(task, clientGuid, true) + '</article>';
  }

  function renderOverview(root, clientGuid, result) {
    var container = root.querySelector("#pc-bitrix24-overview");
    if (!container) return;
    var body = result && result.response.status === 200 ? result.data : null;
    var tasks = body && body.state === "ready" && Array.isArray(body.tasks) ? body.tasks : [];
    var html = '<p class="pc-label">Только доступные вам задачи. Это не весь список задач клиента или портала.</p>';
    if (tasks.length) {
      var open = tasks.filter(function (t) { return t.isOpen === true; }).length;
      var overdue = tasks.filter(function (t) { return t.isOverdue === true; }).length;
      var unknownOpen = tasks.some(function (t) { return typeof t.isOpen !== "boolean"; });
      var unknownDue = tasks.some(function (t) { return typeof t.isOverdue !== "boolean"; });
      html += '<div class="pc-bitrix24-summary-counts" data-testid="bitrix24-overview-counts">' +
        '<span>Открыто: <strong>' + partialCount(open, unknownOpen) + '</strong></span>' +
        '<span>Просрочено: <strong>' + partialCount(overdue, unknownDue) + '</strong></span></div>';
      if (unknownOpen || unknownDue) {
        html += '<p class="pc-label">Часть статусов или сроков недоступна.</p>';
      }
      var next = tasks.filter(function (t) { return t.isOpen !== false; }).sort(function (a, b) {
        var priority = Number(b.isOverdue === true) - Number(a.isOverdue === true);
        if (priority) return priority;
        var aDue = a.deadlineAt ? Date.parse(a.deadlineAt) : Infinity;
        var bDue = b.deadlineAt ? Date.parse(b.deadlineAt) : Infinity;
        if (!Number.isFinite(aDue)) aDue = Infinity;
        if (!Number.isFinite(bDue)) bDue = Infinity;
        if (aDue !== bDue) return aDue < bDue ? -1 : 1;
        return String(a.taskId).localeCompare(String(b.taskId));
      }).slice(0, 3);
      html += next.length ? next.map(function (t) { return renderOverviewTask(t, clientGuid); }).join("") :
        '<p class="pc-label">Среди доступных задач открытых нет.</p>';
      if (next.length) html += '<p class="pc-label">Галочки личные: отмечают связь с ответственным, а не закрытие задач в Битрикс24.</p>';
      html += '<button type="button" class="pc-link pc-bitrix24-show-work" data-testid="open-all-bitrix24-tasks">Все доступные задачи (' + tasks.length + ') →</button>';
    } else {
      html += renderState(body ? tasksMessage(body) : "Не удалось загрузить задачи.", body && body.state === "empty" ? "empty" : "info");
      html += '<button type="button" class="pc-link pc-bitrix24-show-work">Перейти в «Работу» →</button>';
    }
    html += renderBitrix24SyncBlock();
    container.innerHTML = html;
    bindContactActions(container, clientGuid, root);
    ensureSyncControls(root, clientGuid);
    container.querySelector(".pc-bitrix24-show-work").addEventListener("click", function () {
      root.querySelector('[data-card-tab="work"]').click();
      root.querySelector('[data-card-tab="work"]').focus();
    });
  }

  function saveContactAction(clientGuid, taskId, payload) {
    return api.apiRequest(
      "/api/clients/" +
        encodeURIComponent(clientGuid) +
        "/bitrix24/tasks/" +
        encodeURIComponent(taskId) +
        "/contact",
      {
        method: "PUT",
        body: payload,
      },
    );
  }

  function bindContactActions(container, clientGuid, root, options) {
    options = options || {};
    var onSaved =
      typeof options.onSaved === "function"
        ? options.onSaved
        : function () {
            return reloadBitrix24Data(root, clientGuid);
          };
    container.querySelectorAll(".pc-bitrix24-contact").forEach(function (block) {
      var taskId = block.getAttribute("data-task-id");
      if (!taskId) {
        return;
      }
      var rowClientGuid =
        block.getAttribute("data-client-guid") || clientGuid || "";
      var checkbox = block.querySelector(".pc-bitrix24-contact-checkbox");
      var statusEl = block.querySelector(".pc-bitrix24-contact-status");
      var commentBtn = block.querySelector(".pc-bitrix24-contact-comment-btn");
      var revokeBtn = block.querySelector(".pc-bitrix24-contact-revoke-btn");
      var commentInput = block.querySelector(".pc-bitrix24-contact-comment-input");
      if (block.dataset.contactBound === "1") {
        return;
      }
      block.dataset.contactBound = "1";
      function setBusy(busy) {
        var selector =
          '.pc-bitrix24-contact[data-task-id="' + CSS.escape(taskId) + '"]';
        root.querySelectorAll(selector).forEach(function (peer) {
          peer.querySelectorAll("input, button, textarea").forEach(function (control) {
            control.disabled = busy;
          });
        });
      }

      function setStatus(text, ok) {
        if (!statusEl) {
          return;
        }
        statusEl.textContent = text;
        statusEl.className =
          "workspace-status pc-bitrix24-contact-status " +
          (ok ? "workspace-status--success" : "workspace-status--error");
      }

      if (checkbox) {
        checkbox.addEventListener("change", function () {
          if (checkbox.disabled) {
            return;
          }
          var desired = checkbox.checked;
          var previousComment = commentInput ? commentInput.value : null;
          setBusy(true);
          var payload = { marked: desired };
          if (desired && commentInput) {
            payload.comment = commentInput.value;
          }
          saveContactAction(rowClientGuid, taskId, payload)
            .then(function (result) {
              if (result.response.status === 200) {
                return Promise.resolve(onSaved());
              }
              checkbox.checked = !desired;
              if (commentInput && previousComment !== null) {
                commentInput.value = previousComment;
              }
              setStatus(
                (result.data && result.data.message) || "Не удалось сохранить отметку",
                false,
              );
            })
            .catch(function () {
              checkbox.checked = !desired;
              if (commentInput && previousComment !== null) {
                commentInput.value = previousComment;
              }
              setStatus("Ошибка сети", false);
            })
            .finally(function () {
              setBusy(false);
            });
        });
      }

      if (commentBtn) {
        commentBtn.addEventListener("click", function () {
          if (!checkbox || !checkbox.checked || !commentInput || commentBtn.disabled) {
            return;
          }
          var value = commentInput.value;
          setBusy(true);
          saveContactAction(rowClientGuid, taskId, { marked: true, comment: value })
            .then(function (result) {
              if (result.response.status === 200) {
                return Promise.resolve(onSaved()).then(function () {
                  setStatus("Комментарий сохранён", true);
                });
              }
              setStatus(
                (result.data && result.data.message) || "Не удалось сохранить комментарий",
                false,
              );
            })
            .catch(function () {
              setStatus("Ошибка сети", false);
            })
            .finally(function () {
              setBusy(false);
            });
        });
      }

      if (revokeBtn) {
        revokeBtn.addEventListener("click", function () {
          if (revokeBtn.disabled) {
            return;
          }
          setBusy(true);
          saveContactAction(rowClientGuid, taskId, { marked: false })
            .then(function (result) {
              if (result.response.status === 200) {
                return Promise.resolve(onSaved());
              }
              setStatus(
                (result.data && result.data.message) || "Не удалось отменить отметку",
                false,
              );
            })
            .catch(function () {
              setStatus("Ошибка сети", false);
            })
            .finally(function () {
              setBusy(false);
            });
        });
      }
    });
  }

  function reloadBitrix24Data(root, clientGuid, preservedUi) {
    var tasksPromise = loadBitrix24Sections(
      root,
      clientGuid,
      preservedUi || captureBitrix24UiState(root),
    );
    var claimsPromise = mountClaimsTab(root, clientGuid);
    return Promise.all([tasksPromise, claimsPromise]).then(function (results) {
      return {
        ok: results[0].ok !== false && results[1].ok !== false,
        tasks: results[0],
        claims: results[1],
      };
    });
  }

  function mountWorkTab(root, clientGuid) {
    var promise = loadBitrix24Sections(root, clientGuid, null);
    root._bitrix24WorkLoadPromise = promise;
    return promise;
  }

  function mountClaimsTab(root, clientGuid) {
    var container = root.querySelector("#pc-bitrix24-claims");
    if (!container) {
      return Promise.resolve({ ok: true });
    }
    var loadId = (root._claimsLoadId || 0) + 1;
    root._claimsLoadId = loadId;
    container.innerHTML = renderState("Загрузка рекламаций…", "loading");
    return api
      .apiRequest("/api/clients/" + encodeURIComponent(clientGuid) + "/bitrix24/claims")
      .then(function (result) {
        if (loadId !== root._claimsLoadId || !root.isConnected) {
          return { ok: true, stale: true };
        }
        if (result.response.status === 403 || result.response.status === 404) {
          container.innerHTML = renderState("Доступ к рекламациям недоступен.", "error");
          updateClaimsStat(root, null);
          return { ok: false };
        }
        if (result.response.status !== 200 || !result.data) {
          container.innerHTML = renderState("Не удалось загрузить рекламации.", "error");
          updateClaimsStat(root, null);
          return { ok: false };
        }
        var body = result.data;
        updateClaimsStat(root, typeof body.count === "number" ? body.count : null);
        if (
          body.state === "access_expired" ||
          body.state === "stale_snapshot" ||
          body.state === "link_unverified" ||
          body.state === "cache_not_published" ||
          body.state === "not_configured"
        ) {
          container.innerHTML = renderState(
            body.message || "Данные рекламаций недоступны.",
            "error",
          );
          return { ok: true };
        }
        if (body.state === "ready" && body.claims && body.claims.length) {
          var meta = "";
          if (body.sync && body.sync.lastFinishedAtLabel) {
            meta =
              '<p class="pc-label">Последняя синхронизация: ' +
              esc(body.sync.lastFinishedAtLabel) +
              (body.sync.partial ? " (неполная)" : "") +
              "</p>";
          }
          container.innerHTML =
            meta +
            '<p class="pc-label">Показаны только разрешённые сводки исходных задач. Внутреннее описание, переписка и вложения не отображаются.</p>' +
            body.claims
              .map(function (claim) {
                return renderClaimRow(claim, clientGuid);
              })
              .join("");
          bindContactActions(container, clientGuid, root);
          return { ok: true };
        }
        container.innerHTML = renderState(
          body.message || "Опубликованные рекламации не найдены.",
          body.state === "empty" ? "empty" : "info",
        );
        return { ok: true };
      })
      .catch(function () {
        if (loadId !== root._claimsLoadId || !root.isConnected) {
          return { ok: true, stale: true };
        }
        container.innerHTML = renderState("Не удалось загрузить рекламации.", "error");
        updateClaimsStat(root, null);
        return { ok: false };
      });
  }

  function updateClaimsStat(root, count) {
    var stat = root.querySelector(".pc-stat .pc-number[data-stat-claims]");
    if (!stat) {
      return;
    }
    stat.textContent = count === null ? "—" : String(count);
  }

  function loadBitrix24Sections(root, clientGuid, uiStateToRestore) {
    var container = root.querySelector("#pc-bitrix24-work");
    if (!container) {
      return Promise.resolve({ ok: true });
    }
    ensureSyncControls(root, clientGuid);
    var loadId = (root._bitrix24LoadId || 0) + 1;
    root._bitrix24LoadId = loadId;
    var overview = root.querySelector("#pc-bitrix24-overview");
    if (overview) overview.innerHTML = renderState("Загрузка задач…", "loading");
    container.innerHTML = renderState("Загрузка данных Битрикс24…", "loading");

    return Promise.all([
      api.apiRequest("/api/clients/" + encodeURIComponent(clientGuid) + "/bitrix24/label"),
      api.apiRequest("/api/clients/" + encodeURIComponent(clientGuid) + "/bitrix24/tasks"),
    ])
      .then(function (results) {
        if (root._bitrix24LoadId !== loadId || !root.isConnected) {
          return { ok: true };
        }
        var labelResult = results[0];
        var tasksResult = results[1];
        var labelStatus = labelResult.response.status;
        var labelBody = labelResult.data;
        var parts = [renderBitrix24SyncBlock()];

        if (labelStatus === 200 && labelBody && labelBody.token) {
          parts.push(
            '<div class="pc-bitrix24-label">' +
              '<div class="pc-label">Метка для описания задачи (отдельной строкой в описании)</div>' +
              '<p class="pc-label">Скопируйте метку и добавьте отдельной строкой в описание нужной рабочей задачи в Битрикс24. После этого нажмите «Синхронизировать с Битrix24» в этой карточке.</p>' +
              '<code class="pc-bitrix24-token">' +
              esc(labelBody.token) +
              "</code>" +
              '<button type="button" class="workspace-button workspace-button--secondary" id="pc-copy-bitrix24-label">Скопировать метку для Битрикс24</button>' +
              '<span class="workspace-status" id="pc-copy-bitrix24-label-status" role="status" aria-live="polite"></span>' +
              "</div>",
          );
        } else if (labelStatus === 409) {
          parts.push(
            renderState(
              (labelBody && labelBody.message) ||
                "Привязка ожидает подтверждения данных 1С.",
              "pending",
            ),
          );
        } else if (labelStatus === 404) {
          parts.push(
            renderState("Метка ещё не выдана.", "info") +
              '<button type="button" class="workspace-button workspace-button--primary" id="pc-issue-bitrix24-label">Выдать метку</button>' +
              '<span class="workspace-status" id="pc-copy-bitrix24-label-status" role="status" aria-live="polite"></span>',
          );
        } else {
          parts.push(renderState("Не удалось загрузить метку.", "error"));
        }

        if (tasksResult.response.status === 200 && tasksResult.data) {
          var body = tasksResult.data;
          var meta = [];
          if (body.scopeNote) {
            meta.push('<p class="pc-label">' + esc(body.scopeNote) + "</p>");
          }
          if (body.sync && body.sync.lastFinishedAtLabel) {
            meta.push(
              '<p class="pc-label">' +
                esc(
                  "Последняя синхронизация: " +
                    body.sync.lastFinishedAtLabel +
                    (body.sync.partial ? " (неполная выборка)" : ""),
                ) +
                "</p>",
            );
          }
          if (body.portalConfigured === false) {
            meta.push(
              '<p class="pc-label">' +
                esc("Публичный URL портала Bitrix24 не настроен — ссылки будут недоступны.") +
                "</p>",
            );
          }
          if (meta.length > 0) {
            parts.push('<div class="pc-bitrix24-meta">' + meta.join("") + "</div>");
          }
          if (body.state === "ready" && body.tasks && body.tasks.length > 0) {
            parts.push(
              '<div class="pc-bitrix24-tasks">' +
                body.tasks.map(function (task) {
                  return renderTaskRow(task, clientGuid);
                }).join("") +
                "</div>",
            );
          } else {
            parts.push(renderState(tasksMessage(body), body.state === "empty" ? "empty" : "info"));
          }
        } else {
          parts.push(renderState("Не удалось загрузить задачи.", "error"));
        }

        container.innerHTML = parts.join("");

        bindContactActions(container, clientGuid, root);
        renderOverview(root, clientGuid, tasksResult);
        restoreBitrix24UiState(root, uiStateToRestore);
        paintSyncToolbars(root);

        var copyBtn = container.querySelector("#pc-copy-bitrix24-label");
        var issueBtn = container.querySelector("#pc-issue-bitrix24-label");
        var statusEl = container.querySelector("#pc-copy-bitrix24-label-status");
        function setStatus(text, ok) {
          if (!statusEl) return;
          statusEl.textContent = text;
          statusEl.className =
            "workspace-status " +
            (ok ? "workspace-status--success" : "workspace-status--error");
        }
        if (copyBtn && labelBody && labelBody.token) {
          copyBtn.addEventListener("click", function () {
            window.ClientsShell.copyText(labelBody.token)
              .then(function () {
                setStatus("Метка скопирована", true);
              })
              .catch(function () {
                setStatus("Не удалось скопировать", false);
              });
          });
        }
        if (issueBtn) {
          issueBtn.addEventListener("click", function () {
            issueBtn.disabled = true;
            api
              .apiRequest("/api/clients/" + encodeURIComponent(clientGuid) + "/bitrix24/label", {
                method: "POST",
                body: {},
              })
              .then(function (response) {
                if (response.response.status === 200 || response.response.status === 201) {
                  reloadBitrix24Data(root, clientGuid);
                  return;
                }
                setStatus(
                  (response.data && response.data.message) || "Не удалось выдать метку",
                  false,
                );
              })
              .catch(function () {
                setStatus("Ошибка сети", false);
              })
              .finally(function () {
                issueBtn.disabled = false;
              });
          });
        }
        return tasksResult.response.status === 200 && tasksResult.data
          ? { ok: true }
          : { ok: false, error: "Не удалось загрузить задачи." };
      })
      .catch(function () {
        if (root._bitrix24LoadId !== loadId || !root.isConnected) {
          return { ok: true };
        }
        container.innerHTML = renderState("Не удалось загрузить блок Битрикс24.", "error");
        renderOverview(root, clientGuid, null);
        paintSyncToolbars(root);
        return { ok: false, error: "Не удалось загрузить блок Битрикс24." };
      });
  }

  window.ClientBitrix24 = {
    mountWorkTab: mountWorkTab,
    mountClaimsTab: mountClaimsTab,
    reloadBitrix24Data: reloadBitrix24Data,
    renderChecklistProgress: renderChecklistProgress,
    renderChecklistExpandable: renderChecklistExpandable,
    bindChecklistLazyLoad: bindChecklistLazyLoad,
    renderResponsibleBlock: renderResponsibleBlock,
    renderContactAction: renderContactAction,
    bindContactActions: bindContactActions,
    esc: esc,
  };
})();
