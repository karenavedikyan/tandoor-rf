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
    audience_denied: "Задачи недоступны: ответственный не совпадает с вашим Bitrix ID.",
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

  function renderTaskRow(task) {
    var deadline = task.deadline ? esc(task.deadline) : "—";
    var responsible = task.responsibleBitrixUserId
      ? esc("Bitrix ID " + task.responsibleBitrixUserId)
      : "—";
    var link = task.portalUrl
      ? '<a class="pc-link" href="' +
        esc(task.portalUrl) +
        '" target="_blank" rel="noopener noreferrer">Открыть в Битрикс24</a>'
      : '<span class="pc-label">Ссылка на портал не настроена</span>';
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
      '<div class="pc-label">Ответственный: ' +
      responsible +
      "</div>" +
      link +
      "</article>"
    );
  }

  function tasksMessage(body) {
    if (body.message) {
      return body.message;
    }
    return TASK_STATE_MESSAGES[body.state] || TASK_STATE_MESSAGES.empty;
  }

  function mountWorkTab(root, clientGuid) {
    var container = root.querySelector("#pc-bitrix24-work");
    if (!container) {
      return;
    }
    container.innerHTML = renderState("Загрузка данных Битрикс24…", "loading");

    Promise.all([
      api.apiRequest("/api/clients/" + encodeURIComponent(clientGuid) + "/bitrix24/label"),
      api.apiRequest("/api/clients/" + encodeURIComponent(clientGuid) + "/bitrix24/tasks"),
    ])
      .then(function (results) {
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
              '<div class="pc-bitrix24-tasks">' + body.tasks.map(renderTaskRow).join("") + "</div>",
            );
          } else {
            parts.push(renderState(tasksMessage(body), body.state === "empty" ? "empty" : "info"));
          }
        } else {
          parts.push(renderState("Не удалось загрузить задачи.", "error"));
        }

        container.innerHTML = parts.join("");

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
        container.innerHTML = renderState("Не удалось загрузить блок Битрикс24.", "error");
      });
  }

  window.ClientBitrix24 = { mountWorkTab: mountWorkTab };
})();
