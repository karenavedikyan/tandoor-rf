(function (root) {
  "use strict";

  function isoToDatetimeLocal(isoString) {
    if (!isoString) {
      return "";
    }
    var date = new Date(isoString);
    if (Number.isNaN(date.getTime())) {
      return "";
    }
    var pad = function (value) {
      return String(value).padStart(2, "0");
    };
    return (
      date.getFullYear() +
      "-" +
      pad(date.getMonth() + 1) +
      "-" +
      pad(date.getDate()) +
      "T" +
      pad(date.getHours()) +
      ":" +
      pad(date.getMinutes())
    );
  }

  function datetimeLocalToIso(value) {
    if (!value) {
      return null;
    }
    var date = new Date(value);
    if (Number.isNaN(date.getTime())) {
      return null;
    }
    return date.toISOString();
  }

  function createReviewPanel(deps) {
    var api = deps.api;
    var shell = deps.shell;
    var logic = deps.logic;
    var guid = deps.guid;
    var container = deps.container;

    var reviewState = null;
    var options = { states: [], decisions: [], commentMaxLength: 2000 };
    var eligibleManagers = [];
    var eligibleReviewers = [];
    var historyItems = [];
    var saveRequestId = 0;

    function escapeHtml(value) {
      return shell.escapeHtml(String(value ?? ""));
    }

    function renderFormMessage(kind, text) {
      var el = container.querySelector("#client-review-message");
      if (!el) return;
      el.className = "client-review-message client-review-message--" + kind;
      el.textContent = text || "";
      el.hidden = !text;
    }

    function managerLabel(id) {
      if (!id) return "";
      var match = eligibleManagers.find(function (item) {
        return item.employeeGuid === id;
      });
      return match ? logic.optionLabel({ id: match.employeeGuid, name: match.name, shortId: match.shortId }) : id;
    }

    function reviewerLabel(userId) {
      if (!userId) return "";
      var match = eligibleReviewers.find(function (item) {
        return item.userId === userId;
      });
      return match ? match.name + " · " + match.shortId : userId;
    }

    function renderHistory() {
      var list = container.querySelector("#client-review-history-list");
      if (!list) return;
      if (!historyItems.length) {
        list.innerHTML = '<p class="clients-phone-muted">История пока пуста.</p>';
        return;
      }
      list.innerHTML = historyItems
        .map(function (entry) {
          return (
            '<details class="client-review-history-item">' +
            "<summary>v" +
            escapeHtml(entry.version) +
            " · " +
            escapeHtml(entry.changeType) +
            " · " +
            escapeHtml(entry.createdAt) +
            "</summary>" +
            "<pre>" +
            escapeHtml(JSON.stringify(entry.after, null, 2)) +
            "</pre>" +
            "</details>"
          );
        })
        .join("");
    }

    function fillReviewerSelect(reviewerSelect) {
      if (!reviewerSelect) return;
      var optionsHtml =
        '<option value="">—</option>' +
        eligibleReviewers
          .map(function (item) {
            return (
              '<option value="' +
              escapeHtml(item.userId) +
              '">' +
              escapeHtml(item.name + " · " + item.shortId) +
              "</option>"
            );
          })
          .join("");

      var assignedId = reviewState ? reviewState.assignedReviewerUserId : null;
      if (
        assignedId &&
        !eligibleReviewers.some(function (item) {
          return item.userId === assignedId;
        })
      ) {
        optionsHtml +=
          '<option value="' +
          escapeHtml(assignedId) +
          '" disabled>Недоступный проверяющий · ' +
          escapeHtml(assignedId.slice(0, 8)) +
          "</option>";
      }

      reviewerSelect.innerHTML = optionsHtml;
    }

    function fillForm() {
      var stateSelect = container.querySelector("#client-review-state");
      var decisionSelect = container.querySelector("#client-review-decision");
      var commentInput = container.querySelector("#client-review-comment");
      var managerHidden = container.querySelector("#client-review-manager");
      var managerInput = container.querySelector("#client-review-manager-input");
      var reviewerSelect = container.querySelector("#client-review-reviewer");
      var dueInput = container.querySelector("#client-review-due");
      var versionEl = container.querySelector("#client-review-version");
      var basisEl = container.querySelector("#client-review-basis");

      if (stateSelect) {
        stateSelect.innerHTML = options.states
          .map(function (item) {
            return (
              '<option value="' +
              escapeHtml(item.id) +
              '">' +
              escapeHtml(item.label) +
              "</option>"
            );
          })
          .join("");
      }
      if (decisionSelect) {
        decisionSelect.innerHTML =
          '<option value="">—</option>' +
          options.decisions
            .map(function (item) {
              return (
                '<option value="' +
                escapeHtml(item.id) +
                '">' +
                escapeHtml(item.label) +
                "</option>"
              );
            })
            .join("");
      }
      fillReviewerSelect(reviewerSelect);

      if (!reviewState) {
        if (stateSelect) stateSelect.value = "unreviewed";
        if (decisionSelect) decisionSelect.value = "";
        if (commentInput) commentInput.value = "";
        if (managerHidden) managerHidden.value = "";
        if (managerInput) managerInput.value = "";
        if (reviewerSelect) reviewerSelect.value = "";
        if (dueInput) dueInput.value = "";
        if (versionEl) versionEl.textContent = "0";
        if (basisEl) basisEl.textContent = deps.currentManagerLabel || "—";
        return;
      }

      if (stateSelect) stateSelect.value = reviewState.reviewState;
      if (decisionSelect) decisionSelect.value = reviewState.reviewDecision || "";
      if (commentInput) commentInput.value = reviewState.comment || "";
      if (managerHidden) managerHidden.value = reviewState.proposedManagerGuid || "";
      if (managerInput) managerInput.value = managerLabel(reviewState.proposedManagerGuid);
      if (reviewerSelect) {
        reviewerSelect.value = reviewState.assignedReviewerUserId || "";
        if (
          reviewState.assignedReviewerUserId &&
          !eligibleReviewers.some(function (item) {
            return item.userId === reviewState.assignedReviewerUserId;
          })
        ) {
          reviewerSelect.value = "";
        }
      }
      if (dueInput) dueInput.value = isoToDatetimeLocal(reviewState.dueAt);
      if (versionEl) versionEl.textContent = String(reviewState.version);
      if (basisEl) {
        basisEl.textContent =
          (deps.currentManagerLabel || "—") +
          (reviewState.isStale ? " · требуется повторная проверка" : "");
      }

      var unavailableReviewerNote = container.querySelector("#client-review-reviewer-unavailable");
      if (unavailableReviewerNote) {
        var reviewerUnavailable =
          reviewState.assignedReviewerUserId &&
          !eligibleReviewers.some(function (item) {
            return item.userId === reviewState.assignedReviewerUserId;
          });
        unavailableReviewerNote.hidden = !reviewerUnavailable;
        unavailableReviewerNote.textContent = reviewerUnavailable
          ? "Ранее назначенный проверяющий (" +
            reviewerLabel(reviewState.assignedReviewerUserId) +
            ") больше недоступен. Выберите действующего администратора."
          : "";
      }

      var recheckBtn = container.querySelector("#client-review-recheck");
      if (recheckBtn) {
        recheckBtn.hidden = !reviewState.isStale;
      }
      var staleNote = container.querySelector("#client-review-stale-note");
      if (staleNote) {
        staleNote.hidden = !reviewState.isStale;
        staleNote.textContent = reviewState.staleReason || "";
      }
    }

    function renderShell() {
      container.innerHTML =
        '<section class="client-review-panel" aria-labelledby="client-review-title">' +
        '<h2 id="client-review-title" class="client-review-panel__title">Ревизия назначения</h2>' +
        '<p class="clients-phone-muted">Текущее назначение из 1С: <span id="client-review-basis">—</span></p>' +
        '<p id="client-review-stale-note" class="client-review-message client-review-message--warn" hidden></p>' +
        '<div id="client-review-message" class="client-review-message" hidden></div>' +
        '<form id="client-review-form" class="client-review-form">' +
        '<label class="clients-field"><span class="clients-field__label">Состояние</span>' +
        '<select id="client-review-state" class="clients-field__select" required></select></label>' +
        '<label class="clients-field"><span class="clients-field__label">Решение</span>' +
        '<select id="client-review-decision" class="clients-field__select"></select></label>' +
        '<label class="clients-field"><span class="clients-field__label">Новый менеджер (для передачи)</span>' +
        '<div class="clients-combobox" id="client-review-manager-combobox">' +
        '<input id="client-review-manager-input" class="clients-field__input clients-combobox__input" type="search" autocomplete="off" placeholder="Выберите менеджера" />' +
        '<input type="hidden" id="client-review-manager" value="" />' +
        '<ul id="client-review-manager-list" class="clients-combobox__list clients-hidden" role="listbox"></ul>' +
        "</div></label>" +
        '<label class="clients-field"><span class="clients-field__label">Комментарий / основание</span>' +
        '<textarea id="client-review-comment" class="clients-field__input client-review-comment" rows="3"></textarea></label>' +
        '<label class="clients-field"><span class="clients-field__label">Проверяющий</span>' +
        '<select id="client-review-reviewer" class="clients-field__select"></select></label>' +
        '<p id="client-review-reviewer-unavailable" class="client-review-message client-review-message--warn" hidden></p>' +
        '<label class="clients-field"><span class="clients-field__label">Срок проверки</span>' +
        '<input id="client-review-due" class="clients-field__input" type="datetime-local" /></label>' +
        '<p class="clients-phone-muted">Версия записи: <span id="client-review-version">0</span></p>' +
        '<div class="client-review-actions">' +
        '<button type="submit" class="workspace-button workspace-button--primary" id="client-review-save">Сохранить</button>' +
        '<button type="button" class="workspace-button workspace-button--secondary" id="client-review-recheck" hidden>Подтвердить повторную проверку</button>' +
        "</div></form>" +
        '<div class="client-review-history"><h3 class="client-review-panel__subtitle">История</h3>' +
        '<div id="client-review-history-list"></div></div></section>';

      var managerCombobox = logic.mountCombobox({
        model: logic.createComboboxModel(),
        input: container.querySelector("#client-review-manager-input"),
        hidden: container.querySelector("#client-review-manager"),
        listEl: container.querySelector("#client-review-manager-list"),
        root: container.querySelector("#client-review-manager-combobox"),
        listboxId: "client-review-manager-list",
        allLabel: "Не выбран",
        options: function () {
          return eligibleManagers.map(function (item) {
            return { id: item.employeeGuid, name: item.name, shortId: item.shortId };
          });
        },
        onApplySelection: function () {},
      });

      container.querySelector("#client-review-form").addEventListener("submit", function (event) {
        event.preventDefault();
        saveReview(false);
      });
      container.querySelector("#client-review-recheck").addEventListener("click", function () {
        saveReview(true);
      });

      fillForm();
      renderHistory();
      return managerCombobox;
    }

    function loadAll() {
      return Promise.all([
        api.apiRequest("/api/clients/review/options"),
        api.apiRequest("/api/clients/review/eligible-managers"),
        api.apiRequest("/api/clients/review/eligible-reviewers"),
        api.apiRequest("/api/clients/" + encodeURIComponent(guid) + "/review"),
        api.apiRequest("/api/clients/" + encodeURIComponent(guid) + "/review/history"),
      ]).then(function (results) {
        if (results[0].response.status === 200 && results[0].data) {
          options = results[0].data;
        }
        if (results[1].response.status === 200 && results[1].data) {
          eligibleManagers = results[1].data.items || [];
        }
        if (results[2].response.status === 200 && results[2].data) {
          eligibleReviewers = results[2].data.items || [];
        }
        if (results[3].response.status === 200) {
          reviewState = results[3].data ? results[3].data.review : null;
        } else if (results[3].response.status === 403) {
          throw new Error("forbidden");
        }
        if (results[4].response.status === 200 && results[4].data) {
          historyItems = results[4].data.items || [];
        }
      });
    }

    function saveReview(recheckConfirmed) {
      saveRequestId += 1;
      var requestId = saveRequestId;
      renderFormMessage("", "");

      var stateSelect = container.querySelector("#client-review-state");
      var decisionSelect = container.querySelector("#client-review-decision");
      var commentInput = container.querySelector("#client-review-comment");
      var managerHidden = container.querySelector("#client-review-manager");
      var reviewerSelect = container.querySelector("#client-review-reviewer");
      var dueInput = container.querySelector("#client-review-due");
      var saveBtn = container.querySelector("#client-review-save");

      var dueAt = datetimeLocalToIso(dueInput.value);
      if (dueInput.value && dueAt == null) {
        renderFormMessage("error", "Некорректная дата срока проверки.");
        return Promise.resolve();
      }

      var body = {
        reviewState: stateSelect.value,
        reviewDecision: decisionSelect.value || null,
        comment: commentInput.value.trim() || null,
        proposedManagerGuid: managerHidden.value || null,
        assignedReviewerUserId: reviewerSelect.value || null,
        dueAt: dueAt,
        expectedVersion: reviewState ? reviewState.version : 0,
        recheckConfirmed: recheckConfirmed,
      };

      if (saveBtn) saveBtn.disabled = true;

      return api
        .apiRequest("/api/clients/" + encodeURIComponent(guid) + "/review", {
          method: "PUT",
          body: body,
        })
        .then(function (result) {
          if (requestId !== saveRequestId) return;
          if (result.response.status === 409) {
            renderFormMessage("error", api.extractErrorMessage(result.data, "Конфликт версии. Обновите страницу."));
            return loadAll().then(function () {
              fillForm();
              renderHistory();
            });
          }
          if (result.response.status !== 200 || !result.data) {
            renderFormMessage(
              "error",
              api.extractErrorMessage(result.data, "Не удалось сохранить ревизию."),
            );
            return;
          }
          reviewState = result.data.review;
          renderFormMessage("success", "Ревизия сохранена.");
          return api
            .apiRequest("/api/clients/" + encodeURIComponent(guid) + "/review/history")
            .then(function (historyResult) {
              if (historyResult.response.status === 200 && historyResult.data) {
                historyItems = historyResult.data.items || [];
              }
              fillForm();
              renderHistory();
            });
        })
        .catch(function (err) {
          if (requestId !== saveRequestId) return;
          renderFormMessage(
            "error",
            api.mapRequestError(err, api.REQUEST_TIMEOUT_MS / 1000),
          );
        })
        .finally(function () {
          if (saveBtn) saveBtn.disabled = false;
        });
    }

    return {
      mount: function () {
        return loadAll()
          .then(function () {
            renderShell();
          })
          .catch(function (err) {
            if (String(err && err.message) === "forbidden") {
              container.innerHTML = "";
              return;
            }
            container.innerHTML =
              '<p class="client-review-message client-review-message--error">Не удалось загрузить ревизию.</p>';
          });
      },
      isoToDatetimeLocal: isoToDatetimeLocal,
      datetimeLocalToIso: datetimeLocalToIso,
    };
  }

  root.ClientReviewPanel = {
    create: createReviewPanel,
  };
})(typeof window !== "undefined" ? window : globalThis);
