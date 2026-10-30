(function () {
  "use strict";

  /** @typedef {"archive"|"restore"|"personal"|"personal-restore"|"delete"} CleanupUiMode */

  var deps = null;

  var API_ACTION = {
    archive: "general-archive",
    restore: "general-restore",
    personal: "personal",
    "personal-restore": "personal-restore",
    delete: "delete",
  };

  function state() {
    return deps.getState();
  }

  function orders() {
    return deps.getOrders();
  }

  function orderIsCompleted(o) {
    return o && o.status === "completed";
  }

  function orderIsDelivered(o) {
    return o && o.status === "delivered";
  }

  function isTerminal(o) {
    return orderIsCompleted(o) || orderIsDelivered(o);
  }

  function registryActorId() {
    return deps.registryActorId();
  }

  function cleanupPreviewReadOnly() {
    if (state().lkPreviewReadOnly) return true;
    if (
      deps.lkAuthenticatedCabinet &&
      deps.lkAuthenticatedCabinet() &&
      deps.lkMutationAllowed &&
      !deps.lkMutationAllowed()
    ) {
      return true;
    }
    if (state().recipientMode || state().ttRoleUnsupported) return true;
    var p = new URLSearchParams(location.hash.split("?")[1] || "");
    return p.has("as_role") || p.has("as_person") || p.get("preview") === "1";
  }

  function canManageRegistry() {
    if (cleanupPreviewReadOnly() || deps.isExternalShell() || state().actingContactId) return false;
    var rp = state().registryPersonal;
    if (rp && rp.canManageGeneralArchive) return true;
    if (!deps.isLkRuntime() && state().ttPrototypeRole === "admin") return true;
    return false;
  }

  function isGeneralArchived(o) {
    return !!(o && o.generalArchived);
  }

  function isPersonalArchived(orderId, actor) {
    var rp = state().registryPersonal;
    if (!rp || !actor) return false;
    return (rp.archivedTransferIds || []).indexOf(orderId) >= 0;
  }

  function isPersonalHidden(orderId) {
    var rp = state().registryPersonal;
    if (!rp) return false;
    return (rp.hiddenTransferIds || []).indexOf(orderId) >= 0;
  }

  function orderCreatorId(o) {
    return o && o.createdById ? o.createdById : null;
  }

  function actorRegistrySeesOrder(o, actor) {
    if (!o || !actor) return false;
    if (!deps.orderVisible(o)) return false;
    if (state().actingContactId) {
      var parts = [o.holderId, o.pendingId].concat(
        (o.timeline || []).flatMap(function (t) {
          return [t.from, t.to];
        }),
      );
      if (parts.indexOf(state().actingContactId) < 0) return false;
    }
    return true;
  }

  function isRegistryInitiator(o, actor) {
    if (!o || !actor) return false;
    return orderCreatorId(o) === actor;
  }

  function isGeneralMainRegistry() {
    return (
      (state().registryPersonalView || "main") === "main" &&
      state().mineFilter === "all" &&
      state().statusFilter === "all" &&
      !String(state().query || "").trim()
    );
  }

  function registryPersonallyHidden(o, actor) {
    if (!actor) return false;
    if (
      state().registryPersonalView === "main" &&
      isPersonalArchived(o.id, actor) &&
      !o.pendingId &&
      isTerminal(o)
    ) {
      return true;
    }
    if (!isGeneralMainRegistry()) return false;
    if (isPersonalHidden(o.id) && isRegistryInitiator(o, actor)) return true;
    return false;
  }

  function filterGeneralArchiveView(list) {
    var view = state().registryPersonalView || "main";
    if (view === "registry-archive") {
      return list.filter(function (o) {
        return isGeneralArchived(o);
      });
    }
    return list.filter(function (o) {
      return !isGeneralArchived(o);
    });
  }

  function applyRegistryPersonalView(list, actor) {
    var view = state().registryPersonalView || "main";
    if (view === "registry-archive") return list;
    if (!actor) return list;
    if (view === "archived") {
      return list.filter(function (o) {
        return actorRegistrySeesOrder(o, actor) && isPersonalArchived(o.id, actor) && !o.pendingId && isTerminal(o);
      });
    }
    if (view === "removed") {
      return list.filter(function (o) {
        return isRegistryInitiator(o, actor) && isPersonalHidden(o.id);
      });
    }
    return list.filter(function (o) {
      return !registryPersonallyHidden(o, actor);
    });
  }

  function canPersonalArchive(o, actor) {
    return !!(
      o &&
      actor &&
      !cleanupPreviewReadOnly() &&
      !o.pendingId &&
      isTerminal(o) &&
      actorRegistrySeesOrder(o, actor)
    );
  }

  function canDeleteTrack(o) {
    if (cleanupPreviewReadOnly() || !o || !deps.orderVisible(o)) return false;
    if (typeof o.canDeleteBeforeReceipt === "boolean") return o.canDeleteBeforeReceipt;
    var actor = registryActorId();
    var creator = orderCreatorId(o);
    var roleOk = canManageRegistry() || (creator && creator === actor);
    if (!roleOk) return false;
    if (orderIsCompleted(o)) return false;
    if (deps.hasConfirmedHandoff && deps.hasConfirmedHandoff(o)) return false;
    return true;
  }

  function cleanupEligible(o, mode) {
    if (!o || !deps.orderVisible(o) || cleanupPreviewReadOnly()) return false;
    var actor = registryActorId();
    if (mode === "delete") return canDeleteTrack(o);
    if (mode === "restore") return canManageRegistry() && isGeneralArchived(o);
    if (mode === "personal-restore") return isPersonalArchived(o.id, actor);
    if (mode === "personal") {
      return canPersonalArchive(o, actor) && !isPersonalArchived(o.id, actor) && !isGeneralArchived(o);
    }
    return (
      canManageRegistry() &&
      !isGeneralArchived(o) &&
      !o.pendingId &&
      isTerminal(o)
    );
  }

  function cleanupCandidates(mode) {
    return orders().filter(function (o) {
      if (!deps.orderVisible(o)) return false;
      if (mode === "restore") return isGeneralArchived(o);
      if (mode === "personal-restore") return isPersonalArchived(o.id, registryActorId());
      if (mode === "personal") return !isPersonalArchived(o.id, registryActorId());
      return !isGeneralArchived(o);
    });
  }

  function cleanupTitle(mode) {
    return (
      {
        archive: "Архивировать треки",
        restore: "Вернуть из общего архива",
        personal: "В мой архив",
        "personal-restore": "Вернуть из моего архива",
        delete: "Удалить до первого получения",
      }[mode] || ""
    );
  }

  function cleanupSelection() {
    var ids =
      state().archiveScope === "all" ? state().archiveCandidateIds || [] : state().archiveSelection || [];
    return ids
      .map(function (id) {
        return orders().find(function (o) {
          return o.id === id;
        });
      })
      .filter(Boolean);
  }

  function syncRegistrySelection(rows) {
    var key =
      registryActorId() +
      "|" +
      state().ttPrototypeRole +
      "|" +
      (state().registryPersonalView || "main") +
      "|" +
      cleanupPreviewReadOnly();
    if (state().registrySelectionKey !== key) state().registrySelection = [];
    state().registrySelectionKey = key;
    state().registryVisibleIds = rows.map(function (o) {
      return o.id;
    });
    state().registrySelection = state().registrySelection.filter(function (id) {
      return !cleanupPreviewReadOnly() && state().registryVisibleIds.indexOf(id) >= 0;
    });
    queueMicrotask(function () {
      var all = document.querySelector('[data-tt="registry-select-all"]');
      if (all) {
        all.indeterminate =
          state().registrySelection.length > 0 &&
          state().registrySelection.length < state().registryVisibleIds.length;
      }
    });
  }

  function registrySelectionOrders() {
    return state()
      .registrySelection.filter(function (id) {
        return state().registryVisibleIds.indexOf(id) >= 0;
      })
      .map(function (id) {
        return orders().find(function (o) {
          return o.id === id;
        });
      })
      .filter(function (o) {
        return o && deps.orderVisible(o);
      });
  }

  function pluralRu(n, forms) {
    var m10 = n % 10;
    var m100 = n % 100;
    if (m10 === 1 && m100 !== 11) return forms[0];
    if (m10 >= 2 && m10 <= 4 && (m100 < 10 || m100 >= 20)) return forms[1];
    return forms[2];
  }

  function registryCheckbox(o, card) {
    if (cleanupPreviewReadOnly()) return "";
    var checked = state().registrySelection.indexOf(o.id) >= 0;
    return (
      '<label class="tt-registry-check' +
      (card ? " tt-registry-check--card" : "") +
      '" data-tt="registry-check-label">' +
      '<input type="checkbox" class="tt-check-input" data-tt="registry-select" value="' +
      deps.E(o.id) +
      '" aria-label="Выбрать ' +
      deps.E(o.id) +
      ": " +
      deps.E(o.item) +
      '" ' +
      (checked ? "checked" : "") +
      ">" +
      (card ? '<span class="tt-sr-only">Выбрать передачу</span>' : "") +
      "</label>"
    );
  }

  function registrySelectionToolbar() {
    if (cleanupPreviewReadOnly()) return "";
    var selected = registrySelectionOrders();
    var n = selected.length;
    var all = n > 0 && n === state().registryVisibleIds.length;
    var total = state().registryVisibleIds.length;
    var action = function (mode, label, icon) {
      var count = selected.filter(function (o) {
        return cleanupEligible(o, mode);
      }).length;
      var hint =
        count === n ? label + ": все выбранные" : label + ": доступно " + count + " из " + n;
      return (
        '<button type="button" class="tt-selbtn' +
        (mode === "delete" ? " tt-selbtn--danger" : "") +
        '" data-tt="registry-batch" data-mode="' +
        mode +
        '" ' +
        (count ? "" : "disabled") +
        ' title="' +
        deps.E(hint) +
        '" aria-label="' +
        deps.E(label) +
        " (" +
        count +
        ')"><i data-lucide="' +
        icon +
        '" aria-hidden="true"></i><span>' +
        deps.E(label) +
        '</span><b class="tt-selbtn-count">' +
        count +
        "</b></button>"
      );
    };
    var personalMode = state().registryPersonalView === "archived" ? "personal-restore" : "personal";
    var generalMode = state().registryPersonalView === "registry-archive" ? "restore" : "archive";
    var canDelete =
      canManageRegistry() ||
      selected.some(function (o) {
        return orderCreatorId(o) === registryActorId();
      });
    var countText = n ?
      (n === 1 ? "Выбран" : "Выбрано") + " " + n + " " + pluralRu(n, ["трек", "трека", "треков"])
    : "";
    var actions = n ?
      '<div class="tt-registry-selection-actions" role="group" aria-label="Действия с выбранными треками">' +
        (state().registryPersonalView !== "registry-archive" ?
          action(
            personalMode,
            personalMode === "personal" ? "В мой архив" : "Вернуть мои",
            personalMode === "personal" ? "archive" : "archive-restore",
          )
        : "") +
        (canManageRegistry() ?
          action(
            generalMode,
            generalMode === "restore" ? "Восстановить общие" : "В общий архив",
            generalMode === "restore" ? "archive-restore" : "archive",
          )
        : "") +
        (canDelete ? action("delete", "Удалить", "trash-2") : "") +
        "</div>"
    : "";
    return (
      '<div class="tt-registry-selection' +
      (n ? " tt-registry-selection--active" : "") +
      '" data-tt="registry-selection">' +
      '<div class="tt-registry-selection-top">' +
      '<label class="tt-registry-select-all" title="' +
      (all ? "Снять выбор со всех показанных" : "Выбрать все показанные") +
      '">' +
      '<input type="checkbox" class="tt-check-input" data-tt="registry-select-all" ' +
      (all ? "checked" : "") +
      " " +
      (total ? "" : "disabled") +
      ' aria-label="' +
      (all ? "Снять выбор со всех показанных" : "Выбрать все показанные") +
      '">' +
      "<span>" +
      (n ? "Выбрано <b>" + n + "</b> из " + total : "Выбрать показанные") +
      "</span></label>" +
      '<span class="tt-registry-selection-count" role="status">' +
      (n ?
        '<span class="tt-sr-only">Выбрано: ' + n + " · " + deps.E(countText) + "</span>"
      : '<span class="tt-registry-selection-hint">Архив или удаление без открытия карточки</span>') +
      "</span>" +
      actions +
      (n ?
        '<button type="button" class="tt-selbtn tt-selbtn--icon" data-tt="registry-selection-clear" aria-label="Снять выбор" title="Снять выбор"><i data-lucide="x" aria-hidden="true"></i></button>'
      : "") +
      "</div>" +
      (n ?
        "<p>Цифра на кнопке — сколько выбранных треков доступно для действия. Удалить можно только до первого получения.</p>"
      : "") +
      "</div>"
    );
  }

  function paintRegistrySelection() {
    var host = document.querySelector('[data-tt="registry-selection"]');
    if (host) {
      host.outerHTML = registrySelectionToolbar();
      if (window.lucide && window.lucide.createIcons) window.lucide.createIcons();
    }
    document.querySelectorAll('[data-tt="registry-select"]').forEach(function (el) {
      el.checked = state().registrySelection.indexOf(el.value) >= 0;
      var row = el.closest(".tt-selectable-card") || el.closest("tr");
      if (row) row.classList.toggle("tt-is-selected", el.checked);
    });
    var all = document.querySelector('[data-tt="registry-select-all"]');
    if (all) {
      all.indeterminate =
        state().registrySelection.length > 0 &&
        state().registrySelection.length < state().registryVisibleIds.length;
    }
  }

  function archivedCountVisible() {
    return orders().filter(function (o) {
      return deps.orderVisible(o) && isGeneralArchived(o);
    }).length;
  }

  function personalArchivedCount(actor) {
    return orders().filter(function (o) {
      return (
        deps.orderVisible(o) &&
        !isGeneralArchived(o) &&
        isPersonalArchived(o.id, actor) &&
        !o.pendingId &&
        isTerminal(o)
      );
    }).length;
  }

  function personalRemovedCount() {
    var rp = state().registryPersonal;
    return rp && rp.hiddenTransferIds ? rp.hiddenTransferIds.length : 0;
  }

  function registryPersonalToolbar() {
    if (deps.isPublicGuestPage && deps.isPublicGuestPage()) return "";
    var actor = registryActorId();
    var view = state().registryPersonalView || "main";
    var counts = { archived: personalArchivedCount(actor), removed: personalRemovedCount() };
    var link = function (label, action, active) {
      return deps.btn(label, 'data-tt="' + action + '"', active ? "tt-link tt-registry-personal-active" : "tt-link");
    };
    var parts = [
      link(view === "main" ? "Мой реестр" : "← Основной реестр", "registry-view-main", view === "main"),
      link("Мой архив (" + counts.archived + ")", "registry-view-archived", view === "archived"),
    ];
    if (!cleanupPreviewReadOnly()) {
      parts.push(
        link(
          view === "archived" ? "Вернуть в мой реестр" : "В мой архив",
          view === "archived" ? "cleanup-personal-restore" : "cleanup-personal-open",
          false,
        ),
      );
    }
    if (counts.removed > 0 || view === "removed") {
      parts.push(link("Удалённые (" + counts.removed + ")", "registry-view-removed", view === "removed"));
    }
    var archivedCount = archivedCountVisible();
    var general =
      archivedCount || canManageRegistry() ?
        '<div class="tt-registry-personal-bar tt-registry-admin-bar" data-tt="registry-admin-bar">' +
          link("Архив реестра (" + archivedCount + ")", "registry-view-general-archive", view === "registry-archive") +
          (canManageRegistry() ?
            link(
              view === "registry-archive" ? "Восстановить треки" : "Очистить реестр",
              view === "registry-archive" ? "cleanup-restore-open" : "cleanup-open",
              false,
            )
          : "") +
          (canManageRegistry() && view !== "registry-archive" ?
            '<span class="tt-muted">Только администратор · общий реестр</span>'
          : "") +
          "</div>"
      : "";
    return (
      '<div class="tt-registry-personal-bar" data-tt="registry-personal-bar">' + parts.join("") + "</div>" + general
    );
  }

  function registryEmptyHtml(fallbackHtml) {
    var view = state().registryPersonalView || "main";
    if (view === "archived" || view === "registry-archive") {
      var personal = view === "archived";
      return (
        '<div class="tt-empty-v2 tt-empty" data-tt="empty"><i data-lucide="archive" aria-hidden="true"></i>' +
        "<p><strong>" +
        (personal ? "Мой архив пока пуст" : "Общий архив пока пуст") +
        "</strong></p>" +
        '<p class="tt-muted">' +
        (personal ?
          "Выполненные передачи можно убрать сюда из карточки или кнопкой «В мой архив»."
        : "Здесь появятся треки, которые администратор уберёт из общего реестра с сохранением истории.") +
        "</p>" +
        deps.btn("К актуальным передачам", 'data-tt="registry-empty-main"', "tt-link") +
        "</div>"
      );
    }
    if (view === "removed") {
      return (
        '<div class="tt-empty-v2 tt-empty" data-tt="empty"><p><strong>Нет скрытых передач</strong></p>' +
        deps.btn("К основному реестру", 'data-tt="registry-view-main"', "tt-link") +
        "</div>"
      );
    }
    return fallbackHtml;
  }

  function openCleanup(mode, order, selectedIds) {
    if (cleanupPreviewReadOnly()) return true;
    if ((mode === "archive" || mode === "restore") && !canManageRegistry()) return true;
    var preselected = selectedIds ?
      registrySelectionOrders().filter(function (o) {
        return selectedIds.indexOf(o.id) >= 0;
      })
    : null;
    if (preselected && !preselected.some(function (o) { return cleanupEligible(o, mode); })) return true;
    if (
      mode === "delete" &&
      !canManageRegistry() &&
      !(order && canDeleteTrack(order)) &&
      !(preselected && preselected.some(function (o) { return canDeleteTrack(o); }))
    ) {
      return true;
    }
    state().archiveReturnFocus = document.activeElement && document.activeElement.getAttribute("data-tt");
    state().archiveDialog = mode;
    state().archiveActorKey = registryActorId() + "|" + state().ttPrototypeRole;
    state().archiveCandidateIds = preselected ?
      preselected.map(function (o) { return o.id; })
    : order ?
      [order.id]
    : cleanupCandidates(mode).map(function (o) { return o.id; });
    state().archiveSelection = preselected ?
      preselected
        .filter(function (o) { return cleanupEligible(o, mode); })
        .map(function (o) { return o.id; })
    : order ?
      [order.id]
    : [];
    state().archiveFromRegistry = !!preselected;
    state().archiveSingle = !!order;
    state().archiveScope = "selected";
    state().archiveReason = state().archiveError = state().archiveTypedAck = "";
    state().archiveAllAck = false;
    deps.renderTracker();
    return true;
  }

  function closeCleanup() {
    var focus = state().archiveReturnFocus;
    state().archiveDialog = null;
    state().archiveError = "";
    deps.renderTracker();
    var targets = Array.prototype.slice.call(document.querySelectorAll("[data-tt]"));
    var el =
      targets.find(function (node) {
        return node.getAttribute("data-tt") === focus;
      }) || document.querySelector('[data-tt="cleanup-open"]');
    if (el && el.focus) el.focus();
    return true;
  }

  function skipReason(o, mode, allowed) {
    if (allowed) {
      if (mode === "delete") return "Получение ещё не подтверждалось";
      if (mode === "restore" || mode === "personal-restore") return "Можно восстановить";
      return "Выполнено, без ожидаемой передачи";
    }
    if (mode === "delete") return "Удаление недоступно: получение уже было или история не подтверждает его отсутствие";
    if (isGeneralArchived(o)) return "Будет пропущен: уже в общем архиве";
    if (o.pendingId) return "Будет пропущен: ожидается получение";
    return "Будет пропущен: передача ещё в работе";
  }

  function cleanupDialogHtml() {
    var mode = state().archiveDialog;
    if (!mode) return "";
    var candidates = (state().archiveCandidateIds || [])
      .map(function (id) {
        return orders().find(function (o) { return o.id === id; });
      })
      .filter(Boolean);
    var selected = cleanupSelection();
    var eligible = selected.filter(function (o) { return cleanupEligible(o, mode); });
    var skipped = selected.length - eligible.length;
    var personal = mode.indexOf("personal") === 0;
    var restoring = mode.indexOf("restore") >= 0;
    var deleting = mode === "delete";
    var verb = deleting ? "Удалить" : restoring ? "Восстановить" : "Архивировать";
    var all = state().archiveScope === "all";
    var disabled =
      !eligible.length || (all && !state().archiveAllAck) || (deleting && state().archiveTypedAck !== "УДАЛИТЬ");
    var description = deleting ?
      "Только до первого подтверждённого получения кем-либо, включая промежуточного получателя. Трек и его файлы не попадут в архив; ссылка, код и QR перестанут действовать. Восстановить удалённое нельзя."
    : restoring ?
      personal ?
        "Треки вернутся в ваш основной список. Реестры других участников не изменятся."
      : "Треки вернутся в общий реестр. Статусы, маршрут и история останутся прежними."
    : personal ?
      "Уберите выполненные передачи из своего рабочего списка. Другие участники продолжат видеть их как прежде; история и файлы сохранятся."
    : "Выполненные треки уйдут в общий архив. История и файлы сохранятся; восстановление доступно администратору. Активные передачи будут пропущены.";
    var listHtml = candidates.length ?
      candidates
        .map(function (o) {
          var allowed = cleanupEligible(o, mode);
          var checked = all || state().archiveSelection.indexOf(o.id) >= 0;
          return (
            '<label class="tt-cleanup-track' +
            (allowed ? "" : " tt-cleanup-track--skip") +
            '">' +
            '<input type="checkbox" data-tt="cleanup-select" value="' +
            deps.E(o.id) +
            '" ' +
            (checked ? "checked" : "") +
            " " +
            (all || !allowed ? "disabled" : "") +
            ">" +
            "<span><strong>" +
            deps.E(o.item) +
            '</strong><span class="tt-cleanup-track-id">' +
            deps.E(o.id) +
            "</span><small>" +
            deps.E(skipReason(o, mode, allowed)) +
            "</small></span></label>"
          );
        })
        .join("")
    : '<p class="tt-muted">Подходящих записей пока нет.</p>';
    return (
      '<dialog class="tt-cleanup-dialog tt-work" data-tt="cleanup-dialog" aria-labelledby="tt-cleanup-title" aria-describedby="tt-cleanup-description">' +
      '<header class="tt-cleanup-head"><h2 id="tt-cleanup-title">' +
      deps.E(cleanupTitle(mode)) +
      "</h2>" +
      deps.btn("Закрыть", 'data-tt="cleanup-cancel" autofocus', "tt-link") +
      "</header>" +
      '<div class="tt-cleanup-body">' +
      (canManageRegistry() && !state().archiveSingle && !state().archiveFromRegistry && (mode === "archive" || mode === "delete") ?
        '<div class="tt-cleanup-mode" role="group" aria-label="Способ очистки">' +
          deps.btn("Архивирование", 'data-tt="cleanup-mode" data-mode="archive" aria-pressed="' + (mode === "archive") + '"', "tt-link") +
          deps.btn("Удаление", 'data-tt="cleanup-mode" data-mode="delete" aria-pressed="' + (mode === "delete") + '"', "tt-link") +
          "</div>"
      : "") +
      '<p id="tt-cleanup-description">' +
      deps.E(description) +
      "</p>" +
      (state().archiveFromRegistry ?
        '<p class="tt-cleanup-selected-scope">Выбрано в реестре: <strong>' +
          candidates.length +
          "</strong>. Только эти треки; неподходящих: <strong>" +
          candidates.filter(function (o) { return !cleanupEligible(o, mode); }).length +
          "</strong>.</p>"
      : "") +
      (!state().archiveSingle && !state().archiveFromRegistry ?
        '<fieldset class="tt-cleanup-scope"><legend>Какие треки</legend>' +
          '<label><input type="radio" name="tt-cleanup-scope" data-tt="cleanup-scope" value="selected" ' +
          (!all ? "checked" : "") +
          "> Выбранные</label>" +
          '<label><input type="radio" name="tt-cleanup-scope" data-tt="cleanup-scope" value="all" ' +
          (all ? "checked" : "") +
          "> " +
          (personal ? "Все в моей области" : "Весь реестр") +
          " (" +
          candidates.length +
          ")</label></fieldset>" +
          '<p class="tt-muted">Поиск и фильтры основного реестра не ограничивают список ниже.</p>'
      : "") +
      '<div class="tt-cleanup-list" role="group" aria-label="Треки для действия">' +
      listHtml +
      "</div>" +
      '<p class="tt-cleanup-summary" data-tt="cleanup-summary" role="status">' +
      verb +
      ": <strong>" +
      eligible.length +
      "</strong>" +
      (skipped ? " · Будет пропущено: <strong>" + skipped + "</strong>" : "") +
      "</p>" +
      (!deleting && !personal && !restoring ?
        '<label class="tt-cleanup-field">Причина (необязательно)<textarea data-tt="cleanup-reason" maxlength="300" rows="2" placeholder="Например, тестирование завершено">' +
          deps.E(state().archiveReason || "") +
          "</textarea></label>"
      : "") +
      (all ?
        '<label class="tt-cleanup-ack"><input type="checkbox" data-tt="cleanup-ack" ' +
          (state().archiveAllAck ? "checked" : "") +
          "><span>Подтверждаю действие для " +
          (personal ? "всех подходящих треков в моей области" : "всего реестра") +
          ", независимо от текущих фильтров. Неподходящие записи останутся без изменений.</span></label>"
      : "") +
      (deleting ?
        '<label class="tt-cleanup-field">Для подтверждения введите УДАЛИТЬ<input data-tt="cleanup-delete-ack" value="' +
          deps.E(state().archiveTypedAck || "") +
          '" autocomplete="off" spellcheck="false"></label>'
      : "") +
      (state().archiveError ? '<p class="tt-error" role="alert">' + deps.E(state().archiveError) + "</p>" : "") +
      "</div>" +
      '<footer class="tt-cleanup-footer">' +
      deps.btn("Отмена", 'data-tt="cleanup-cancel"', "tt-link") +
      deps.btn(
        verb + " (" + eligible.length + ")",
        'data-tt="cleanup-confirm" ' + (disabled ? "disabled" : ""),
        deleting ? "tt-cleanup-danger" : "tt-primary",
      ) +
      "</footer></dialog>"
    );
  }

  function updateCleanupSummary() {
    var mode = state().archiveDialog;
    if (!mode) return;
    var selected = cleanupSelection();
    var count = selected.filter(function (o) { return cleanupEligible(o, mode); }).length;
    var skipped = selected.length - count;
    var verb = mode === "delete" ? "Удалить" : mode.indexOf("restore") >= 0 ? "Восстановить" : "Архивировать";
    var summary = document.querySelector('[data-tt="cleanup-summary"]');
    if (summary) {
      summary.textContent = verb + ": " + count + (skipped ? " · Будет пропущено: " + skipped : "");
    }
    var button = document.querySelector('[data-tt="cleanup-confirm"]');
    if (button) {
      button.textContent = verb + " (" + count + ")";
      button.disabled =
        !count ||
        (state().archiveScope === "all" && !state().archiveAllAck) ||
        (mode === "delete" && state().archiveTypedAck !== "УДАЛИТЬ");
    }
  }

  function postCleanup(body) {
    if (deps.api && deps.api.registryCleanup) return deps.api.registryCleanup(body);
    return Promise.reject(new Error("Очистка реестра недоступна в этом режиме."));
  }

  function refreshAfterCleanup() {
    if (deps.api && deps.api.refreshBootstrap) return deps.api.refreshBootstrap();
    return Promise.resolve();
  }

  function confirmCleanup() {
    var mode = state().archiveDialog;
    if (!mode || cleanupPreviewReadOnly()) return true;
    if (state().archiveActorKey !== registryActorId() + "|" + state().ttPrototypeRole) return true;
    var selected = cleanupSelection();
    var targets = selected.filter(function (o) { return cleanupEligible(o, mode); });
    if (
      !targets.length ||
      (state().archiveScope === "all" && !state().archiveAllAck) ||
      (mode === "delete" && state().archiveTypedAck !== "УДАЛИТЬ")
    ) {
      return true;
    }
    if (state().archiveScope !== "all" && targets.length !== state().archiveSelection.length) {
      state().archiveError = "Состояние или доступ изменились. Закройте окно и выберите треки заново.";
      deps.renderTracker();
      return true;
    }
    var apiAction = API_ACTION[mode];
    if (!apiAction) return true;
    var payload = {
      action: apiAction,
      transferIds: targets.map(function (o) { return o.id; }),
      reason: state().archiveReason ? String(state().archiveReason).trim() : undefined,
      allAck: state().archiveScope === "all" ? true : undefined,
      deleteAck: mode === "delete" ? state().archiveTypedAck : undefined,
    };
    state().archiveError = "";
    var confirmBtn = document.querySelector('[data-tt="cleanup-confirm"]');
    if (confirmBtn) confirmBtn.disabled = true;
    postCleanup(payload)
      .then(function (result) {
        var applied = (result && result.applied) || [];
        var skipped = (result && result.skipped) || [];
        return refreshAfterCleanup().then(function () {
          var count = applied.length;
          var skipN = skipped.length;
          state().registrySelection = state().registrySelection.filter(function (id) {
            return applied.indexOf(id) < 0;
          });
          state().archiveDialog = null;
          var verb =
            mode === "delete" ? "Удалено" : mode.indexOf("restore") >= 0 ? "Восстановлено" : "В архиве";
          state().toast =
            verb +
            ": " +
            count +
            "." +
            (skipN ? " Пропущено: " + skipN + "." : " ") +
            (mode === "delete" ?
              " Старые ссылки, коды и QR недействительны."
            : " История и файлы сохранены.");
          state().error = "";
          if (mode === "delete" || state().view === "list") {
            state().view = "list";
            state().orderId = null;
            if (mode === "personal") state().registryPersonalView = "main";
            deps.writeUrl();
          }
          deps.renderTracker();
        });
      })
      .catch(function (err) {
        state().archiveError = (err && err.message) || "Не удалось выполнить действие.";
        deps.renderTracker();
      });
    return true;
  }

  function beforeRenderContent() {
    if (
      state().archiveDialog &&
      (cleanupPreviewReadOnly() || state().archiveActorKey !== registryActorId() + "|" + state().ttPrototypeRole)
    ) {
      state().archiveDialog = null;
    }
  }

  function afterRenderContent() {
    var cleanupDialog = document.querySelector('[data-tt="cleanup-dialog"]');
    if (cleanupDialog && !cleanupDialog.open && cleanupDialog.showModal) cleanupDialog.showModal();
  }

  function shouldIgnoreRegistryOpenClick(target) {
    return !!target.closest('[data-tt="registry-check-label"], [data-tt="registry-select"], [data-tt="registry-select-all"]');
  }

  function handleClick(action, order) {
    if (action === "registry-view-main" || action === "registry-empty-main") {
      state().registryPersonalView = "main";
      deps.renderTracker();
      return true;
    }
    if (action === "registry-view-general-archive") {
      state().registryPersonalView = "registry-archive";
      state().statusFilter = "all";
      state().mineFilter = "all";
      state().query = "";
      deps.renderTracker();
      return true;
    }
    if (action === "registry-view-archived") {
      state().registryPersonalView = "archived";
      state().statusFilter = "all";
      state().mineFilter = "all";
      deps.renderTracker();
      return true;
    }
    if (action === "registry-view-removed") {
      state().registryPersonalView = "removed";
      state().statusFilter = "all";
      state().mineFilter = "all";
      deps.renderTracker();
      return true;
    }
    if (action === "registry-selection-clear") {
      state().registrySelection = [];
      paintRegistrySelection();
      var all = document.querySelector('[data-tt="registry-select-all"]');
      if (all && all.focus) all.focus();
      return true;
    }
    if (action === "registry-batch") {
      return true;
    }
    if (action && action.indexOf("cleanup-") === 0) {
      if (action === "cleanup-cancel") return closeCleanup();
      if (action === "cleanup-confirm") return confirmCleanup();
      if (action === "cleanup-mode") return true;
      if (action === "cleanup-open") return openCleanup("archive");
      if (action === "cleanup-personal-open") return openCleanup("personal");
      if (action === "cleanup-personal-restore") return openCleanup("personal-restore");
      if (action === "cleanup-restore-open") return openCleanup("restore");
      if (action === "cleanup-delete-one" && order) return openCleanup("delete", order);
      if (action === "cleanup-archive-one" && order) return openCleanup("archive", order);
      if (action === "cleanup-restore-one" && order) return openCleanup("restore", order);
      return true;
    }
    return false;
  }

  function handleClickWithButton(action, order, button) {
    if (action === "registry-batch") {
      var mode = button && button.getAttribute("data-mode");
      if (
        !cleanupPreviewReadOnly() &&
        ["personal", "personal-restore", "archive", "restore", "delete"].indexOf(mode) >= 0
      ) {
        openCleanup(mode, null, state().registrySelection.slice());
      }
      return true;
    }
    if (action === "cleanup-mode") {
      var m = button && button.getAttribute("data-mode");
      openCleanup(m === "delete" ? "delete" : "archive");
      return true;
    }
    return handleClick(action, order);
  }

  function handleChange(target) {
    if (target.matches('[data-tt="registry-select"], [data-tt="registry-select-all"]')) {
      if (cleanupPreviewReadOnly()) return true;
      if (target.matches('[data-tt="registry-select-all"]')) {
        state().registrySelection = target.checked ? state().registryVisibleIds.slice() : [];
      } else if (state().registryVisibleIds.indexOf(target.value) >= 0) {
        if (target.checked) {
          state().registrySelection = Array.from(new Set(state().registrySelection.concat([target.value])));
        } else {
          state().registrySelection = state().registrySelection.filter(function (id) {
            return id !== target.value;
          });
        }
      }
      paintRegistrySelection();
      return true;
    }
    if (target.matches('[data-tt="cleanup-select"]')) {
      var id = target.value;
      if (target.checked) {
        state().archiveSelection = Array.from(new Set(state().archiveSelection.concat([id])));
      } else {
        state().archiveSelection = state().archiveSelection.filter(function (x) {
          return x !== id;
        });
      }
      updateCleanupSummary();
      return true;
    }
    if (target.matches('[data-tt="cleanup-scope"]')) {
      state().archiveScope = target.value === "all" ? "all" : "selected";
      state().archiveAllAck = false;
      deps.renderTracker();
      return true;
    }
    if (target.matches('[data-tt="cleanup-ack"]')) {
      state().archiveAllAck = target.checked;
      updateCleanupSummary();
      return true;
    }
    return false;
  }

  function handleInput(target) {
    if (target.matches('[data-tt="cleanup-reason"]')) {
      state().archiveReason = target.value;
      return true;
    }
    if (target.matches('[data-tt="cleanup-delete-ack"]')) {
      state().archiveTypedAck = target.value;
      updateCleanupSummary();
      return true;
    }
    return false;
  }

  function init(api) {
    deps = api;
  }

  window.TtRegistryCleanup = {
    init: init,
    filterGeneralArchiveView: filterGeneralArchiveView,
    applyRegistryPersonalView: applyRegistryPersonalView,
    syncRegistrySelection: syncRegistrySelection,
    registrySelectionToolbar: registrySelectionToolbar,
    paintRegistrySelection: paintRegistrySelection,
    registryPersonalToolbar: registryPersonalToolbar,
    registryEmptyHtml: registryEmptyHtml,
    registryCheckbox: registryCheckbox,
    cleanupPreviewReadOnly: cleanupPreviewReadOnly,
    cleanupDialogHtml: cleanupDialogHtml,
    beforeRenderContent: beforeRenderContent,
    afterRenderContent: afterRenderContent,
    shouldIgnoreRegistryOpenClick: shouldIgnoreRegistryOpenClick,
    handleClickWithButton: handleClickWithButton,
    handleChange: handleChange,
    handleInput: handleInput,
    isGeneralArchived: isGeneralArchived,
    canManageRegistry: canManageRegistry,
  };
})();
