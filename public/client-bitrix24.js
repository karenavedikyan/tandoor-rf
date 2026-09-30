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
    if (compact) {
      return '<div class="pc-bitrix24-contact" data-task-id="' + taskKey + '">' +
        '<label class="pc-bitrix24-contact-label">' +
        '<input type="checkbox" class="pc-bitrix24-contact-checkbox"' + checked +
        ' aria-label="Связаться с ответственным" /><span>Связаться с ответственным</span></label>' +
        completed +
        '<span class="workspace-status pc-bitrix24-contact-status" role="status" aria-live="polite"></span></div>';
    }
    return (
      '<div class="pc-bitrix24-contact" data-task-id="' +
      taskKey +
      '">' +
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
      '<article class="pc-bitrix24-task">' +
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
    html += '<button type="button" class="pc-link pc-bitrix24-refresh" data-testid="refresh-bitrix24-overview">Обновить данные ЛК</button>';
    container.innerHTML = html;
    bindContactActions(container, clientGuid, root);
    container.querySelector(".pc-bitrix24-show-work").addEventListener("click", function () {
      root.querySelector('[data-card-tab="work"]').click();
      root.querySelector('[data-card-tab="work"]').focus();
    });
    container.querySelector(".pc-bitrix24-refresh").addEventListener("click", function () {
      mountWorkTab(root, clientGuid);
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

  function bindContactActions(container, clientGuid, root) {
    container.querySelectorAll(".pc-bitrix24-contact").forEach(function (block) {
      var taskId = block.getAttribute("data-task-id");
      if (!taskId) {
        return;
      }
      var checkbox = block.querySelector(".pc-bitrix24-contact-checkbox");
      var statusEl = block.querySelector(".pc-bitrix24-contact-status");
      var commentBtn = block.querySelector(".pc-bitrix24-contact-comment-btn");
      var revokeBtn = block.querySelector(".pc-bitrix24-contact-revoke-btn");
      var commentInput = block.querySelector(".pc-bitrix24-contact-comment-input");
      function setBusy(busy) {
        root.querySelectorAll(".pc-bitrix24-contact").forEach(function (peer) {
          if (peer.getAttribute("data-task-id") !== taskId) return;
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
          var desired = checkbox.checked;
          setBusy(true);
          saveContactAction(clientGuid, taskId, { marked: desired })
            .then(function (result) {
              if (result.response.status === 200) {
                mountWorkTab(root, clientGuid);
                return;
              }
              checkbox.checked = !desired;
              setStatus(
                (result.data && result.data.message) || "Не удалось сохранить отметку",
                false,
              );
            })
            .catch(function () {
              checkbox.checked = !desired;
              setStatus("Ошибка сети", false);
            })
            .finally(function () {
              setBusy(false);
            });
        });
      }

      if (commentBtn) {
        commentBtn.addEventListener("click", function () {
          if (!checkbox || !checkbox.checked || !commentInput) {
            return;
          }
          var value = commentInput.value;
          setBusy(true);
          saveContactAction(clientGuid, taskId, { marked: true, comment: value })
            .then(function (result) {
              if (result.response.status === 200) {
                mountWorkTab(root, clientGuid);
                return;
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
          setBusy(true);
          saveContactAction(clientGuid, taskId, { marked: false })
            .then(function (result) {
              if (result.response.status === 200) {
                mountWorkTab(root, clientGuid);
                return;
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

  function mountWorkTab(root, clientGuid) {
    var container = root.querySelector("#pc-bitrix24-work");
    if (!container) {
      return;
    }
    var loadId = (root._bitrix24LoadId || 0) + 1;
    root._bitrix24LoadId = loadId;
    var overview = root.querySelector("#pc-bitrix24-overview");
    if (overview) overview.innerHTML = renderState("Загрузка задач…", "loading");
    container.innerHTML = renderState("Загрузка данных Битрикс24…", "loading");

    Promise.all([
      api.apiRequest("/api/clients/" + encodeURIComponent(clientGuid) + "/bitrix24/label"),
      api.apiRequest("/api/clients/" + encodeURIComponent(clientGuid) + "/bitrix24/tasks"),
    ])
      .then(function (results) {
        if (root._bitrix24LoadId !== loadId || !root.isConnected) return;
        var labelResult = results[0];
        var tasksResult = results[1];
        var labelStatus = labelResult.response.status;
        var labelBody = labelResult.data;
        var parts = [];

        if (labelStatus === 200 && labelBody && labelBody.token) {
          parts.push(
            '<div class="pc-bitrix24-label">' +
              '<div class="pc-label">Метка для описания задачи (отдельной строкой в описании)</div>' +
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
                  mountWorkTab(root, clientGuid);
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
      })
      .catch(function () {
        if (root._bitrix24LoadId !== loadId || !root.isConnected) return;
        container.innerHTML = renderState("Не удалось загрузить блок Битрикс24.", "error");
        renderOverview(root, clientGuid, null);
      });
  }

  window.ClientBitrix24 = { mountWorkTab: mountWorkTab };
})();
