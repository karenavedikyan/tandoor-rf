(function () {
  "use strict";

  var api = window.TandoorRf;

  var TASK_STATE_MESSAGES = {
    not_configured: "Bitrix24 не настроен.",
    cache_not_published: "Синхронизация задач ещё не опубликована.",
    empty: "Задачи с меткой этого объекта пока не найдены.",
    no_employee_link: "Связь с порталом Bitrix24 не подтверждена.",
    access_expired: "Подтверждение доступа к Bitrix24 истекло.",
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
      esc(task.changedAt) +
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
        var labelBlock = "";
        if (labelStatus === 200 && labelBody && labelBody.token) {
          labelBlock =
            '<div class="pc-bitrix24-label">' +
            '<div class="pc-label">Метка для описания задачи</div>' +
            '<code class="pc-bitrix24-token">' +
            esc(labelBody.token) +
            "</code>" +
            '<button type="button" class="workspace-button workspace-button--secondary" id="pc-copy-bitrix24-label">Скопировать метку для Битрикс24</button>' +
            '<span class="workspace-status" id="pc-copy-bitrix24-label-status" role="status" aria-live="polite"></span>' +
            "</div>";
        } else if (labelStatus === 409) {
          labelBlock = renderState(
            (labelBody && labelBody.message) ||
              "Привязка ожидает подтверждения данных 1С.",
            "pending",
          );
        } else if (labelStatus === 404) {
          labelBlock =
            renderState("Метка ещё не выдана.", "info") +
            '<button type="button" class="workspace-button workspace-button--primary" id="pc-issue-bitrix24-label">Выдать метку</button>' +
            '<span class="workspace-status" id="pc-copy-bitrix24-label-status" role="status" aria-live="polite"></span>';
        } else {
          labelBlock = renderState("Не удалось загрузить метку.", "error");
        }

        var tasksBlock = "";
        if (tasksResult.response.status === 200 && tasksResult.data) {
          var body = tasksResult.data;
          if (body.state === "ready" && body.tasks && body.tasks.length > 0) {
            tasksBlock =
              '<div class="pc-bitrix24-tasks">' +
              body.tasks.map(renderTaskRow).join("") +
              "</div>";
          } else {
            tasksBlock = renderState(tasksMessage(body), body.state === "empty" ? "empty" : "info");
          }
          if (body.scopeNote) {
            tasksBlock =
              '<p class="pc-label">' +
              esc(body.scopeNote) +
              "</p>" +
              tasksBlock;
          }
          if (body.visibility && body.visibility.filteredCount > 0) {
            tasksBlock +=
              '<p class="pc-label">' +
              esc(
                "Часть задач скрыта проверками доступа (" +
                  body.visibility.filteredCount +
                  ").",
              ) +
              "</p>" +
              tasksBlock;
          }
          if (body.sync && body.sync.lastFinishedAt) {
            tasksBlock =
              '<p class="pc-label">' +
              esc(
                "Последняя синхронизация: " +
                  body.sync.lastFinishedAt +
                  " · " +
                  body.sync.lastStatus,
              ) +
              "</p>" +
              tasksBlock;
          }
          if (body.portalConfigured === false) {
            tasksBlock =
              '<p class="pc-label">' +
              esc("Публичный URL портала Bitrix24 не настроен — ссылки будут недоступны.") +
              "</p>" +
              tasksBlock;
          }
        } else {
          tasksBlock = renderState("Не удалось загрузить задачи.", "error");
        }

        container.innerHTML = labelBlock + tasksBlock;

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
