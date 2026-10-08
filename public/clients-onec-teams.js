(function (root) {
  "use strict";

  var UNDEFINED_KEY = "_undefined";

  function normalizeText(value) {
    return String(value || "")
      .trim()
      .toLowerCase();
  }

  function teamExpandKey(group) {
    return group.teamGuid || UNDEFINED_KEY;
  }

  function memberMatchesQuery(member, query) {
    if (!query) {
      return true;
    }
    var haystack = normalizeText(member.name + " " + (member.shortId || ""));
    return haystack.indexOf(query) !== -1;
  }

  function groupNameMatchesQuery(group, query) {
    if (!query) {
      return true;
    }
    return normalizeText(group.displayName).indexOf(query) !== -1;
  }

  function createOnecTeams(deps) {
    function readTeamUi(state) {
      return {
        expanded: state.teamExpand || [],
        query: normalizeText(state.teamQ),
        selectedTeam: (state.onecTeam || "").trim().toLowerCase(),
      };
    }

    function isExpanded(teamUi, group) {
      return teamUi.expanded.indexOf(teamExpandKey(group)) !== -1;
    }

    function renderLeader(group) {
      var leader = group.leader;
      if (!leader) {
        return "";
      }
      var badge =
        leader.status === "unknown_roster"
          ? '<span class="clients-compact-team__badge">Нет в справочнике ОПТ</span>'
          : leader.hasLinkedAccount
            ? ""
            : '<span class="clients-compact-team__badge">Нет аккаунта ЛК</span>';
      return (
        '<div class="clients-onec-team__leader">' +
        '<span class="clients-onec-team__leader-label">Руководитель</span>' +
        '<div class="clients-compact-team__member" data-employee-guid="' +
        deps.shell.escapeHtml(leader.employeeGuid) +
        '">' +
        '<div class="clients-compact-team__member-main">' +
        '<span class="clients-compact-team__member-name">' +
        deps.shell.escapeHtml(leader.name || leader.shortId || leader.employeeGuid) +
        "</span>" +
        '<span class="clients-compact-team__member-kinds">' +
        badge +
        "</span></div></div></div>"
      );
    }

    function renderMemberRow(member) {
      var badges =
        (member.hasLinkedAccount
          ? ""
          : '<span class="clients-compact-team__badge">Нет аккаунта ЛК</span>') +
        (member.rosterPost
          ? '<span class="clients-compact-team__kind-tag">' + deps.shell.escapeHtml(member.rosterPost) + "</span>"
          : "");
      return (
        '<div class="clients-compact-team__member" data-employee-guid="' +
        deps.shell.escapeHtml(member.employeeGuid) +
        '">' +
        '<div class="clients-compact-team__member-main">' +
        '<span class="clients-compact-team__member-name">' +
        deps.shell.escapeHtml(member.name || member.shortId || member.employeeGuid) +
        "</span>" +
        '<span class="clients-compact-team__member-kinds">' +
        badges +
        "</span>" +
        "</div>" +
        '<div class="clients-compact-team__member-counts">' +
        '<button type="button" class="clients-inline-link" data-onec-member-portfolio="clients" data-employee-guid="' +
        deps.shell.escapeHtml(member.employeeGuid) +
        '">' +
        deps.shell.escapeHtml(String(member.clientCount ?? 0)) +
        " клиентов</button>" +
        '<button type="button" class="clients-inline-link" data-onec-member-portfolio="outlets" data-employee-guid="' +
        deps.shell.escapeHtml(member.employeeGuid) +
        '">' +
        deps.shell.escapeHtml(String(member.outletCount ?? 0)) +
        " ТТ</button></div></div>"
      );
    }

    function renderMembersPanel(group, teamUi, expanded) {
      if (!expanded) {
        return "";
      }
      var rows = (group.members || [])
        .map(function (member) {
          if (teamUi.query && !groupNameMatchesQuery(group, teamUi.query) && !memberMatchesQuery(member, teamUi.query)) {
            return "";
          }
          return renderMemberRow(member);
        })
        .filter(Boolean)
        .join("");
      if (!rows) {
        return '<div class="clients-compact-team__members clients-compact-team__members--empty">Нет сотрудников по текущему фильтру.</div>';
      }
      return '<div class="clients-compact-team__members" tabindex="0">' + rows + "</div>";
    }

    function renderGroupRow(group, teamUi) {
      var key = teamExpandKey(group);
      var expanded = isExpanded(teamUi, group);
      var toggleLabel = expanded ? "Свернуть группу" : "Развернуть группу";
      var warning =
        group.nameStatus === "needs_clarification"
          ? '<span class="clients-compact-team__badge">Название требует уточнения в 1С</span>'
          : "";
      return (
        '<section class="clients-compact-team clients-onec-team' +
        (expanded ? " clients-compact-team--expanded" : "") +
        '" data-onec-team="' +
        deps.shell.escapeHtml(key) +
        '">' +
        '<div class="clients-compact-team__row">' +
        '<button type="button" class="clients-compact-team__toggle" aria-expanded="' +
        (expanded ? "true" : "false") +
        '" aria-label="' +
        deps.shell.escapeHtml(toggleLabel) +
        '" data-toggle-onec-team="' +
        deps.shell.escapeHtml(key) +
        '">' +
        '<span class="clients-compact-team__chevron" aria-hidden="true"></span>' +
        "</button>" +
        '<div class="clients-compact-team__identity">' +
        '<button type="button" class="clients-compact-team__name" data-toggle-onec-team="' +
        deps.shell.escapeHtml(key) +
        '">' +
        deps.shell.escapeHtml(group.displayName) +
        "</button>" +
        warning +
        "</div>" +
        '<div class="clients-compact-team__metrics" aria-label="Состав группы">' +
        '<span class="clients-compact-team__metric"><span class="clients-compact-team__metric-value">' +
        deps.shell.escapeHtml(String(group.memberCount ?? group.members.length)) +
        '</span><span class="clients-compact-team__metric-label">сотрудников</span></span>' +
        '<button type="button" class="clients-compact-team__metric clients-compact-team__metric--link" data-onec-group-portfolio="clients" data-onec-team="' +
        deps.shell.escapeHtml(key) +
        '"><span class="clients-compact-team__metric-value">' +
        deps.shell.escapeHtml(String(group.uniqueClientCount ?? 0)) +
        '</span><span class="clients-compact-team__metric-label">клиентов</span></button>' +
        '<button type="button" class="clients-compact-team__metric clients-compact-team__metric--link" data-onec-group-portfolio="outlets" data-onec-team="' +
        deps.shell.escapeHtml(key) +
        '"><span class="clients-compact-team__metric-value">' +
        deps.shell.escapeHtml(String(group.uniqueOutletCount ?? 0)) +
        '</span><span class="clients-compact-team__metric-label">ТТ</span></button>' +
        "</div>" +
        "</div>" +
        renderLeader(group) +
        renderMembersPanel(group, teamUi, expanded) +
        "</section>"
      );
    }

    function renderDirector(director) {
      if (!director) {
        return "";
      }
      return (
        '<div class="clients-team-director clients-onec-team-director">' +
        "<strong>" +
        deps.shell.escapeHtml(director.name) +
        "</strong> · директор" +
        (director.hasLinkedAccount ? "" : '<span class="clients-compact-team__badge">Нет аккаунта ЛК</span>') +
        '<p class="clients-phone-muted">' +
        deps.shell.escapeHtml(director.note || "") +
        "</p></div>"
      );
    }

    function renderModeSwitch(state) {
      var current = state.teamSource === "onec" ? "onec" : "rop";
      return (
        '<div class="clients-team-mode-switch" role="tablist" aria-label="Режим команд">' +
        '<button type="button" class="clients-team-mode-switch__btn' +
        (current === "rop" ? " clients-team-mode-switch__btn--active" : "") +
        '" data-team-source="rop" role="tab" aria-selected="' +
        (current === "rop" ? "true" : "false") +
        '">Команды РОПов</button>' +
        '<button type="button" class="clients-team-mode-switch__btn' +
        (current === "onec" ? " clients-team-mode-switch__btn--active" : "") +
        '" data-team-source="onec" role="tab" aria-selected="' +
        (current === "onec" ? "true" : "false") +
        '">Группы из 1С</button>' +
        "</div>"
      );
    }

    function renderGroupFilter(groups, selectedTeam) {
      var options = ['<option value="">Все группы</option>'];
      groups.forEach(function (group) {
        var key = teamExpandKey(group);
        var selected = selectedTeam === key || (selectedTeam && group.teamGuid === selectedTeam) ? " selected" : "";
        options.push(
          '<option value="' +
            deps.shell.escapeHtml(key) +
            '"' +
            selected +
            ">" +
            deps.shell.escapeHtml(group.displayName) +
            " (" +
            deps.shell.escapeHtml(String(group.memberCount)) +
            ")</option>",
        );
      });
      return (
        '<label class="clients-field clients-compact-team-toolbar__group">' +
        '<span class="clients-field__label">Группа 1С</span>' +
        '<select class="clients-field__input" id="clients-onec-team-filter">' +
        options.join("") +
        "</select></label>"
      );
    }

    function renderToolbar(state, context) {
      var teamUi = readTeamUi(state);
      return (
        renderModeSwitch(state) +
        '<div class="clients-compact-team-toolbar">' +
        '<label class="clients-field clients-compact-team-toolbar__search">' +
        '<span class="clients-field__label">Поиск группы или сотрудника</span>' +
        '<input type="search" class="clients-field__input" id="clients-team-search-input" value="' +
        deps.shell.escapeHtml(state.teamQ || "") +
        '" autocomplete="off" />' +
        "</label>" +
        renderGroupFilter(context.allGroups || context.groups || [], teamUi.selectedTeam) +
        '<button type="button" class="workspace-button workspace-button--ghost clients-compact-team-toolbar__collapse" id="clients-team-collapse-all">Сбросить</button>' +
        "</div>"
      );
    }

    function renderError(message) {
      return (
        '<div class="clients-compact-team__search-error" role="alert">' +
        '<p class="clients-compact-team__error">' +
        deps.shell.escapeHtml(message) +
        '</p><button type="button" class="workspace-button workspace-button--ghost clients-onec-team__retry">Повторить</button></div>'
      );
    }

    function renderOverview(state, context) {
      if (context.loadError) {
        return renderToolbar(state, context) + renderError(context.errorMessage || "Не удалось загрузить группы из 1С.");
      }
      var teamUi = readTeamUi(state);
      var rows = (context.groups || [])
        .map(function (group) {
          return renderGroupRow(group, teamUi);
        })
        .join("");
      var emptyHtml = rows ? "" : '<p class="clients-compact-team__empty">Нет групп по текущему фильтру.</p>';
      return (
        renderToolbar(state, context) +
        renderDirector(context.director) +
        '<div class="clients-compact-team-list clients-onec-team-list">' +
        rows +
        emptyHtml +
        "</div>"
      );
    }

    function bindTeamSourceSwitch(container, readState, callbacks) {
      container.querySelectorAll("[data-team-source]").forEach(function (btn) {
        btn.addEventListener("click", function () {
          var source = btn.getAttribute("data-team-source") || "rop";
          var currentState = readState();
          if (source === (currentState.teamSource === "onec" ? "onec" : "rop")) {
            return;
          }
          callbacks.navigate({
            teamSource: source,
            teamExpand: [],
            onecTeam: "",
            teamQ: "",
            teamKind: "",
            ropEmployee: "",
            portfolio: "",
            manager: "",
            regionalManager: "",
            hardwareManager: "",
            responsibleKind: "",
          });
        });
      });
    }

    function bindEvents(container, state, context, callbacks) {
      bindTeamSourceSwitch(container, function () {
        return deps.logic.readStateFromSearch(window.location.search);
      }, callbacks);

      container.querySelectorAll("[data-toggle-onec-team]").forEach(function (btn) {
        btn.addEventListener("click", function () {
          var teamKey = btn.getAttribute("data-toggle-onec-team");
          if (!teamKey) {
            return;
          }
          var teamUi = readTeamUi(deps.logic.readStateFromSearch(window.location.search));
          var expanded = teamUi.expanded.slice();
          var index = expanded.indexOf(teamKey);
          if (index === -1) {
            expanded.push(teamKey);
          } else {
            expanded.splice(index, 1);
          }
          callbacks.navigate({ teamExpand: expanded });
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

      var groupFilter = container.querySelector("#clients-onec-team-filter");
      if (groupFilter) {
        groupFilter.addEventListener("change", function () {
          var value = groupFilter.value || "";
          callbacks.navigate({ onecTeam: value, teamExpand: value ? [value] : [] });
        });
      }

      var resetBtn = container.querySelector("#clients-team-collapse-all");
      if (resetBtn) {
        resetBtn.addEventListener("click", function () {
          callbacks.navigate({ teamExpand: [], teamQ: "", onecTeam: "" });
        });
      }

      var retryBtn = container.querySelector(".clients-onec-team__retry");
      if (retryBtn) {
        retryBtn.addEventListener("click", function () {
          callbacks.refresh();
        });
      }

      function findGroup(teamKey) {
        var groups = (context && context.groups) || [];
        return groups.find(function (group) {
          return teamExpandKey(group) === teamKey;
        });
      }

      container.querySelectorAll("[data-onec-group-portfolio]").forEach(function (btn) {
        btn.addEventListener("click", function (event) {
          event.stopPropagation();
          var teamKey = btn.getAttribute("data-onec-team") || "";
          var portfolio = btn.getAttribute("data-onec-group-portfolio") || "clients";
          var group = findGroup(teamKey);
          if (!group || !deps.navigateOnecGroupPortfolio) {
            return;
          }
          deps.navigateOnecGroupPortfolio(deps.readAppState(), group, portfolio);
        });
      });

      container.querySelectorAll("[data-onec-member-portfolio]").forEach(function (btn) {
        btn.addEventListener("click", function (event) {
          event.stopPropagation();
          var employeeGuid = btn.getAttribute("data-employee-guid") || "";
          var portfolio = btn.getAttribute("data-onec-member-portfolio") || "clients";
          var section = btn.closest(".clients-onec-team");
          var teamKey = section ? section.getAttribute("data-onec-team") : "";
          var group = findGroup(teamKey || "");
          if (!group || !deps.navigateOnecGroupPortfolio) {
            return;
          }
          var member = (group.members || []).find(function (item) {
            return item.employeeGuid === employeeGuid;
          });
          if (!member) {
            if (group.leader && group.leader.employeeGuid === employeeGuid && deps.navigateOnecTeamMember) {
              deps.navigateOnecTeamMember(deps.readAppState(), group.leader, group);
            }
            return;
          }
          if (portfolio === "clients" && deps.navigateOnecTeamMember) {
            deps.navigateOnecTeamMember(deps.readAppState(), member, group);
            return;
          }
          deps.navigateOnecGroupPortfolio(deps.readAppState(), group, portfolio);
        });
      });

      container.querySelectorAll(".clients-compact-team__member[data-employee-guid]").forEach(function (row) {
        row.addEventListener("click", function (event) {
          if (event.target.closest("[data-onec-member-portfolio]")) {
            return;
          }
          var employeeGuid = row.getAttribute("data-employee-guid") || "";
          var section = row.closest(".clients-onec-team");
          var teamKey = section ? section.getAttribute("data-onec-team") : "";
          var group = findGroup(teamKey || "");
          if (!group || !deps.navigateOnecTeamMember) {
            return;
          }
          var member = (group.members || []).find(function (item) {
            return item.employeeGuid === employeeGuid;
          });
          var target =
            member ||
            (group.leader && group.leader.employeeGuid === employeeGuid ? group.leader : null);
          if (target) {
            deps.navigateOnecTeamMember(deps.readAppState(), target, group);
          }
        });
      });
    }

    function renderIntoContainer(container, state, context, callbacks) {
      if (callbacks.isStale && callbacks.isStale()) {
        return;
      }
      container.innerHTML = renderOverview(state, context);
      bindEvents(container, state, context, callbacks);
    }

    function prepareAndRenderOverview(state, context, container, callbacks) {
      if (callbacks.isStale && callbacks.isStale()) {
        return Promise.resolve();
      }
      renderIntoContainer(container, state, context, callbacks);
      if (callbacks.isStale && callbacks.isStale()) {
        return Promise.resolve();
      }
      if (callbacks.restoreSearchFocus) {
        callbacks.restoreSearchFocus();
      }
      return Promise.resolve();
    }

    return {
      prepareAndRenderOverview: prepareAndRenderOverview,
      readTeamUi: readTeamUi,
      teamExpandKey: teamExpandKey,
      groupNameMatchesQuery: groupNameMatchesQuery,
      memberMatchesQuery: memberMatchesQuery,
      renderModeSwitch: renderModeSwitch,
      bindTeamSourceSwitch: bindTeamSourceSwitch,
    };
  }

  root.ClientsOnecTeams = {
    create: createOnecTeams,
    UNDEFINED_KEY: UNDEFINED_KEY,
    normalizeText: normalizeText,
  };
})(typeof window !== "undefined" ? window : globalThis);
