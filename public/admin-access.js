(function () {
  "use strict";

  var api = window.TandoorRf;
  var shell = window.ClientsShell;
  var accessPanel = document.getElementById("access-panel");
  var appEl = document.getElementById("admin-access-app");
  var overviewEl = document.getElementById("overview-content");
  var statusEl = document.getElementById("admin-access-status");
  var explainResultEl = document.getElementById("explain-result");

  function setStatus(text, kind) {
    api.setStatus(statusEl, text, kind);
  }

  function showForbidden() {
    appEl.classList.add("clients-hidden");
    accessPanel.hidden = false;
    accessPanel.classList.remove("clients-hidden");
    shell.setPanelMessage(
      accessPanel,
      "forbidden",
      "Нет доступа",
      "Раздел доступен только техническому администратору.",
      '<a class="workspace-button workspace-button--secondary" href="/profile">В профиль</a>',
    );
  }

  function renderOverview(data) {
    var sections = [
      ["Пользователи", data.users],
      ["Связи 1С", data.links],
      ["Назначения", data.grants],
      ["Команды РОП", data.teams],
      ["Координаторы", data.coordinatorTeams],
      ["Замещения", data.delegations],
      ["Аудит", data.audit],
    ];
    overviewEl.innerHTML = sections
      .map(function (entry) {
        var title = entry[0];
        var rows = entry[1] || [];
        return (
          '<h3 class="clients-card__subtitle">' +
          shell.escapeHtml(title) +
          " (" +
          rows.length +
          ")</h3>" +
          '<pre class="clients-code-block">' +
          shell.escapeHtml(JSON.stringify(rows.slice(0, 20), null, 2)) +
          "</pre>"
        );
      })
      .join("");
  }

  function loadOverview() {
    return api.apiRequest("/api/admin/access/overview").then(function (result) {
      if (result.response.status !== 200) {
        throw new Error(api.extractErrorMessage(result.data, "Не удалось загрузить обзор."));
      }
      renderOverview(result.data);
    });
  }

  function bindForm(formId, handler) {
    var form = document.getElementById(formId);
    if (!form) {
      return;
    }
    form.addEventListener("submit", function (event) {
      event.preventDefault();
      handler(new FormData(form)).catch(function (err) {
        setStatus(err.message || "Ошибка операции.", "error");
      });
    });
  }

  bindForm("explain-form", function () {
    var userId = document.getElementById("explain-user-id").value.trim();
    var clientGuid = document.getElementById("explain-client-guid").value.trim();
    var query =
      "/api/admin/access/explain?userId=" +
      encodeURIComponent(userId) +
      "&clientGuid=" +
      encodeURIComponent(clientGuid);
    return api.apiRequest(query).then(function (result) {
      if (result.response.status !== 200) {
        throw new Error(api.extractErrorMessage(result.data, "Не удалось выполнить проверку."));
      }
      explainResultEl.textContent = JSON.stringify(result.data.explain, null, 2);
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
        setStatus("Участник команды добавлен.", "success");
        return loadOverview();
      });
  });

  shell.mountShell("admin-access", { showClients: true, showAdminAccess: true });
  shell.ensureAdminAccess(function (_user, reason) {
    if (reason === "forbidden") {
      showForbidden();
      return;
    }
    if (reason) {
      setStatus("Не удалось проверить доступ.", "error");
      return;
    }
    appEl.classList.remove("clients-hidden");
    loadOverview().catch(function (err) {
      setStatus(err.message || "Ошибка загрузки.", "error");
    });
  });
})();
