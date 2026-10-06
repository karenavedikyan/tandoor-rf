(function () {
  "use strict";

  var api = window.TandoorRf;
  var shell = window.ClientsShell;
  var overviewData = null;
  var activeTab = "links";

  function setStatus(text, kind) {
    api.setStatus(document.getElementById("admin-access-status"), text, kind);
  }

  function renderTable(columns, rows) {
    if (!rows || rows.length === 0) {
      return '<p class="clients-subtitle">Нет записей.</p>';
    }
    var head =
      "<thead><tr>" +
      columns.map(function (col) {
        return "<th>" + shell.escapeHtml(col.label) + "</th>";
      }).join("") +
      "</tr></thead>";
    var body = rows
      .map(function (row) {
        return (
          "<tr>" +
          columns
            .map(function (col) {
              var value = row[col.key];
              if (value === null || value === undefined) {
                value = "—";
              } else if (typeof value === "object") {
                value = JSON.stringify(value);
              }
              return "<td>" + shell.escapeHtml(String(value)) + "</td>";
            })
            .join("") +
          "</tr>"
        );
      })
      .join("");
    return '<table class="clients-table">' + head + "<tbody>" + body + "</tbody></table>";
  }

  function tabDefinitions() {
    return {
      links: {
        label: "Связи 1С",
        columns: [
          { key: "user_email", label: "Пользователь" },
          { key: "employee_id", label: "Employee ID" },
          { key: "basis", label: "Основание" },
          { key: "revoked_at", label: "Отозвано" },
        ],
        rows: overviewData ? overviewData.links : [],
      },
      grants: {
        label: "Назначения",
        columns: [
          { key: "user_email", label: "Пользователь" },
          { key: "client_name", label: "Клиент" },
          { key: "object_id", label: "GUID" },
          { key: "basis", label: "Основание" },
        ],
        rows: overviewData ? overviewData.grants : [],
      },
      teams: {
        label: "Команды РОП",
        columns: [
          { key: "rop_email", label: "РОП" },
          { key: "member_email", label: "Участник" },
          { key: "basis", label: "Основание" },
        ],
        rows: overviewData ? overviewData.teams : [],
      },
      delegations: {
        label: "Замещения",
        columns: [
          { key: "delegator_email", label: "Передающий" },
          { key: "assistant_email", label: "Ассистент" },
          { key: "status", label: "Статус" },
          { key: "starts_at", label: "Начало" },
          { key: "ends_at", label: "Конец" },
          { key: "approver_email", label: "Согласовал" },
        ],
        rows: overviewData ? overviewData.delegations : [],
      },
      denials: {
        label: "Запреты",
        columns: [
          { key: "user_email", label: "Пользователь" },
          { key: "scope_type", label: "Тип" },
          { key: "object_id", label: "Объект" },
          { key: "reason", label: "Причина" },
        ],
        rows: overviewData ? overviewData.denials : [],
      },
      audit: {
        label: "Аудит",
        columns: [
          { key: "created_at", label: "Когда" },
          { key: "actor_email", label: "Исполнитель" },
          { key: "business_actor_email", label: "Согласующий" },
          { key: "action", label: "Действие" },
          { key: "basis", label: "Основание" },
        ],
        rows: overviewData ? overviewData.audit : [],
      },
    };
  }

  function renderOverview() {
    var tabs = tabDefinitions();
    var tabsEl = document.getElementById("overview-tabs");
    var tableEl = document.getElementById("overview-table");
    var jsonEl = document.getElementById("overview-json");
    tabsEl.innerHTML = Object.keys(tabs)
      .map(function (key) {
        return (
          '<button type="button" class="workspace-button' +
          (activeTab === key ? " workspace-button--primary" : " workspace-button--secondary") +
          '" data-tab="' +
          key +
          '">' +
          shell.escapeHtml(tabs[key].label) +
          "</button>"
        );
      })
      .join(" ");
    tabsEl.querySelectorAll("[data-tab]").forEach(function (btn) {
      btn.addEventListener("click", function () {
        activeTab = btn.getAttribute("data-tab");
        renderOverview();
      });
    });
    var current = tabs[activeTab];
    tableEl.innerHTML = renderTable(current.columns, current.rows);
    jsonEl.textContent = JSON.stringify(overviewData, null, 2);
  }

  function loadOverview() {
    return api.apiRequest("/api/admin/access/overview").then(function (result) {
      if (result.response.status !== 200) {
        throw new Error(api.extractErrorMessage(result.data, "Не удалось загрузить обзор."));
      }
      overviewData = result.data;
      renderOverview();
    });
  }

  function bindForm(formId, handler) {
    var form = document.getElementById(formId);
    if (!form) return;
    form.addEventListener("submit", function (event) {
      event.preventDefault();
      Promise.resolve(handler()).catch(function (err) {
        setStatus(err.message || "Ошибка.", "error");
      });
    });
  }

  document.getElementById("user-search-btn")?.addEventListener("click", function () {
    var q = document.getElementById("user-search-input").value.trim();
    if (q.length < 2) {
      setStatus("Введите минимум 2 символа.", "error");
      return;
    }
    api
      .apiRequest("/api/admin/access/users/search?q=" + encodeURIComponent(q))
      .then(function (result) {
        if (result.response.status !== 200) {
          throw new Error(api.extractErrorMessage(result.data, "Поиск не удался."));
        }
        document.getElementById("user-search-results").innerHTML = renderTable(
          [
            { key: "full_name", label: "ФИО" },
            { key: "email", label: "Email" },
            { key: "role", label: "Роль" },
            { key: "status", label: "Статус" },
            { key: "id", label: "User ID" },
            { key: "employee_id", label: "Employee ID" },
          ],
          result.data.users,
        );
      })
      .catch(function (err) {
        setStatus(err.message, "error");
      });
  });

  bindForm("explain-form", function () {
    var userId = document.getElementById("explain-user-id").value.trim();
    var clientGuid = document.getElementById("explain-client-guid").value.trim();
    return api
      .apiRequest(
        "/api/admin/access/explain?userId=" +
          encodeURIComponent(userId) +
          "&clientGuid=" +
          encodeURIComponent(clientGuid),
      )
      .then(function (result) {
        if (result.response.status !== 200) {
          throw new Error(api.extractErrorMessage(result.data, "Диагностика не удалась."));
        }
        document.getElementById("explain-result").innerHTML = renderTable(
          [
            { key: "allowed", label: "Разрешено" },
            { key: "reason", label: "Причина" },
            { key: "details", label: "Пояснение" },
            { key: "userStatus", label: "Статус user" },
          ],
          [
            {
              allowed: result.data.explain.allowed ? "да" : "нет",
              reason: result.data.explain.reason,
              details: result.data.explain.details,
              userStatus: result.data.userStatus,
            },
          ],
        );
        setStatus("Диагностика выполнена.", "success");
      });
  });

  bindForm("link-form", function () {
    return api
      .apiRequest("/api/admin/access/employee-links", {
        method: "POST",
        body: {
          userId: document.getElementById("link-user-id").value.trim(),
          employeeId: document.getElementById("link-employee-id").value.trim(),
          basis: document.getElementById("link-basis").value.trim(),
        },
      })
      .then(function (result) {
        if (result.response.status !== 201) {
          throw new Error(api.extractErrorMessage(result.data, "Не удалось создать связь."));
        }
        setStatus("Связь создана.", "success");
        return loadOverview();
      });
  });

  bindForm("grant-form", function () {
    return api
      .apiRequest("/api/admin/access/grants", {
        method: "POST",
        body: {
          userId: document.getElementById("grant-user-id").value.trim(),
          objectId: document.getElementById("grant-object-id").value.trim(),
          basis: document.getElementById("grant-basis").value.trim(),
        },
      })
      .then(function (result) {
        if (result.response.status !== 201) {
          throw new Error(api.extractErrorMessage(result.data, "Не удалось создать назначение."));
        }
        setStatus("Назначение создано.", "success");
        return loadOverview();
      });
  });

  bindForm("team-form", function () {
    return api
      .apiRequest("/api/admin/access/rop-teams", {
        method: "POST",
        body: {
          ropUserId: document.getElementById("team-rop-id").value.trim(),
          memberUserId: document.getElementById("team-member-id").value.trim(),
          basis: document.getElementById("team-basis").value.trim(),
        },
      })
      .then(function (result) {
        if (result.response.status !== 201) {
          throw new Error(api.extractErrorMessage(result.data, "Не удалось добавить в команду."));
        }
        setStatus("Участник добавлен.", "success");
        return loadOverview();
      });
  });

  bindForm("coordinator-team-form", function () {
    return api
      .apiRequest("/api/admin/access/coordinator-teams", {
        method: "POST",
        body: {
          coordinatorUserId: document.getElementById("coord-user-id").value.trim(),
          ropUserId: document.getElementById("coord-rop-id").value.trim(),
          basis: document.getElementById("coord-basis").value.trim(),
        },
      })
      .then(function (result) {
        if (result.response.status !== 201) {
          throw new Error(api.extractErrorMessage(result.data, "Не удалось назначить координатора."));
        }
        setStatus("Координатор назначен на команду.", "success");
        return loadOverview();
      });
  });

  bindForm("record-approval-form", function () {
    var delegationId = document.getElementById("approval-delegation-id").value.trim();
    return api
      .apiRequest("/api/admin/access/delegations/" + encodeURIComponent(delegationId) + "/record-approval", {
        method: "POST",
        body: {
          businessApproverUserId: document.getElementById("approval-approver-id").value.trim(),
          decisionReference: document.getElementById("approval-decision-ref").value.trim(),
          basis: document.getElementById("approval-basis").value.trim(),
        },
      })
      .then(function (result) {
        if (result.response.status !== 200) {
          throw new Error(api.extractErrorMessage(result.data, "Не удалось зафиксировать согласование."));
        }
        setStatus("Согласование зафиксировано.", "success");
        return loadOverview();
      });
  });

  var PREVIEW_ROLE_LABELS = {
    manager: "Менеджер",
    regional_manager: "Региональный менеджер",
    rop: "РОП",
    director: "Директор",
  };

  function startEmployeePreview(userId) {
    return api
      .apiRequest("/api/admin/access/preview/start", {
        method: "POST",
        body: { userId: userId },
      })
      .then(function (result) {
        if (result.response.status !== 200) {
          throw new Error(api.extractErrorMessage(result.data, "Не удалось начать просмотр."));
        }
        window.location.href = "/clients";
      });
  }

  document.getElementById("preview-search-btn")?.addEventListener("click", function () {
    var q = document.getElementById("preview-search-input").value.trim();
    if (q.length < 2) {
      setStatus("Введите минимум 2 символа.", "error");
      return;
    }
    api
      .apiRequest("/api/admin/access/preview/candidates?q=" + encodeURIComponent(q))
      .then(function (result) {
        if (result.response.status !== 200) {
          throw new Error(api.extractErrorMessage(result.data, "Поиск не удался."));
        }
        var items = result.data.items || [];
        if (items.length === 0) {
          document.getElementById("preview-search-results").innerHTML =
            '<p class="clients-subtitle">Подходящие сотрудники не найдены.</p>';
          return;
        }
        document.getElementById("preview-search-results").innerHTML =
          '<table class="clients-table"><thead><tr><th>ФИО</th><th>Email</th><th>Роль</th><th></th></tr></thead><tbody>' +
          items
            .map(function (item) {
              var roleLabel = PREVIEW_ROLE_LABELS[item.role] || item.role;
              return (
                "<tr><td>" +
                shell.escapeHtml(item.fullName) +
                "</td><td>" +
                shell.escapeHtml(item.email) +
                "</td><td>" +
                shell.escapeHtml(roleLabel) +
                '</td><td><button type="button" class="workspace-button workspace-button--primary" data-preview-user="' +
                shell.escapeHtml(item.id) +
                '">Посмотреть</button></td></tr>'
              );
            })
            .join("") +
          "</tbody></table>";
        document.getElementById("preview-search-results").querySelectorAll("[data-preview-user]").forEach(function (btn) {
          btn.addEventListener("click", function () {
            startEmployeePreview(btn.getAttribute("data-preview-user")).catch(function (err) {
              setStatus(err.message, "error");
            });
          });
        });
      })
      .catch(function (err) {
        setStatus(err.message, "error");
      });
  });

  shell.mountShell("admin-access", { showClients: true, showAdminAccess: true });
  shell.ensureAdminAccess(function (_user, reason) {
    if (reason === "forbidden") {
      document.getElementById("admin-access-app").classList.add("clients-hidden");
      document.getElementById("access-panel").hidden = false;
      shell.setPanelMessage(
        document.getElementById("access-panel"),
        "forbidden",
        "Нет доступа",
        "Раздел доступен только техническому администратору.",
        "",
      );
      return;
    }
    document.getElementById("admin-access-app").classList.remove("clients-hidden");
    loadOverview().catch(function (err) {
      setStatus(err.message, "error");
    });
  });
})();
