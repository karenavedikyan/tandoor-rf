(function (root) {
  "use strict";

  var KIND_LABELS = {
    manager: "продажи",
    regional: "региональный",
    hardware: "фурнитура",
  };

  var KIND_FILTER_OPTIONS = [
    { value: "", label: "Все типы" },
    { value: "manager", label: "Продажи" },
    { value: "regional", label: "Региональный" },
    { value: "hardware", label: "Фурнитура" },
  ];

  function normalizeText(value) {
    return String(value || "")
      .trim()
      .toLowerCase();
  }

  function mergeResponsiblesByEmployee(items) {
    var map = Object.create(null);
    (items || []).forEach(function (item) {
      var key = item.employeeGuid;
      if (!map[key]) {
        map[key] = {
          employeeGuid: item.employeeGuid,
          name: item.name,
          shortId: item.shortId,
          hasLinkedAccount: item.hasLinkedAccount,
          rosterInOpt: item.rosterInOpt,
          assignments: [],
        };
      }
      map[key].assignments.push({
        kind: item.kind,
        clientCount: item.clientCount,
        outletCount: item.outletCount,
      });
    });
    return Object.keys(map).map(function (key) {
      return map[key];
    });
  }

  function employeeMatchesQuery(employee, query) {
    if (!query) {
      return true;
    }
    var haystack = normalizeText(employee.name + " " + (employee.shortId || ""));
    return haystack.indexOf(query) !== -1;
  }

  function ropMatchesQuery(summary, query) {
    if (!query) {
      return true;
    }
    var haystack = normalizeText(summary.name + " " + (summary.shortId || ""));
    return haystack.indexOf(query) !== -1;
  }

  function filterAssignments(assignments, kindFilter) {
    if (!kindFilter) {
      return assignments;
    }
    return assignments.filter(function (assignment) {
      return assignment.kind === kindFilter;
    });
  }

  function isRopNameMatch(summary, teamUi) {
    return Boolean(teamUi.query) && ropMatchesQuery(summary, teamUi.query);
  }

  function visibleEmployees(items, summary, teamUi) {
    var employees = mergeResponsiblesByEmployee(items || []);
    var ropNameMatch = isRopNameMatch(summary, teamUi);
    return employees.filter(function (employee) {
      var assignments = filterAssignments(employee.assignments, teamUi.kind);
      if (assignments.length === 0) {
        return false;
      }
      if (!teamUi.query || ropNameMatch) {
        return true;
      }
      return employeeMatchesQuery(employee, teamUi.query);
    });
  }

  function shouldShowRopWithItems(summary, teamUi, items) {
    if (!teamUi.query && !teamUi.kind) {
      return true;
    }
    return visibleEmployees(items, summary, teamUi).length > 0;
  }

  function createCompactTeams(deps) {
    var cache = Object.create(null);

    function cacheEntry(ropGuid) {
      if (!cache[ropGuid]) {
        cache[ropGuid] = { status: "idle", items: [], error: null, inflight: null };
      }
      return cache[ropGuid];
    }

    function resetCache() {
      cache = Object.create(null);
    }

    function readTeamUi(state) {
      return {
        expanded: state.teamExpand || [],
        query: normalizeText(state.teamQ),
        kind: deps.logic.normalizeTeamKind(state.teamKind || ""),
      };
    }

    function isExpanded(teamUi, ropGuid) {
      return teamUi.expanded.indexOf(ropGuid) !== -1;
    }

    function ensureResponsibles(ropGuid) {
      var entry = cacheEntry(ropGuid);
      if (entry.status === "loaded") {
        return Promise.resolve(entry);
      }
      if (entry.inflight) {
        return entry.inflight;
      }
      entry.status = "loading";
      entry.inflight = deps.api
        .apiRequest("/api/clients/org-structure/" + encodeURIComponent(ropGuid) + "/responsibles")
        .then(function (result) {
          if (result.response.status === 200 && result.data) {
            entry.status = "loaded";
            entry.items = result.data.items || [];
            entry.error = null;
          } else {
            entry.status = "error";
            entry.items = [];
            entry.error =
              deps.api.extractErrorMessage(result.data, "Не удалось загрузить состав команды.") ||
              "Не удалось загрузить состав команды.";
          }
          return entry;
        })
        .catch(function () {
          entry.status = "error";
          entry.items = [];
          entry.error = "Не удалось загрузить состав команды.";
          return entry;
        })
        .finally(function () {
          entry.inflight = null;
        });
      return entry.inflight;
    }

    function ensureResponsiblesForSearch(rops, teamUi) {
      if (!teamUi.query && !teamUi.kind) {
        return Promise.resolve();
      }
      return Promise.all(
        rops.map(function (rop) {
          return ensureResponsibles(rop.employeeGuid);
        }),
      ).then(function () {
        return undefined;
      });
    }

    function ropHasEmployeeNameMatch(ropGuid, teamUi) {
      if (!teamUi.query) {
        return false;
      }
      var entry = cacheEntry(ropGuid);
      if (entry.status !== "loaded") {
        return false;
      }
      return mergeResponsiblesByEmployee(entry.items).some(function (employee) {
        return employeeMatchesQuery(employee, teamUi.query);
      });
    }

    function shouldShowRop(summary, teamUi) {
      if (!teamUi.query && !teamUi.kind) {
        return true;
      }
      var entry = cacheEntry(summary.employeeGuid);
      if (entry.status === "loading" || entry.status === "idle") {
        return true;
      }
      if (entry.status === "error") {
        return false;
      }
      return shouldShowRopWithItems(summary, teamUi, entry.items);
    }

    function summarizeSearchLoad(rops, teamUi) {
      if (!teamUi.query && !teamUi.kind) {
        return null;
      }
      var summary = { total: rops.length, loaded: 0, errors: 0, pending: 0 };
      rops.forEach(function (rop) {
        var entry = cacheEntry(rop.employeeGuid);
        if (entry.status === "loaded") {
          summary.loaded += 1;
        } else if (entry.status === "error") {
          summary.errors += 1;
        } else {
          summary.pending += 1;
        }
      });
      return summary;
    }

    function renderSearchLoadBanner(loadSummary) {
      if (!loadSummary || loadSummary.errors === 0) {
        return "";
      }
      if (loadSummary.loaded === 0) {
        return (
          '<div class="clients-compact-team__search-error" role="alert">' +
          '<p class="clients-compact-team__error">Не удалось загрузить состав команд для поиска. Повторите попытку.</p>' +
          '<button type="button" class="workspace-button workspace-button--ghost clients-compact-team__retry-search">Повторить</button></div>'
        );
      }
      return (
        '<p class="clients-compact-team__search-warning" role="status">Поиск выполнен не по всем доступным командам: ' +
        deps.shell.escapeHtml(String(loadSummary.errors)) +
        " из " +
        deps.shell.escapeHtml(String(loadSummary.total)) +
        ' недоступны. <button type="button" class="workspace-button workspace-button--ghost clients-compact-team__retry-search">Повторить загрузку</button></p>'
      );
    }

    function renderAssignmentLinks(ropGuid, employee, state, assignments) {
      return assignments
        .map(function (assignment) {
          var kindLabel = KIND_LABELS[assignment.kind] || assignment.kind;
          var clientBtn =
            assignment.clientCount > 0
              ? '<button type="button" class="clients-compact-team__count" data-responsible-entity="clients" data-responsible-kind="' +
                deps.shell.escapeHtml(assignment.kind) +
                '" data-manager="' +
                deps.shell.escapeHtml(employee.employeeGuid) +
                '" data-rop-employee="' +
                deps.shell.escapeHtml(ropGuid) +
                '">' +
                deps.shell.escapeHtml(String(assignment.clientCount) + " клиентов") +
                " · " +
                deps.shell.escapeHtml(kindLabel) +
                "</button>"
              : '<span class="clients-compact-team__count clients-compact-team__count--empty">0 клиентов · ' +
                deps.shell.escapeHtml(kindLabel) +
                "</span>";
          var outletBtn =
            assignment.outletCount > 0
              ? '<button type="button" class="clients-compact-team__count" data-responsible-entity="outlets" data-responsible-kind="' +
                deps.shell.escapeHtml(assignment.kind) +
                '" data-manager="' +
                deps.shell.escapeHtml(employee.employeeGuid) +
                '" data-rop-employee="' +
                deps.shell.escapeHtml(ropGuid) +
                '">' +
                deps.shell.escapeHtml(String(assignment.outletCount) + " ТТ") +
                " · " +
                deps.shell.escapeHtml(kindLabel) +
                "</button>"
              : "";
          return clientBtn + outletBtn;
        })
        .join("");
    }

    function renderEmployeeRow(ropGuid, employee, teamUi, summary) {
      var assignments = filterAssignments(employee.assignments, teamUi.kind);
      if (assignments.length === 0) {
        return "";
      }
      if (teamUi.query && !isRopNameMatch(summary, teamUi) && !employeeMatchesQuery(employee, teamUi.query)) {
        return "";
      }
      var kindTags = assignments
        .map(function (assignment) {
          return (
            '<span class="clients-compact-team__kind-tag">' +
            deps.shell.escapeHtml(KIND_LABELS[assignment.kind] || assignment.kind) +
            "</span>"
          );
        })
        .join("");
      var badges =
        (employee.hasLinkedAccount
          ? ""
          : '<span class="clients-compact-team__badge">Нет аккаунта ЛК</span>') +
        (employee.rosterInOpt === false
          ? '<span class="clients-compact-team__badge">Вне справочника ОПТ</span>'
          : "");
      return (
        '<div class="clients-compact-team__member" data-employee-guid="' +
        deps.shell.escapeHtml(employee.employeeGuid) +
        '">' +
        '<div class="clients-compact-team__member-main">' +
        '<span class="clients-compact-team__member-name">' +
        deps.shell.escapeHtml(employee.name || employee.shortId || employee.employeeGuid) +
        "</span>" +
        '<span class="clients-compact-team__member-kinds">' +
        kindTags +
        badges +
        "</span>" +
        "</div>" +
        '<div class="clients-compact-team__member-counts">' +
        renderAssignmentLinks(ropGuid, employee, null, assignments) +
        "</div>" +
        "</div>"
      );
    }

    function renderMembersPanel(ropGuid, teamUi, entry, expanded, summary) {
      if (!expanded) {
        return "";
      }
      if (entry.status === "loading" || entry.status === "idle") {
        return '<div class="clients-compact-team__members clients-compact-team__members--loading">Загрузка состава…</div>';
      }
      if (entry.status === "error") {
        return (
          '<div class="clients-compact-team__members clients-compact-team__members--error">' +
          '<p class="clients-compact-team__error">' +
          deps.shell.escapeHtml(entry.error || "Ошибка загрузки") +
          '</p><button type="button" class="workspace-button workspace-button--ghost clients-compact-team__retry" data-retry-rop="' +
          deps.shell.escapeHtml(ropGuid) +
          '">Повторить</button></div>'
        );
      }
      var visible = visibleEmployees(entry.items, summary, teamUi);
      var rows = visible
        .map(function (employee) {
          return renderEmployeeRow(ropGuid, employee, teamUi, summary);
        })
        .filter(Boolean)
        .join("");
      if (!rows) {
        return '<div class="clients-compact-team__members clients-compact-team__members--empty">Нет сотрудников по текущему фильтру.</div>';
      }
      return '<div class="clients-compact-team__members" tabindex="0">' + rows + "</div>";
    }

    function renderRopRow(summary, teamUi, entry, options) {
      var opts = options || {};
      var expanded = opts.forceExpanded || isExpanded(teamUi, summary.employeeGuid);
      var ropGuid = summary.employeeGuid;
      var toggleLabel = expanded ? "Свернуть команду" : "Развернуть команду";
      var hideHeader = opts.hideHeader === true;
      var metricsHtml = opts.hideMetrics
        ? ""
        : '<div class="clients-compact-team__metrics" aria-label="Итоги ветки">' +
          '<span class="clients-compact-team__metric"><span class="clients-compact-team__metric-value">' +
          deps.shell.escapeHtml(String(summary.teamMemberCount ?? "—")) +
          '</span><span class="clients-compact-team__metric-label">сотрудников</span></span>' +
          '<button type="button" class="clients-compact-team__metric clients-compact-team__metric--link" data-branch-portfolio="clients" data-rop-employee="' +
          deps.shell.escapeHtml(ropGuid) +
          '"><span class="clients-compact-team__metric-value">' +
          deps.shell.escapeHtml(String(summary.uniqueClientCount ?? "—")) +
          '</span><span class="clients-compact-team__metric-label">клиентов</span></button>' +
          '<button type="button" class="clients-compact-team__metric clients-compact-team__metric--link" data-branch-portfolio="outlets" data-rop-employee="' +
          deps.shell.escapeHtml(ropGuid) +
          '"><span class="clients-compact-team__metric-value">' +
          deps.shell.escapeHtml(String(summary.uniqueOutletCount ?? "—")) +
          '</span><span class="clients-compact-team__metric-label">ТТ</span></button>' +
          "</div>";
      var headerHtml = hideHeader
        ? ""
        : '<div class="clients-compact-team__row">' +
          '<button type="button" class="clients-compact-team__toggle" aria-expanded="' +
          (expanded ? "true" : "false") +
          '" aria-label="' +
          deps.shell.escapeHtml(toggleLabel) +
          '" data-toggle-rop="' +
          deps.shell.escapeHtml(ropGuid) +
          '">' +
          '<span class="clients-compact-team__chevron" aria-hidden="true"></span>' +
          "</button>" +
          '<div class="clients-compact-team__identity">' +
          '<button type="button" class="clients-compact-team__name" data-toggle-rop="' +
          deps.shell.escapeHtml(ropGuid) +
          '">' +
          deps.shell.escapeHtml(summary.name || summary.shortId || "РОП") +
          "</button>" +
          (summary.hasLinkedAccount === false
            ? '<span class="clients-compact-team__badge">Нет аккаунта ЛК</span>'
            : "") +
          "</div>" +
          metricsHtml +
          "</div>";
      return (
        '<section class="clients-compact-team' +
        (expanded ? " clients-compact-team--expanded" : "") +
        (opts.singleRop ? " clients-compact-team--single-rop" : "") +
        '" data-rop-employee="' +
        deps.shell.escapeHtml(ropGuid) +
        '">' +
        headerHtml +
        renderMembersPanel(ropGuid, teamUi, entry, expanded || hideHeader, summary) +
        "</section>"
      );
    }

    function renderToolbar(state, teamUi, options) {
      var opts = options || {};
      var showCollapseAll = opts.showCollapseAll !== false;
      var kindOptions = KIND_FILTER_OPTIONS.map(function (option) {
        var selected = option.value === teamUi.kind ? " selected" : "";
        return (
          '<option value="' +
          deps.shell.escapeHtml(option.value) +
          '"' +
          selected +
          ">" +
          deps.shell.escapeHtml(option.label) +
          "</option>"
        );
      }).join("");
      var modeSwitch =
        deps.usesDirectorLayout() && deps.renderTeamSourceSwitch
          ? deps.renderTeamSourceSwitch(state)
          : "";
      return (
        modeSwitch +
        '<div class="clients-compact-team-toolbar">' +
        '<label class="clients-field clients-compact-team-toolbar__search">' +
        '<span class="clients-field__label">Поиск РОПа или сотрудника</span>' +
        '<input type="search" class="clients-field__input" id="clients-team-search-input" value="' +
        deps.shell.escapeHtml(state.teamQ || "") +
        '" autocomplete="off" />' +
        "</label>" +
        '<label class="clients-field clients-compact-team-toolbar__kind">' +
        '<span class="clients-field__label">Тип назначения</span>' +
        '<select class="clients-field__input" id="clients-team-kind-filter">' +
        kindOptions +
        "</select>" +
        "</label>" +
        (showCollapseAll
          ? '<button type="button" class="workspace-button workspace-button--ghost clients-compact-team-toolbar__collapse" id="clients-team-collapse-all">Свернуть всё</button>'
          : "") +
        "</div>"
      );
    }

    function renderUndefinedTeam(undefinedTeam) {
      if (!undefinedTeam || undefinedTeam.length === 0) {
        return "";
      }
      return (
        '<section class="clients-compact-team-undefined">' +
        '<h3 class="clients-compact-team-undefined__title">Команда не определена</h3>' +
        '<div class="clients-compact-team-undefined__list">' +
        undefinedTeam
          .map(function (member) {
            return (
              '<div class="clients-compact-team-undefined__item">' +
              "<strong>" +
              deps.shell.escapeHtml(member.name) +
              "</strong>" +
              deps.renderOrgBadge(member.rosterPost || "") +
              deps.renderOrgBadge(member.hasLinkedAccount ? "" : "Нет аккаунта ЛК") +
              "</div>"
            );
          })
          .join("") +
        "</div></section>"
      );
    }

    function shouldAutoExpandRop(summary, teamUi) {
      if (!teamUi.query && !teamUi.kind) {
        return false;
      }
      var entry = cacheEntry(summary.employeeGuid);
      if (entry.status !== "loaded") {
        return false;
      }
      return shouldShowRopWithItems(summary, teamUi, entry.items);
    }

    function renderOverview(state, context) {
      var teamUi = readTeamUi(state);
      var loadSummary = summarizeSearchLoad(context.rops || [], teamUi);
      var searchBanner = renderSearchLoadBanner(loadSummary);
      var rops = (context.rops || []).filter(function (rop) {
        return shouldShowRop(rop, teamUi);
      });
      var rows = rops
        .map(function (rop) {
          var expandedByState = isExpanded(teamUi, rop.employeeGuid);
          var expandedByFilter = shouldAutoExpandRop(rop, teamUi);
          return renderRopRow(rop, teamUi, cacheEntry(rop.employeeGuid), {
            forceExpanded: expandedByState || expandedByFilter,
          });
        })
        .join("");
      var showEmpty =
        !rows &&
        (!loadSummary || loadSummary.errors === 0 || loadSummary.loaded > 0) &&
        (!loadSummary || loadSummary.pending === 0);
      var emptyHtml = showEmpty
        ? '<p class="clients-compact-team__empty">Нет команд по текущему фильтру.</p>'
        : "";
      var noteHtml =
        context.limitationNote && !teamUi.query && !teamUi.kind
          ? '<p class="clients-compact-team__note">' + deps.shell.escapeHtml(context.limitationNote) + "</p>"
          : "";
      return (
        renderToolbar(state, teamUi, { showCollapseAll: true }) +
        searchBanner +
        noteHtml +
        '<div class="clients-compact-team-list">' +
        rows +
        emptyHtml +
        "</div>" +
        renderUndefinedTeam(context.undefinedTeam)
      );
    }

    function renderRopPanel(state, context) {
      var summary = context.ropSummary;
      if (!summary) {
        return '<p class="clients-compact-team__empty">Команда недоступна.</p>';
      }
      var teamUi = readTeamUi(state);
      var forcedUi = {
        expanded: [summary.employeeGuid],
        query: teamUi.query,
        kind: teamUi.kind,
      };
      var entry = cacheEntry(summary.employeeGuid);
      if (entry.status === "idle" && context.managers && context.managers.length > 0) {
        entry.status = "loaded";
        entry.items = context.managers;
      }
      var noteHtml = context.limitationNote
        ? '<p class="clients-compact-team__note">' + deps.shell.escapeHtml(context.limitationNote) + "</p>"
        : "";
      return (
        renderToolbar(state, forcedUi, { showCollapseAll: false }) +
        noteHtml +
        '<div class="clients-compact-team-list clients-compact-team-list--single">' +
        renderRopRow(summary, forcedUi, entry, {
          forceExpanded: true,
          hideHeader: true,
          hideMetrics: true,
          singleRop: true,
        }) +
        "</div>"
      );
    }

    function readStateFromLocation() {
      if (typeof window === "undefined") {
        return { teamExpand: [], teamQ: "", teamKind: "" };
      }
      return deps.logic.readStateFromSearch(window.location.search);
    }

    function bindEvents(container, state, callbacks) {
      if (deps.usesDirectorLayout() && deps.bindTeamSourceSwitch) {
        deps.bindTeamSourceSwitch(
          container,
          function () {
            return readStateFromLocation();
          },
          callbacks,
        );
      }

      container.querySelectorAll("[data-toggle-rop]").forEach(function (btn) {
        btn.addEventListener("click", function () {
          var ropGuid = btn.getAttribute("data-toggle-rop");
          if (!ropGuid) {
            return;
          }
          var teamUi = readTeamUi(readStateFromLocation());
          var expanded = teamUi.expanded.slice();
          var index = expanded.indexOf(ropGuid);
          if (index === -1) {
            expanded.push(ropGuid);
          } else {
            expanded.splice(index, 1);
          }
          callbacks.navigate({ teamExpand: expanded });
        });
      });
      container.querySelectorAll("[data-branch-portfolio]").forEach(function (btn) {
        btn.addEventListener("click", function () {
          var portfolio = btn.getAttribute("data-branch-portfolio") || "clients";
          var ropGuid = btn.getAttribute("data-rop-employee") || state.ropEmployee;
          if (deps.usesDirectorLayout()) {
            deps.navigateDirectorBranchPortfolio(ropGuid, portfolio);
          } else {
            deps.navigateRopBranchPortfolio(state, portfolio);
          }
        });
      });
      container.querySelectorAll("[data-responsible-entity]").forEach(function (btn) {
        btn.addEventListener("click", function () {
          var ropGuid = btn.getAttribute("data-rop-employee") || state.ropEmployee;
          var managerGuid = btn.getAttribute("data-manager");
          var kind = btn.getAttribute("data-responsible-kind") || "manager";
          var entityMode = btn.getAttribute("data-responsible-entity") || "clients";
          var entry = cacheEntry(ropGuid);
          var match = (entry.items || []).find(function (item) {
            return item.employeeGuid === managerGuid && item.kind === kind;
          });
          if (!match) {
            return;
          }
          if (deps.usesDirectorLayout()) {
            deps.navigateDirectorResponsible(ropGuid, match, kind, entityMode);
          } else {
            deps.navigateResponsible(state, match, kind, entityMode);
          }
        });
      });
      container.querySelectorAll("[data-retry-rop]").forEach(function (btn) {
        btn.addEventListener("click", function () {
          var ropGuid = btn.getAttribute("data-retry-rop");
          if (!ropGuid) {
            return;
          }
          cacheEntry(ropGuid).status = "idle";
          callbacks.refresh();
        });
      });
      container.querySelectorAll(".clients-compact-team__retry-search").forEach(function (btn) {
        btn.addEventListener("click", function () {
          Object.keys(cache).forEach(function (ropGuid) {
            if (cache[ropGuid].status === "error") {
              cache[ropGuid].status = "idle";
            }
          });
          callbacks.refresh();
        });
      });

      var searchInput = container.querySelector("#clients-team-search-input");
      if (searchInput) {
        var searchTimer = null;
        searchInput.addEventListener("input", function () {
          clearTimeout(searchTimer);
          searchTimer = setTimeout(function () {
            callbacks.navigate({ teamQ: searchInput.value.trim() });
          }, 250);
        });
      }
      var kindFilter = container.querySelector("#clients-team-kind-filter");
      if (kindFilter) {
        kindFilter.addEventListener("change", function () {
          callbacks.navigate({ teamKind: kindFilter.value });
        });
      }
      var collapseAll = container.querySelector("#clients-team-collapse-all");
      if (collapseAll) {
        collapseAll.addEventListener("click", function () {
          callbacks.navigate({ teamExpand: [], teamQ: "", teamKind: "" });
        });
      }
    }

    function prepareAndRenderOverview(state, context, container, callbacks) {
      var teamUi = readTeamUi(state);
      var isStale = callbacks.isStale || function () {
        return false;
      };
      return ensureResponsiblesForSearch(context.rops || [], teamUi).then(function () {
        if (isStale()) {
          return;
        }
        var autoExpand = [];
        if (teamUi.query || teamUi.kind) {
          (context.rops || []).forEach(function (rop) {
            if (shouldAutoExpandRop(rop, teamUi) && autoExpand.indexOf(rop.employeeGuid) === -1) {
              autoExpand.push(rop.employeeGuid);
            }
          });
        }
        var mergedExpand = teamUi.expanded.slice();
        autoExpand.forEach(function (guid) {
          if (mergedExpand.indexOf(guid) === -1) {
            mergedExpand.push(guid);
          }
        });
        var renderState = Object.assign({}, state, { teamExpand: mergedExpand });
        renderOverviewIntoContainer(container, renderState, context, callbacks);
        if (mergedExpand.length === 0) {
          if (callbacks.restoreSearchFocus) {
            callbacks.restoreSearchFocus();
          }
          return;
        }
        return Promise.all(
          mergedExpand.map(function (ropGuid) {
            return ensureResponsibles(ropGuid);
          }),
        ).then(function () {
          if (isStale()) {
            return;
          }
          renderOverviewIntoContainer(container, renderState, context, callbacks);
          if (autoExpand.length > 0 && callbacks.syncExpand) {
            callbacks.syncExpand(mergedExpand);
          }
          if (callbacks.restoreSearchFocus) {
            callbacks.restoreSearchFocus();
          }
        });
      });
    }

    function renderOverviewIntoContainer(container, renderState, context, callbacks) {
      container.innerHTML = renderOverview(renderState, context);
      bindEvents(container, renderState, callbacks);
    }

    function prepareAndRenderRopPanel(state, context, container, callbacks) {
      var summary = context.ropSummary;
      var isStale = callbacks.isStale || function () {
        return false;
      };
      if (!summary) {
        if (isStale()) {
          return Promise.resolve();
        }
        container.innerHTML = renderRopPanel(state, context);
        bindEvents(container, state, callbacks);
        return Promise.resolve();
      }
      var teamUi = readTeamUi(state);
      return ensureResponsiblesForSearch([summary], teamUi).then(function () {
        if (isStale()) {
          return;
        }
        return ensureResponsibles(summary.employeeGuid).then(function () {
          if (isStale()) {
            return;
          }
          container.innerHTML = renderRopPanel(state, context);
          bindEvents(container, state, callbacks);
          if (callbacks.restoreSearchFocus) {
            callbacks.restoreSearchFocus();
          }
        });
      });
    }

    return {
      resetCache: resetCache,
      readTeamUi: readTeamUi,
      ensureResponsibles: ensureResponsibles,
      prepareAndRenderOverview: prepareAndRenderOverview,
      prepareAndRenderRopPanel: prepareAndRenderRopPanel,
      mergeResponsiblesByEmployee: mergeResponsiblesByEmployee,
    };
  }

  root.ClientsTeamsCompact = {
    create: createCompactTeams,
    mergeResponsiblesByEmployee: mergeResponsiblesByEmployee,
    normalizeText: normalizeText,
    ropMatchesQuery: ropMatchesQuery,
    employeeMatchesQuery: employeeMatchesQuery,
    filterAssignments: filterAssignments,
    visibleEmployees: visibleEmployees,
    shouldShowRopWithItems: shouldShowRopWithItems,
    isRopNameMatch: isRopNameMatch,
  };
})(typeof window !== "undefined" ? window : globalThis);
