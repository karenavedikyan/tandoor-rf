(function () {
  "use strict";

  var proto = null;
  var PHASES = ["item", "photo", "comment", "recipient", "due", "summary"];

  function E(s) {
    return String(s ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/"/g, "&quot;");
  }

  function btn(label, action, cls) {
    return '<button type="button" class="' + (cls || "tt-btn") + '" data-tt="' + action + '">' + E(label) + "</button>";
  }

  function getProto() {
    return window.TanTrackerPrototype || null;
  }

  function state() {
    proto = getProto();
    return proto && proto.state ? proto.state : null;
  }

  function contacts() {
    proto = getProto();
    return proto && proto.contacts ? proto.contacts() : [];
  }

  function orders() {
    proto = getProto();
    return proto && proto.orders ? proto.orders() : [];
  }

  function contactById(id) {
    return contacts().find(function (c) {
      return c.id === id;
    });
  }

  function staffOptions(extId) {
    var fromContacts = contacts().filter(function (c) {
      return c.kind === "user" && c.id !== extId;
    });
    if (window.__TT_EXT_INTAKE_RECIPIENTS__ && window.__TT_EXT_INTAKE_RECIPIENTS__.length) {
      return window.__TT_EXT_INTAKE_RECIPIENTS__.map(function (r) {
        var c = fromContacts.find(function (x) {
          return x.userId === r.userId;
        });
        return {
          id: (c && c.id) || "staff-" + r.userId,
          name: r.fullName,
          kind: "user",
          userId: r.userId,
        };
      });
    }
    return fromContacts;
  }

  function externalOpenRequestCount(actor) {
    return orders().filter(function (o) {
      return (
        o.fromExternal &&
        o.createdById === actor &&
        o.status !== "completed" &&
        o.status !== "delivered"
      );
    }).length;
  }

  function externalActionBarHtml() {
    var st = state();
    var c = st && contactById(st.actingContactId);
    var name = (c && c.name) || "Мои передачи";
    var phone = (c && c.phone) || "";
    if (st && st.view === "ext-request") {
      return (
        '<div class="tt-ext-bar tt-ext-bar--compact" data-tt="external-bar">' +
        btn("← Мои передачи", "ext-request-close", "tt-ext-bar-back") +
        '<span class="tt-ext-bar-name">' +
        E(name) +
        "</span>" +
        btn("Выйти", "ext-logout-all", "tt-ext-bar-exit") +
        "</div>"
      );
    }
    return (
      '<header class="tt-ext-head" data-tt="external-bar">' +
      '<div class="tt-ext-head-row"><div class="tt-ext-head-id">' +
      '<p class="tt-ext-kicker">Мои передачи</p>' +
      '<h1 class="tt-ext-name">' +
      E(name) +
      "</h1>" +
      '<p class="tt-ext-sub">' +
      (phone ? E(phone) + " · " : "") +
      "вход через Telegram или MAX</p></div>" +
      btn("Выйти", "ext-logout-all", "tt-ext-bar-exit") +
      "</div>" +
      btn("Отправить предмет", "ext-request-open", "tt-primary tt-btn-block tt-ext-cta") +
      '<p class="tt-ext-cta-hint">Что передаёте → фото → кому → срок. Сотрудник получит уведомление.</p></header>'
    );
  }

  function externalShellHomeHtml() {
    var st = state();
    var actor = st && st.actingContactId;
    var rows = orders().filter(function (o) {
      return proto && proto.canViewOrder(o.id);
    });
    var hist = (st && st.historicalSummaries) || [];
    var cards =
      rows.length || hist.length
        ? (rows.length
            ? '<div class="tt-ext-groups"><section class="tt-ext-group"><h2 class="tt-ext-group-title">Мои передачи</h2><div class="tt-cards">' +
              rows
                .map(function (o) {
                  return (
                    '<article class="tt-card" data-tt="open-order" data-order-id="' +
                    E(o.id) +
                    '"><h3>' +
                    E(o.item) +
                    "</h3><p class=\"tt-muted\">" +
                    E(o.id) +
                    " · " +
                    E(o.status) +
                    "</p></article>"
                  );
                })
                .join("") +
              "</div></section></div>"
            : "") +
          (hist.length
            ? '<div class="tt-ext-groups"><section class="tt-ext-group"><h2 class="tt-ext-group-title">Упоминания в истории</h2><ul class="tt-ext-history">' +
              hist
                .map(function (h) {
                  return "<li><strong>" + E(h.itemTitle) + "</strong> · " + E(h.note) + "</li>";
                })
                .join("") +
              "</ul></section></div>"
            : "")
        : '<div class="tt-empty tt-ext-empty"><p>Пока нет передач.</p><p class="tt-muted">Отправьте предмет кнопкой выше или дождитесь назначения от сотрудника.</p></div>';
    return '<div class="tt-external-home" data-tt="external-home">' + cards + "</div>";
  }

  function extRequestView() {
    var st = state();
    if (!st) return "";
    var phase = st.extRequestPhase || "item";
    var f = st.extRequestForm || { item: "", comment: "", recipientId: "", duePreset: "today", draftId: "" };
    st.extRequestForm = f;
    var step = PHASES.indexOf(phase) + 1;
    var body = "";
    if (phase === "item") {
      body =
        '<p class="tt-muted">Что передаёте?</p><label class="tt-wizard-field"><input data-tt-field="extItem" value="' +
        E(f.item) +
        '" placeholder="Например: ключи, договор"></label>';
    } else if (phase === "photo") {
      body =
        '<p class="tt-muted">Фото предмета (до 5). Можно пропустить.</p><input type="file" accept="image/*" data-tt="ext-photo-input" />';
    } else if (phase === "comment") {
      body =
        '<label class="tt-wizard-field"><input data-tt-field="extComment" value="' +
        E(f.comment) +
        '" placeholder="Комментарий (необязательно)"></label>';
    } else if (phase === "recipient") {
      body =
        '<div class="tt-contact-pick">' +
        staffOptions(st.actingContactId)
          .map(function (c) {
            return (
              '<button type="button" class="tt-pick-row" data-tt="ext-pick-recipient" data-id="' +
              E(c.id) +
              '">' +
              E(c.name) +
              "</button>"
            );
          })
          .join("") +
        "</div>";
    } else if (phase === "due") {
      body =
        btn("Сегодня", "ext-due-today", f.duePreset === "today" ? "tt-primary" : "") +
        " " +
        btn("Завтра", "ext-due-tomorrow", f.duePreset === "tomorrow" ? "tt-primary" : "");
    } else if (phase === "summary") {
      body =
        "<ul><li>" +
        E(f.item) +
        "</li><li>" +
        E(contactById(f.recipientId)?.name || "—") +
        "</li><li>" +
        (f.duePreset === "tomorrow" ? "Завтра" : "Сегодня") +
        "</li></ul>";
    } else     if (phase === "blocked") {
      return (
        '<div class="tt-panel tt-ext-request" data-tt="ext-request"><p>Открытых заявок уже 5. Дождитесь завершения хотя бы одной.</p>' +
        btn("Закрыть", "ext-request-close", "tt-primary tt-btn-block") +
        "</div>"
      );
    }
    if (phase === "done") {
      body =
        "<p>Заявка " +
        E(f.createdId || "") +
        " отправлена. Сотрудник получит уведомление; при встрече подтвердите передачу на этой странице.</p>" +
        btn("Открыть передачу", "ext-request-open-order", "tt-primary");
    }
    return (
      '<div class="tt-panel tt-ext-request" data-tt="ext-request"><h2>Отправить предмет</h2>' +
      (step > 0 ? '<p class="tt-ext-chat-step">Шаг ' + step + " из " + PHASES.length + "</p>" : "") +
      body +
      '<div class="tt-ext-chat-actions">' +
      (phase !== "done" ? btn(phase === "summary" ? "Отправить" : "Далее", "ext-request-next", "tt-primary") : "") +
      btn("Отмена", "ext-request-close", "tt-link") +
      "</div></div>"
    );
  }

  function ensureDraft(f) {
    if (f.draftId) return Promise.resolve(f.draftId);
    return window.TanTrackerExternal.saveDraft("item", {}).then(function (res) {
      if (res.response.status !== 200) throw new Error("Черновик недоступен.");
      f.draftId = res.data.draftId;
      return f.draftId;
    });
  }

  function advancePhase() {
    var st = state();
    if (!st) return;
    var f = st.extRequestForm;
    var idx = PHASES.indexOf(st.extRequestPhase || "item");
    if (idx < PHASES.length - 1) st.extRequestPhase = PHASES[idx + 1];
    else st.extRequestPhase = "summary";
    if (window.__ttLkRenderTracker) window.__ttLkRenderTracker();
  }

  document.addEventListener(
    "click",
    function (e) {
      if (!window.__TT_EXTERNAL_PERSON__) return;
      var t = e.target.closest("[data-tt]");
      if (!t) return;
      var action = t.getAttribute("data-tt");
      var st = state();
      if (!st) return;
      if (action === "ext-request-open") {
        st.view = "list";
        st.extRequestForm = { item: "", comment: "", recipientId: "", duePreset: "today", draftId: "" };
        if (externalOpenRequestCount(st.actingContactId) >= 5) {
          st.extRequestPhase = "blocked";
          st.view = "ext-request";
          if (window.__ttLkRenderTracker) window.__ttLkRenderTracker();
          return;
        }
        void (window.TanTrackerExternal && window.TanTrackerExternal.fetchIntakeRecipients
          ? window.TanTrackerExternal.fetchIntakeRecipients().then(function (rows) {
              window.__TT_EXT_INTAKE_RECIPIENTS__ = rows;
            })
          : Promise.resolve()
        ).finally(function () {
          st.extRequestPhase = "item";
          st.view = "ext-request";
          if (window.__ttLkRenderTracker) window.__ttLkRenderTracker();
        });
        return;
      }
      if (action === "ext-request-close") {
        st.view = "list";
        st.extRequestPhase = null;
        if (window.__ttLkRenderTracker) window.__ttLkRenderTracker();
        return;
      }
      if (action === "ext-logout-all") {
        void window.TanTrackerExternal.logoutAll().then(function () {
          window.location.href = "/login";
        });
        return;
      }
      if (action === "open-order") {
        st.orderId = t.getAttribute("data-order-id");
        st.view = "detail";
        if (window.__ttLkRenderTracker) window.__ttLkRenderTracker();
        return;
      }
      if (action === "ext-pick-recipient") {
        st.extRequestForm.recipientId = t.getAttribute("data-id");
        var picked = staffOptions(st.actingContactId).find(function (c) {
          return c.id === st.extRequestForm.recipientId;
        });
        st.extRequestForm.recipientUserId = (picked && (picked.userId || picked.employeeId)) || "";
        if (window.__ttLkRenderTracker) window.__ttLkRenderTracker();
        return;
      }
      if (action === "ext-due-today") {
        st.extRequestForm.duePreset = "today";
        if (window.__ttLkRenderTracker) window.__ttLkRenderTracker();
        return;
      }
      if (action === "ext-due-tomorrow") {
        st.extRequestForm.duePreset = "tomorrow";
        if (window.__ttLkRenderTracker) window.__ttLkRenderTracker();
        return;
      }
      if (action === "ext-request-next") {
        var f = st.extRequestForm;
        var phase = st.extRequestPhase || "item";
        if (phase === "item") {
          var input = document.querySelector('[data-tt-field="extItem"]');
          f.item = (input && input.value) || "";
          if (!f.item.trim()) return;
          void ensureDraft(f).then(function () {
            return window.TanTrackerExternal.saveDraft("photo", {
              item: f.item,
              dueMode: f.duePreset === "tomorrow" ? "tomorrow" : "today",
            });
          }).then(advancePhase);
          return;
        }
        if (phase === "photo") {
          advancePhase();
          return;
        }
        if (phase === "comment") {
          var cmt = document.querySelector('[data-tt-field="extComment"]');
          f.comment = (cmt && cmt.value) || "";
          void window.TanTrackerExternal.saveDraft("recipient", {
            item: f.item,
            comment: f.comment,
            dueMode: f.duePreset === "tomorrow" ? "tomorrow" : "today",
          }).then(advancePhase);
          return;
        }
        if (phase === "recipient") {
          if (!f.recipientUserId) return;
          void window.TanTrackerExternal.saveDraft("due", {
            item: f.item,
            comment: f.comment,
            recipientUserId: f.recipientUserId,
            dueMode: f.duePreset === "tomorrow" ? "tomorrow" : "today",
          }).then(advancePhase);
          return;
        }
        if (phase === "due") {
          void window.TanTrackerExternal.saveDraft("summary", {
            item: f.item,
            comment: f.comment,
            recipientUserId: f.recipientUserId,
            dueMode: f.duePreset === "tomorrow" ? "tomorrow" : "today",
          }).then(advancePhase);
          return;
        }
        if (phase === "summary") {
          void window.TanTrackerExternal.confirmDraft(f.draftId).then(function (res) {
            if (res.data && res.data.bootstrap) {
              window.TanTrackerPrototype.hydrateFromServer(res.data.bootstrap);
            }
            f.createdId = res.data && res.data.publicCode;
            st.extRequestPhase = "done";
            if (window.__ttLkRenderTracker) window.__ttLkRenderTracker();
          });
        }
      }
      if (action === "ext-request-open-order" && f && f.createdId) {
        st.orderId = f.createdId;
        st.view = "detail";
        st.extRequestPhase = null;
        if (window.__ttLkRenderTracker) window.__ttLkRenderTracker();
      }
    },
    true,
  );

  document.addEventListener("change", function (e) {
    if (!window.__TT_EXTERNAL_PERSON__) return;
    if (e.target && e.target.matches('[data-tt="ext-photo-input"]')) {
      var st = state();
      if (!st || !st.extRequestForm) return;
      var file = e.target.files && e.target.files[0];
      if (!file) return;
      void ensureDraft(st.extRequestForm).then(function (draftId) {
        return window.TanTrackerExternal.uploadPhoto(draftId, file);
      });
    }
  });

  window.TtExternalUi = {
    externalActionBarHtml: externalActionBarHtml,
    externalShellHomeHtml: externalShellHomeHtml,
    extRequestView: extRequestView,
  };
})();
