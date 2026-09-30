(function () {
  "use strict";

  var api = window.TandoorRf;

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
        } else {
          labelBlock =
            renderState("Метка ещё не выдана.", "info") +
            '<button type="button" class="workspace-button workspace-button--primary" id="pc-issue-bitrix24-label">Скопировать метку для Битрикс24</button>' +
            '<span class="workspace-status" id="pc-copy-bitrix24-label-status" role="status" aria-live="polite"></span>';
        }

        var tasksBlock = "";
        if (tasksResult.response.status === 200 && tasksResult.data) {
          var body = tasksResult.data;
          if (body.state === "not_configured") {
            tasksBlock = renderState("Bitrix24 не настроен.", "info");
          } else if (body.state === "cache_not_published") {
            tasksBlock = renderState("Синхронизация задач ещё не опубликована.", "info");
          } else if (!body.tasks || body.tasks.length === 0) {
            tasksBlock = renderState("Задачи с меткой этого объекта пока не найдены.", "empty");
          } else {
            tasksBlock =
              '<div class="pc-bitrix24-tasks">' +
              body.tasks.map(renderTaskRow).join("") +
              "</div>";
          }
          if (body.scopeNote) {
            tasksBlock =
              '<p class="pc-label">' +
              esc(body.scopeNote) +
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
