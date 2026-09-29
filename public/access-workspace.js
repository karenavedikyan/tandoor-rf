(function () {
  "use strict";

  var api = window.TandoorRf;
  var shell = window.ClientsShell;
  var dt = window.AccessDatetime;
  var currentUser = null;
  var overviewData = null;
  var activeDetail = null;
  var actionBusy = false;

  var WORKSPACE_ROLES = {
    manager: true,
    rop: true,
    coordinator: true,
    director: true,
  };

  var pickers = {
    manager: { delegatorId: null, page: 1, pageSize: 50, q: "", selected: {} },
    coordinator: { delegatorId: null, page: 1, pageSize: 50, q: "", selected: {} },
    change: { delegatorId: null, page: 1, pageSize: 50, q: "", selected: {} },
  };

  function setStatus(text, kind) {
    api.setStatus(document.getElementById("access-workspace-status"), text, kind);
  }

  function escapeCell(value) {
    if (value === null || value === undefined) return "—";
    return shell.escapeHtml(String(value));
  }

  function renderSimpleTable(columns, rows) {
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

  function formatMsk(iso) {
    return dt ? dt.formatMskDisplay(iso) : iso || "—";
  }

  function parseMskWindow(startsLocal, endsLocal) {
    if (!dt) {
      return { error: "Модуль даты недоступен." };
    }
    var startsAt = dt.parseMskLocalInput(startsLocal);
    var endsAt = dt.parseMskLocalInput(endsLocal);
    if (!startsAt || !endsAt) {
      return { error: "Укажите корректные дату и время (Москва, МСК)." };
    }
    if (new Date(endsAt).getTime() <= new Date(startsAt).getTime()) {
      return { error: "Окончание должно быть позже начала." };
    }
    return { startsAt: startsAt, endsAt: endsAt };
  }

  function showRoleSections(role) {
    document.querySelectorAll("[data-role-section]").forEach(function (section) {
      var roles = section.getAttribute("data-role-section").split(",");
      section.classList.toggle("clients-hidden", roles.indexOf(role) < 0);
    });
  }

  function canApprove(role) {
    return role === "rop" || role === "director";
  }

  function canProposeChange(role) {
    return role === "manager" || role === "coordinator" || role === "rop";
  }

  function statusLabel(row) {
    return row.effective_label || row.status || "—";
  }

  function loadDelegatorClients(pickerKey, containerId) {
    var state = pickers[pickerKey];
    var container = document.getElementById(containerId);
    if (!container || !state.delegatorId) {
      if (container) container.innerHTML = '<p class="clients-subtitle">Выберите передающего.</p>';
      return Promise.resolve();
    }

    var url =
      "/api/access/delegators/" +
      encodeURIComponent(state.delegatorId) +
      "/clients?page=" +
      state.page +
      "&pageSize=" +
      state.pageSize +
      (state.q ? "&q=" + encodeURIComponent(state.q) : "");

    return api.apiRequest(url).then(function (result) {
      if (result.response.status !== 200) {
        throw new Error(api.extractErrorMessage(result.data, "Не удалось загрузить клиентов."));
      }
      renderClientPicker(container, pickerKey, result.data);
    });
  }

  function renderClientPicker(container, pickerKey, data) {
    var state = pickers[pickerKey];
    container.innerHTML = "";

    var toolbar = document.createElement("div");
    toolbar.className = "clients-filters";

    var searchInput = document.createElement("input");
    searchInput.className = "field__input";
    searchInput.type = "search";
    searchInput.placeholder = "Поиск клиента";
    searchInput.value = state.q;
    searchInput.addEventListener("change", function () {
      state.q = searchInput.value.trim();
      state.page = 1;
      loadDelegatorClients(pickerKey, container.id);
    });

    var searchBtn = document.createElement("button");
    searchBtn.type = "button";
    searchBtn.className = "workspace-button workspace-button--secondary";
    searchBtn.textContent = "Найти";
    searchBtn.addEventListener("click", function () {
      state.q = searchInput.value.trim();
      state.page = 1;
      loadDelegatorClients(pickerKey, container.id);
    });

    toolbar.appendChild(searchInput);
    toolbar.appendChild(searchBtn);
    container.appendChild(toolbar);

    var selectedCount = document.createElement("p");
    selectedCount.className = "clients-subtitle";
    selectedCount.textContent =
      "Выбрано клиентов: " + Object.keys(state.selected).length + " (сохраняется между страницами)";
    container.appendChild(selectedCount);

    var table = document.createElement("table");
    table.className = "clients-table";
    var thead = document.createElement("thead");
    thead.innerHTML = "<tr><th></th><th>Клиент</th><th>GUID</th></tr>";
    table.appendChild(thead);
    var tbody = document.createElement("tbody");

    (data.items || []).forEach(function (item) {
      var tr = document.createElement("tr");
      var tdCheck = document.createElement("td");
      var checkbox = document.createElement("input");
      checkbox.type = "checkbox";
      checkbox.checked = Boolean(state.selected[item.guid]);
      checkbox.addEventListener("change", function () {
        if (checkbox.checked) {
          state.selected[item.guid] = item.name;
        } else {
          delete state.selected[item.guid];
        }
        selectedCount.textContent =
          "Выбрано клиентов: " + Object.keys(state.selected).length + " (сохраняется между страницами)";
      });
      tdCheck.appendChild(checkbox);
      tr.appendChild(tdCheck);

      var tdName = document.createElement("td");
      tdName.textContent = item.name;
      tr.appendChild(tdName);

      var tdGuid = document.createElement("td");
      tdGuid.textContent = item.guid.slice(0, 8) + "…";
      tr.appendChild(tdGuid);

      tbody.appendChild(tr);
    });
    table.appendChild(tbody);
    container.appendChild(table);

    var pager = document.createElement("div");
    pager.className = "clients-filters";
    var prev = document.createElement("button");
    prev.type = "button";
    prev.className = "workspace-button workspace-button--secondary";
    prev.textContent = "← Назад";
    prev.disabled = state.page <= 1;
    prev.addEventListener("click", function () {
      if (state.page > 1) {
        state.page -= 1;
        loadDelegatorClients(pickerKey, container.id);
      }
    });
    var pageInfo = document.createElement("span");
    pageInfo.className = "clients-subtitle";
    pageInfo.textContent = "Стр. " + data.page + " из " + Math.max(data.totalPages || 1, 1);
    var next = document.createElement("button");
    next.type = "button";
    next.className = "workspace-button workspace-button--secondary";
    next.textContent = "Вперёд →";
    next.disabled = data.page >= (data.totalPages || 1);
    next.addEventListener("click", function () {
      if (data.page < (data.totalPages || 1)) {
        state.page += 1;
        loadDelegatorClients(pickerKey, container.id);
      }
    });
    pager.appendChild(prev);
    pager.appendChild(pageInfo);
    pager.appendChild(next);
    container.appendChild(pager);
  }

  function selectedGuids(pickerKey) {
    return Object.keys(pickers[pickerKey].selected);
  }

  function createActionButton(label, className, onClick) {
    var btn = document.createElement("button");
    btn.type = "button";
    btn.className = "workspace-button " + className;
    btn.textContent = label;
    btn.addEventListener("click", onClick);
    return btn;
  }

  function renderDelegationsTable() {
    var rows = (overviewData && overviewData.delegations) || [];
    var tableEl = document.getElementById("delegations-table");
    if (!tableEl) return;

    tableEl.innerHTML = "";
    if (rows.length === 0) {
      tableEl.innerHTML = '<p class="clients-subtitle">Нет замещений в вашей области.</p>';
      return;
    }

    var table = document.createElement("table");
    table.className = "clients-table";
    var thead = document.createElement("thead");
    thead.innerHTML =
      "<tr><th>Передающий</th><th>Ассистент</th><th>Статус</th><th>Начало</th><th>Окончание</th><th>Клиентов</th><th>Действия</th></tr>";
    table.appendChild(thead);
    var tbody = document.createElement("tbody");

    rows.forEach(function (row) {
      var tr = document.createElement("tr");

      function addTextCell(text) {
        var td = document.createElement("td");
        td.textContent = text == null || text === "" ? "—" : String(text);
        tr.appendChild(td);
      }

      addTextCell(row.delegator_name || row.delegator_email || (currentUser.role === "manager" ? "Вы" : "—"));
      addTextCell(row.assistant_name || row.assistant_email || "—");
      addTextCell(statusLabel(row));
      addTextCell(formatMsk(row.starts_at));
      addTextCell(formatMsk(row.ends_at));
      addTextCell(
        row.clients_access === "restricted"
          ? "—"
          : row.client_count != null
            ? String(row.client_count)
            : "—",
      );

      var actionsTd = document.createElement("td");
      actionsTd.className = "delegation-actions";

      actionsTd.appendChild(
        createActionButton("Состав", "workspace-button--secondary", function () {
          openDelegationDetail(row.id);
        }),
      );

      var effective = row.effective_status || row.status;
      var clientsVisible = row.clients_access !== "restricted";
      if (canApprove(currentUser.role) && clientsVisible) {
        if (effective === "pending_approval") {
          actionsTd.appendChild(
            createActionButton("Согласовать", "workspace-button--primary", function () {
              openDelegationDetail(row.id, "approve");
            }),
          );
        }
        if (row.pending_change && row.effective_status === "access_suspended") {
          actionsTd.appendChild(
            createActionButton("Согласовать изменение", "workspace-button--primary", function () {
              openDelegationDetail(row.id, "approve-change");
            }),
          );
        }
      }
      if (row.clients_access === "restricted") {
        var restrictedNote = document.createElement("span");
        restrictedNote.className = "clients-subtitle";
        restrictedNote.textContent = " Состав клиентов недоступен";
        actionsTd.appendChild(restrictedNote);
      }

      if (effective !== "revoked") {
        actionsTd.appendChild(
          createActionButton("Отозвать", "workspace-button--secondary", function () {
            revokeDelegation(row.id);
          }),
        );
      }

      if (row.access_suspended || row.effective_status === "access_suspended") {
        var note = document.createElement("span");
        note.className = "clients-subtitle";
        note.textContent = " Доступ приостановлен до согласования изменений";
        actionsTd.appendChild(note);
      }

      tr.appendChild(actionsTd);
      tbody.appendChild(tr);
    });

    table.appendChild(tbody);
    tableEl.appendChild(table);
  }

  function renderDetailBody(detail) {
    var body = document.getElementById("delegation-detail-body");
    if (!body) return;

    var lines = [];
    lines.push("<p><strong>Передающий:</strong> " + escapeCell(detail.delegator_name || detail.delegator_email) + "</p>");
    lines.push("<p><strong>Ассистент:</strong> " + escapeCell(detail.assistant_name || detail.assistant_email) + "</p>");
    lines.push("<p><strong>Статус:</strong> " + escapeCell(statusLabel(detail)) + "</p>");
    lines.push("<p><strong>Начало (МСК):</strong> " + escapeCell(formatMsk(detail.starts_at)) + "</p>");
    lines.push("<p><strong>Окончание (МСК):</strong> " + escapeCell(formatMsk(detail.ends_at)) + "</p>");

    if (detail.clients_access === "restricted") {
      lines.push(
        "<p class=\"clients-subtitle\">" +
          escapeCell(detail.clients_access_message || "Состав клиентов недоступен в пределах ваших полномочий.") +
          "</p>",
      );
    } else if (detail.clients && detail.clients.length) {
      lines.push("<p><strong>Клиенты:</strong></p><ul>");
      detail.clients.forEach(function (c) {
        lines.push("<li>" + escapeCell(c.name) + " (" + escapeCell(c.guid.slice(0, 8)) + "…)</li>");
      });
      lines.push("</ul>");
    }

    if (detail.pending_change_request) {
      var pcr = detail.pending_change_request;
      lines.push("<p><strong>Ожидает согласования изменение:</strong></p>");
      lines.push("<p>Начало: " + escapeCell(formatMsk(pcr.proposed_starts_at)) + "</p>");
      lines.push("<p>Окончание: " + escapeCell(formatMsk(pcr.proposed_ends_at)) + "</p>");
      if (pcr.clients_access === "restricted") {
        lines.push(
          "<p class=\"clients-subtitle\">" +
            escapeCell(pcr.clients_access_message || "Предлагаемый состав недоступен для просмотра.") +
            "</p>",
        );
      } else if (pcr.proposed_clients && pcr.proposed_clients.length) {
        lines.push("<p>Клиенты после изменения:</p><ul>");
        pcr.proposed_clients.forEach(function (c) {
          lines.push("<li>" + escapeCell(c.name) + "</li>");
        });
        lines.push("</ul>");
      }
      if (detail.clients_access !== "restricted" && detail.clients && detail.clients.length) {
        lines.push("<p><em>Отличия от текущего состава — см. списки выше.</em></p>");
      }
    }

    body.innerHTML = lines.join("");
  }

  function openDelegationDetail(delegationId, intent) {
    return api
      .apiRequest("/api/access/delegations/" + encodeURIComponent(delegationId))
      .then(function (result) {
        if (result.response.status !== 200) {
          throw new Error(api.extractErrorMessage(result.data, "Не удалось загрузить состав."));
        }
        activeDetail = result.data.delegation;
        document.getElementById("section-delegation-detail").classList.remove("clients-hidden");
        renderDetailBody(activeDetail);

        var actionsEl = document.getElementById("delegation-detail-actions");
        actionsEl.innerHTML = "";

        var changeForm = document.getElementById("delegation-change-form");
        var canChange =
          canProposeChange(currentUser.role) &&
          activeDetail.effective_status === "active" &&
          !activeDetail.pending_change;
        changeForm.classList.toggle(
          "clients-hidden",
          !canChange || activeDetail.clients_access === "restricted",
        );

        if (canChange && activeDetail.clients_access !== "restricted") {
          pickers.change.delegatorId = activeDetail.delegator_user_id;
          pickers.change.selected = {};
          (activeDetail.clients || []).forEach(function (c) {
            pickers.change.selected[c.guid] = c.name;
          });
          if (dt) {
            document.getElementById("change-starts").value = dt.isoToMskLocalInput(activeDetail.starts_at);
            document.getElementById("change-ends").value = dt.isoToMskLocalInput(activeDetail.ends_at);
          }
          loadDelegatorClients("change", "change-client-picker");
        }

        if (
          intent === "approve" &&
          canApprove(currentUser.role) &&
          activeDetail.clients_access !== "restricted"
        ) {
          actionsEl.appendChild(
            createActionButton("Подтвердить согласование", "workspace-button--primary", function () {
              approveDelegation(activeDetail.id);
            }),
          );
        }
        if (
          intent === "approve-change" &&
          canApprove(currentUser.role) &&
          activeDetail.pending_change_request &&
          activeDetail.pending_change_request.clients_access !== "restricted"
        ) {
          actionsEl.appendChild(
            createActionButton("Подтвердить изменение", "workspace-button--primary", function () {
              approveDelegationChange(activeDetail.pending_change_request.id);
            }),
          );
        }

        document.getElementById("section-delegation-detail").scrollIntoView({ behavior: "smooth" });
      })
      .catch(function (err) {
        setStatus(err.message, "error");
      });
  }

  function withActionGuard(fn) {
    if (actionBusy) {
      setStatus("Подождите, выполняется предыдущая операция.", "error");
      return Promise.resolve();
    }
    actionBusy = true;
    return fn().finally(function () {
      actionBusy = false;
    });
  }

  function approveDelegation(id) {
    return withActionGuard(function () {
      return api
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
    });
  }

  function approveDelegationChange(changeRequestId) {
    return withActionGuard(function () {
      return api
        .apiRequest(
          "/api/access/delegations/change-requests/" + encodeURIComponent(changeRequestId) + "/approve",
          { method: "POST", body: { basis: "Изменение согласовано через интерфейс" } },
        )
        .then(function (result) {
          if (result.response.status !== 200) {
            throw new Error(api.extractErrorMessage(result.data, "Не удалось согласовать изменение."));
          }
          setStatus("Изменение согласовано.", "success");
          return refreshOverview();
        })
        .catch(function (err) {
          setStatus(err.message, "error");
        });
    });
  }

  function revokeDelegation(id) {
    return withActionGuard(function () {
      return api
        .apiRequest("/api/access/delegations/" + encodeURIComponent(id) + "/revoke", {
          method: "POST",
          body: { basis: "Отозвано через интерфейс", reason: "Досрочный отзыв" },
        })
        .then(function (result) {
          if (result.response.status !== 200) {
            throw new Error(api.extractErrorMessage(result.data, "Не удалось отозвать."));
          }
          setStatus("Замещение отозвано.", "success");
          document.getElementById("section-delegation-detail").classList.add("clients-hidden");
          activeDetail = null;
          return refreshOverview();
        })
        .catch(function (err) {
          setStatus(err.message, "error");
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
            document.getElementById("rop-team-table").innerHTML = renderSimpleTable(
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
        document.getElementById("coordinator-teams-table").innerHTML = renderSimpleTable(
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

  function bindAssistantSearch(inputId, btnId, resultsId, hiddenId) {
    document.getElementById(btnId)?.addEventListener("click", function () {
      var q = document.getElementById(inputId).value.trim();
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
          var container = document.getElementById(resultsId);
          container.innerHTML = "";
          var assistants = result.data.assistants || [];
          if (assistants.length === 0) {
            container.innerHTML = '<p class="clients-subtitle">Ассистенты не найдены.</p>';
            return;
          }
          assistants.forEach(function (a) {
            container.appendChild(
              createActionButton(a.full_name + " · " + a.email, "workspace-button--secondary", function () {
                document.getElementById(hiddenId).value = a.id;
                setStatus("Ассистент выбран.", "success");
              }),
            );
            container.appendChild(document.createTextNode(" "));
          });
        })
        .catch(function (err) {
          setStatus(err.message, "error");
        });
    });
  }

  function loadCoordinatorManagers() {
    return api.apiRequest("/api/access/coordinator-managers").then(function (result) {
      if (result.response.status !== 200) {
        throw new Error(api.extractErrorMessage(result.data, "Не удалось загрузить менеджеров."));
      }
      var select = document.getElementById("coordinator-delegator");
      if (!select) return;
      select.innerHTML = (result.data.managers || [])
        .map(function (m) {
          return (
            '<option value="' +
            shell.escapeHtml(m.id) +
            '">' +
            shell.escapeHtml(m.full_name) +
            " · " +
            shell.escapeHtml(m.email) +
            "</option>"
          );
        })
        .join("");
      if (result.data.managers && result.data.managers[0]) {
        pickers.coordinator.delegatorId = result.data.managers[0].id;
        pickers.coordinator.page = 1;
        pickers.coordinator.selected = {};
        return loadDelegatorClients("coordinator", "coordinator-client-picker");
      }
    });
  }

  function loadExplainClients() {
    if (!currentUser) return Promise.resolve();
    pickers.manager.delegatorId = currentUser.id;
    return api
      .apiRequest(
        "/api/access/delegators/" +
          encodeURIComponent(currentUser.id) +
          "/clients?page=1&pageSize=100",
      )
      .then(function (result) {
        if (result.response.status !== 200) return;
        var select = document.getElementById("explain-client-select");
        if (!select) return;
        select.innerHTML = (result.data.items || [])
          .map(function (item) {
            return (
              '<option value="' +
              shell.escapeHtml(item.guid) +
              '">' +
              shell.escapeHtml(item.name) +
              "</option>"
            );
          })
          .join("");
      });
  }

  document.getElementById("coordinator-delegator")?.addEventListener("change", function (event) {
    pickers.coordinator.delegatorId = event.target.value;
    pickers.coordinator.page = 1;
    pickers.coordinator.selected = {};
    loadDelegatorClients("coordinator", "coordinator-client-picker");
  });

  document.getElementById("manager-delegation-form")?.addEventListener("submit", function (event) {
    event.preventDefault();
    var assistantId = document.getElementById("manager-assistant-id").value.trim();
    var clientGuids = selectedGuids("manager");
    var windowParsed = parseMskWindow(
      document.getElementById("manager-starts").value,
      document.getElementById("manager-ends").value,
    );
    if (!assistantId) {
      setStatus("Выберите ассистента из результатов поиска.", "error");
      return;
    }
    if (clientGuids.length === 0) {
      setStatus("Выберите хотя бы одного клиента.", "error");
      return;
    }
    if (windowParsed.error) {
      setStatus(windowParsed.error, "error");
      return;
    }
    withActionGuard(function () {
      return api
        .apiRequest("/api/access/delegations", {
          method: "POST",
          body: {
            assistantUserId: assistantId,
            clientGuids: clientGuids,
            startsAt: windowParsed.startsAt,
            endsAt: windowParsed.endsAt,
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
  });

  document.getElementById("coordinator-delegation-form")?.addEventListener("submit", function (event) {
    event.preventDefault();
    var delegatorUserId = document.getElementById("coordinator-delegator").value;
    var assistantId = document.getElementById("coordinator-assistant-id").value.trim();
    var clientGuids = selectedGuids("coordinator");
    var windowParsed = parseMskWindow(
      document.getElementById("coordinator-starts").value,
      document.getElementById("coordinator-ends").value,
    );
    if (!delegatorUserId || !assistantId) {
      setStatus("Выберите менеджера и ассистента.", "error");
      return;
    }
    if (clientGuids.length === 0) {
      setStatus("Выберите хотя бы одного клиента.", "error");
      return;
    }
    if (windowParsed.error) {
      setStatus(windowParsed.error, "error");
      return;
    }
    withActionGuard(function () {
      return api
        .apiRequest("/api/access/delegations", {
          method: "POST",
          body: {
            delegatorUserId: delegatorUserId,
            assistantUserId: assistantId,
            clientGuids: clientGuids,
            startsAt: windowParsed.startsAt,
            endsAt: windowParsed.endsAt,
            basis: document.getElementById("coordinator-basis").value.trim(),
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
  });

  document.getElementById("delegation-change-form")?.addEventListener("submit", function (event) {
    event.preventDefault();
    if (!activeDetail) return;
    var clientGuids = selectedGuids("change");
    var windowParsed = parseMskWindow(
      document.getElementById("change-starts").value,
      document.getElementById("change-ends").value,
    );
    if (clientGuids.length === 0) {
      setStatus("Выберите хотя бы одного клиента.", "error");
      return;
    }
    if (windowParsed.error) {
      setStatus(windowParsed.error, "error");
      return;
    }
    withActionGuard(function () {
      return api
        .apiRequest(
          "/api/access/delegations/" + encodeURIComponent(activeDetail.id) + "/change-requests",
          {
            method: "POST",
            body: {
              clientGuids: clientGuids,
              startsAt: windowParsed.startsAt,
              endsAt: windowParsed.endsAt,
              basis: document.getElementById("change-basis").value.trim(),
            },
          },
        )
        .then(function (result) {
          if (result.response.status !== 201) {
            throw new Error(api.extractErrorMessage(result.data, "Не удалось отправить изменение."));
          }
          setStatus("Изменение отправлено на согласование. Доступ приостановлен до согласования.", "success");
          return refreshOverview().then(function () {
            return openDelegationDetail(activeDetail.id);
          });
        })
        .catch(function (err) {
          setStatus(err.message, "error");
        });
    });
  });

  document.getElementById("explain-self-form")?.addEventListener("submit", function (event) {
    event.preventDefault();
    if (!currentUser) return;
    var clientGuid = document.getElementById("explain-client-select").value;
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
        document.getElementById("explain-self-result").innerHTML = renderSimpleTable(
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

  bindAssistantSearch(
    "manager-assistant-search",
    "manager-assistant-search-btn",
    "manager-assistant-results",
    "manager-assistant-id",
  );
  bindAssistantSearch(
    "coordinator-assistant-search",
    "coordinator-assistant-search-btn",
    "coordinator-assistant-results",
    "coordinator-assistant-id",
  );

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
      document.querySelectorAll("[data-msk-label]").forEach(function (el) {
        if (dt && dt.MSK_LABEL) el.textContent = dt.MSK_LABEL;
      });

      var subtitles = {
        manager: "Создание и отзыв замещений по своим клиентам.",
        rop: "Согласование и отзыв замещений команды.",
        coordinator: "Планирование замещений назначенных команд.",
        director: "Обзор, согласование и отзыв замещений.",
      };
      document.getElementById("access-workspace-subtitle").textContent =
        subtitles[currentUser.role] || "";

      var tasks = [refreshOverview()];
      if (currentUser.role === "manager") {
        pickers.manager.delegatorId = currentUser.id;
        pickers.manager.selected = {};
        tasks.push(loadDelegatorClients("manager", "manager-client-picker"));
        tasks.push(loadExplainClients());
      }
      if (currentUser.role === "coordinator") {
        tasks.push(loadCoordinatorManagers());
      }
      if (currentUser.role === "rop" || currentUser.role === "director") {
        tasks.push(loadExplainClients());
      }
      return Promise.all(tasks);
    })
    .catch(function (err) {
      setStatus(err.message || "Ошибка загрузки.", "error");
    });
})();
