(function () {
  "use strict";

  var api = window.TandoorRf;
  var shell = window.ClientsShell;
  var currentUser = null;
  var overviewData = null;

  var STATUS_LABELS = {
    draft: "Черновик",
    pending_approval: "На согласовании",
    active: "Действует",
    revoked: "Отозвано",
  };

  var WORKSPACE_ROLES = {
    manager: true,
    rop: true,
    coordinator: true,
    director: true,
  };

  function setStatus(text, kind) {
    api.setStatus(document.getElementById("access-workspace-status"), text, kind);
  }

  function escapeCell(value) {
    if (value === null || value === undefined) return "—";
    return shell.escapeHtml(String(value));
  }

  function renderTable(columns, rows) {
    if (!rows || rows.length === 0) {
      return '<p class="clients-subtitle">Нет записей.</p>';
    }
    var head =
      "<thead><tr>" +
      columns
        .map(function (col) {
          return "<th>" + shell.escapeHtml(col.label) + "</th>";
        })
        .join("") +
      "</tr></thead>";
    var body = rows
      .map(function (row) {
        return (
          "<tr>" +
          columns
            .map(function (col) {
              return "<td>" + escapeCell(row[col.key]) + "</td>";
            })
            .join("") +
          "</tr>"
        );
      })
      .join("");
    return '<table class="clients-table">' + head + "<tbody>" + body + "</tbody></table>";
  }

  function formatStatus(status) {
    return STATUS_LABELS[status] || status;
  }

  function showRoleSections(role) {
    document.querySelectorAll("[data-role-section]").forEach(function (section) {
      var roles = section.getAttribute("data-role-section").split(",");
      var visible = roles.indexOf(role) >= 0;
      section.classList.toggle("clients-hidden", !visible);
    });
  }

  function loadManagerClients() {
    return api.apiRequest("/api/clients?pageSize=100").then(function (result) {
      if (result.response.status !== 200) {
        throw new Error(api.extractErrorMessage(result.data, "Не удалось загрузить клиентов."));
      }
      var select = document.getElementById("manager-clients");
      if (!select) return;
      select.innerHTML = (result.data.items || [])
        .map(function (item) {
          return (
            '<option value="' +
            shell.escapeHtml(item.guid) +
            '">' +
            shell.escapeHtml(item.name) +
            " (" +
            shell.escapeHtml(item.guid.slice(0, 8)) +
            "…)</option>"
          );
        })
        .join("");
    });
  }

  function renderDelegationsActions(row) {
    var actions = [];
    if (currentUser.role === "rop" || currentUser.role === "director") {
      if (row.status === "pending_approval") {
        actions.push(
          '<button type="button" class="workspace-button workspace-button--primary" data-action="approve" data-id="' +
            shell.escapeHtml(row.id) +
            '">Согласовать</button>',
        );
      }
    }
    if (row.status !== "revoked") {
      actions.push(
        '<button type="button" class="workspace-button workspace-button--secondary" data-action="revoke" data-id="' +
          shell.escapeHtml(row.id) +
          '">Отозвать</button>',
      );
    }
    if (row.pending_change) {
      actions.push('<span class="clients-subtitle">Изменение на согласовании — действующий доступ без расширения</span>');
    }
    return actions.join(" ");
  }

  function renderDelegationsTable() {
    var rows = (overviewData && overviewData.delegations) || [];
    var columns = [
      { key: "delegator_name", label: "Передающий" },
      { key: "assistant_name", label: "Ассистент" },
      { key: "status_label", label: "Статус" },
      { key: "starts_at", label: "Начало" },
      { key: "ends_at", label: "Окончание" },
      { key: "client_count", label: "Клиентов" },
      { key: "actions", label: "Действия" },
    ];

    var enriched = rows.map(function (row) {
      return {
        delegator_name: row.delegator_name || row.delegator_email || "—",
        assistant_name: row.assistant_name || row.assistant_email || "—",
        status_label: formatStatus(row.status),
        starts_at: row.starts_at,
        ends_at: row.ends_at,
        client_count: row.client_count != null ? row.client_count : "—",
        actions: renderDelegationsActions(row),
        id: row.id,
        status: row.status,
        pending_change: row.pending_change,
      };
    });

    var tableEl = document.getElementById("delegations-table");
    if (!tableEl) return;

    if (enriched.length === 0) {
      tableEl.innerHTML = '<p class="clients-subtitle">Нет замещений в вашей области.</p>';
      return;
    }

    tableEl.innerHTML = renderTable(columns, enriched);
    tableEl.querySelectorAll("[data-action]").forEach(function (btn) {
      btn.addEventListener("click", function () {
        var id = btn.getAttribute("data-id");
        var action = btn.getAttribute("data-action");
        if (action === "approve") {
          api
            .apiRequest("/api/access/delegations/" + encodeURIComponent(id) + "/approve", {
              method: "POST",
              body: { basis: "Согласовано через интерфейс" },
            })
            .then(function (result) {
              if (result.response.status !== 200) {
                throw new Error(api.extractErrorMessage(result.data, "Не удалось согласовать."));
              }
              setStatus("Замещение согласовано.", "success");
              return refreshOverview();
            })
            .catch(function (err) {
              setStatus(err.message, "error");
            });
        }
        if (action === "revoke") {
          api
            .apiRequest("/api/access/delegations/" + encodeURIComponent(id) + "/revoke", {
              method: "POST",
              body: { basis: "Отозвано через интерфейс", reason: "Досрочный отзыв" },
            })
            .then(function (result) {
              if (result.response.status !== 200) {
                throw new Error(api.extractErrorMessage(result.data, "Не удалось отозвать."));
              }
              setStatus("Замещение отозвано.", "success");
              return refreshOverview();
            })
            .catch(function (err) {
              setStatus(err.message, "error");
            });
        }
      });
    });
  }

  function refreshOverview() {
    return api.apiRequest("/api/access/overview").then(function (result) {
      if (result.response.status !== 200) {
        throw new Error(api.extractErrorMessage(result.data, "Не удалось загрузить обзор."));
      }
      overviewData = result.data;
      renderDelegationsTable();

      if (currentUser.role === "rop") {
        return api.apiRequest("/api/access/team-members").then(function (teamResult) {
          if (teamResult.response.status === 200) {
            document.getElementById("rop-team-table").innerHTML = renderTable(
              [
                { key: "member_name", label: "Участник" },
                { key: "member_email", label: "Email" },
                { key: "member_role", label: "Роль" },
              ],
              teamResult.data.members || [],
            );
          }
        });
      }

      if (currentUser.role === "coordinator" && overviewData.teams) {
        document.getElementById("coordinator-teams-table").innerHTML = renderTable(
          [
            { key: "rop_name", label: "РОП" },
            { key: "rop_email", label: "Email" },
            { key: "basis", label: "Основание" },
          ],
          overviewData.teams,
        );
      }
    });
  }

  document.getElementById("manager-assistant-search-btn")?.addEventListener("click", function () {
    var q = document.getElementById("manager-assistant-search").value.trim();
    if (q.length < 2) {
      setStatus("Введите минимум 2 символа для поиска ассистента.", "error");
      return;
    }
    api
      .apiRequest("/api/access/assistants/search?q=" + encodeURIComponent(q))
      .then(function (result) {
        if (result.response.status !== 200) {
          throw new Error(api.extractErrorMessage(result.data, "Поиск не удался."));
        }
        var container = document.getElementById("manager-assistant-results");
        var assistants = result.data.assistants || [];
        if (assistants.length === 0) {
          container.innerHTML = '<p class="clients-subtitle">Ассистенты не найдены.</p>';
          return;
        }
        container.innerHTML = assistants
          .map(function (a) {
            return (
              '<button type="button" class="workspace-button workspace-button--secondary" data-assistant-id="' +
              shell.escapeHtml(a.id) +
              '">' +
              shell.escapeHtml(a.full_name) +
              " · " +
              shell.escapeHtml(a.email) +
              "</button> "
            );
          })
          .join("");
        container.querySelectorAll("[data-assistant-id]").forEach(function (btn) {
          btn.addEventListener("click", function () {
            document.getElementById("manager-assistant-id").value = btn.getAttribute("data-assistant-id");
            setStatus("Ассистент выбран.", "success");
          });
        });
      })
      .catch(function (err) {
        setStatus(err.message, "error");
      });
  });

  document.getElementById("manager-delegation-form")?.addEventListener("submit", function (event) {
    event.preventDefault();
    var assistantId = document.getElementById("manager-assistant-id").value.trim();
    var select = document.getElementById("manager-clients");
    var clientGuids = Array.from(select.selectedOptions).map(function (opt) {
      return opt.value;
    });
    if (!assistantId) {
      setStatus("Выберите ассистента из результатов поиска.", "error");
      return;
    }
    if (clientGuids.length === 0) {
      setStatus("Выберите хотя бы одного клиента.", "error");
      return;
    }
    var startsLocal = document.getElementById("manager-starts").value;
    var endsLocal = document.getElementById("manager-ends").value;
    api
      .apiRequest("/api/access/delegations", {
        method: "POST",
        body: {
          assistantUserId: assistantId,
          clientGuids: clientGuids,
          startsAt: new Date(startsLocal).toISOString(),
          endsAt: new Date(endsLocal).toISOString(),
          basis: document.getElementById("manager-basis").value.trim(),
          submit: true,
        },
      })
      .then(function (result) {
        if (result.response.status !== 201) {
          throw new Error(api.extractErrorMessage(result.data, "Не удалось создать замещение."));
        }
        setStatus("Замещение отправлено на согласование.", "success");
        return refreshOverview();
      })
      .catch(function (err) {
        setStatus(err.message, "error");
      });
  });

  document.getElementById("explain-self-form")?.addEventListener("submit", function (event) {
    event.preventDefault();
    if (!currentUser) return;
    var clientGuid = document.getElementById("explain-client-guid").value.trim();
    api
      .apiRequest(
        "/api/access/explain?userId=" +
          encodeURIComponent(currentUser.id) +
          "&clientGuid=" +
          encodeURIComponent(clientGuid),
      )
      .then(function (result) {
        if (result.response.status !== 200) {
          throw new Error(api.extractErrorMessage(result.data, "Диагностика недоступна."));
        }
        document.getElementById("explain-self-result").innerHTML = renderTable(
          [
            { key: "allowed", label: "Разрешено" },
            { key: "reason", label: "Код" },
            { key: "details", label: "Пояснение" },
          ],
          [
            {
              allowed: result.data.explain.allowed ? "да" : "нет",
              reason: result.data.explain.reason,
              details: result.data.explain.details,
            },
          ],
        );
      })
      .catch(function (err) {
        setStatus(err.message, "error");
      });
  });

  shell.mountShell("access-workspace", { showClients: true, showAccessWorkspace: true });
  api
    .apiRequest("/api/auth/me")
    .then(function (result) {
      if (result.response.status !== 200) {
        throw new Error("Требуется вход.");
      }
      currentUser = result.data.user;
      if (!WORKSPACE_ROLES[currentUser.role]) {
        document.getElementById("access-workspace-app").classList.add("clients-hidden");
        document.getElementById("access-panel").hidden = false;
        shell.setPanelMessage(
          document.getElementById("access-panel"),
          "forbidden",
          "Нет доступа",
          "Раздел замещений недоступен для вашей роли.",
          "",
        );
        return;
      }
      document.getElementById("access-workspace-app").classList.remove("clients-hidden");
      showRoleSections(currentUser.role);
      var subtitles = {
        manager: "Создание и отзыв замещений по своим клиентам.",
        rop: "Согласование и отзыв замещений команды.",
        coordinator: "Планирование замещений назначенных команд (расширение — через РОП).",
        director: "Обзор, согласование и отзыв замещений.",
      };
      document.getElementById("access-workspace-subtitle").textContent =
        subtitles[currentUser.role] || "";

      var tasks = [refreshOverview()];
      if (currentUser.role === "manager") {
        tasks.push(loadManagerClients());
      }
      return Promise.all(tasks);
    })
    .catch(function (err) {
      setStatus(err.message || "Ошибка загрузки.", "error");
    });
})();
