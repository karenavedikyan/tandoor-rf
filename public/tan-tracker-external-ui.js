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

  function fmtPhone(phone) {
    if (!phone) return "";
    var digits = String(phone).replace(/\D/g, "");
    if (digits.length === 11 && digits[0] === "7") digits = digits.slice(1);
    if (digits.length !== 10) return String(phone);
    return "+7 " + digits.slice(0, 3) + " " + digits.slice(3, 6) + " " + digits.slice(6, 8) + " " + digits.slice(8);
  }

  function fmtDt(ts) {
    if (!ts) return "—";
    try {
      return new Date(ts).toLocaleString("ru-RU", {
        day: "numeric",
        month: "short",
        hour: "2-digit",
        minute: "2-digit",
      });
    } catch (_e) {
      return "—";
    }
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
          phone: (c && c.phone) || "",
        };
      });
    }
    return fromContacts;
  }

  function selectedRecipient(f, actingContactId) {
    if (!f) return null;
    var opts = staffOptions(actingContactId);
    if (f.recipientUserId) {
      var byUser = opts.find(function (c) {
        return String(c.userId || "") === String(f.recipientUserId);
      });
      if (byUser) return byUser;
      var fromContacts = contacts().find(function (c) {
        return (
          c.kind === "user" &&
          (String(c.userId || "") === String(f.recipientUserId) || c.id === f.recipientUserId)
        );
      });
      if (fromContacts) return fromContacts;
    }
    if (f.recipientId) {
      var byPickId = opts.find(function (c) {
        return c.id === f.recipientId;
      });
      if (byPickId) return byPickId;
      return contactById(f.recipientId) || null;
    }
    return null;
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
    if (st && (st.view === "ext-request" || ((st.view === "detail" || st.view === "code") && st.orderId))) {
      return (
        '<div class="tt-ext-bar tt-ext-bar--compact" data-tt="external-bar">' +
        btn("← Мои передачи", "back-list", "tt-ext-bar-back") +
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
      (phone ? E(fmtPhone(phone)) + " · " : "") +
      "вход через Telegram или MAX</p></div>" +
      btn("Выйти", "ext-logout-all", "tt-ext-bar-exit") +
      "</div>" +
      btn("Отправить предмет", "ext-request-open", "tt-primary tt-btn-block tt-ext-cta") +
      '<p class="tt-ext-cta-hint">Как в боте: что передаёте → фото → кому → срок. Сотрудник получит уведомление.</p></header>'
    );
  }

  function externalGroupOrders(rows, actor) {
    var action = [];
    var progress = [];
    var done = [];
    rows.forEach(function (o) {
      if (o.status === "completed") done.push(o);
      else if (o.pendingId === actor || (o.holderId === actor && o.pendingId)) action.push(o);
      else progress.push(o);
    });
    return [
      { id: "action", title: "Требуют вашего действия", items: action },
      { id: "progress", title: "В пути", items: progress },
      { id: "done", title: "Недавно завершённые", items: done },
    ].filter(function (g) {
      return g.items.length;
    });
  }

  function registryCard(o) {
    var st = state();
    if (proto && proto.registryCardHtml && st) {
      return proto.registryCardHtml(o, st.actingContactId);
    }
    return (
      '<article class="tt-card" data-tt="open-order" data-order-id="' +
      E(o.id) +
      '"><h3>' +
      E(o.item) +
      '</h3><p class="tt-muted">' +
      E(o.id) +
      " · " +
      E(o.status) +
      "</p></article>"
    );
  }

  function externalShellHomeHtml() {
    var st = state();
    var actor = st && st.actingContactId;
    var rows = orders().filter(function (o) {
      return proto && proto.canViewOrder(o.id);
    });
    var cutoff = Date.now() - 30 * 86400000;
    var groups = externalGroupOrders(rows, actor).map(function (g) {
      if (g.id === "done") {
        return {
          id: g.id,
          title: g.title,
          items: g.items.filter(function (o) {
            var tl = o.timeline || [];
            var last = tl.length ? tl[tl.length - 1].at : 0;
            return last >= cutoff;
          }),
        };
      }
      return g;
    }).filter(function (g) {
      return g.items.length;
    });
    var hist = (st && st.historicalSummaries) || [];
    var cards = groups.length
      ? '<div class="tt-ext-groups" data-tt="external-order-list">' +
        groups
          .map(function (g) {
            return (
              '<section class="tt-ext-group" data-tt-ext-group="' +
              E(g.id) +
              '"><h2 class="tt-ext-group-title">' +
              E(g.title) +
              ' <span class="tt-ext-group-count">' +
              g.items.length +
              '</span></h2><div class="tt-cards">' +
              g.items.map(registryCard).join("") +
              "</div></section>"
            );
          })
          .join("") +
        "</div>"
      : '<div class="tt-empty tt-ext-empty" data-tt="external-empty"><i data-lucide="package-open"></i><p>Пока нет передач.</p><p class="tt-muted">Когда сотрудник Тандор назначит вам передачу или вы отправите предмет, она появится здесь.</p></div>';
    if (hist.length) {
      cards +=
        '<div class="tt-ext-groups"><section class="tt-ext-group"><h2 class="tt-ext-group-title">Упоминания в истории</h2><ul class="tt-ext-history">' +
        hist
          .map(function (h) {
            return "<li><strong>" + E(h.itemTitle) + "</strong> · " + E(h.note) + "</li>";
          })
          .join("") +
        "</ul></section></div>";
    }
    return '<div class="tt-external-home" data-tt="external-home">' + cards + "</div>";
  }

  function extRequestBotBubble(text) {
    return '<div class="tt-bot-preview tt-bot-preview--bubble" data-tt="ext-request-bot"><p>' + E(text) + "</p></div>";
  }

  function extRequestChatRow(label, value) {
    return (
      '<div class="tt-ext-chat-answer"><span class="tt-ext-chat-answer-label">' +
      E(label) +
      "</span><strong>" +
      E(value) +
      "</strong></div>"
    );
  }

  function extRequestAnswersHtml(f, phase) {
    var idx = PHASES.indexOf(phase);
    var rows = [];
    if (idx > 0 && f.item) rows.push(extRequestChatRow("Предмет", f.item));
    if (idx > 1) rows.push(extRequestChatRow("Фото", f.photoCount ? f.photoCount + " шт." : "без фото"));
    if (idx > 2) rows.push(extRequestChatRow("Комментарий", (f.comment && f.comment.trim()) || "—"));
    if (idx > 3 && (f.recipientId || f.recipientUserId)) {
      var stAct = state();
      var recAnswer = selectedRecipient(f, stAct && stAct.actingContactId);
      rows.push(extRequestChatRow("Кому", recAnswer?.name || "—"));
    }
    if (idx > 4) rows.push(extRequestChatRow("Срок", f.duePreset === "tomorrow" ? "Завтра" : "Сегодня"));
    return rows.length ? '<div class="tt-ext-chat-answers">' + rows.join("") + "</div>" : "";
  }

  function extRequestFrame(inner, meta) {
    meta = meta || {};
    var step = meta.step;
    var total = meta.total || PHASES.length;
    var progress =
      step && step > 0
        ? '<div class="tt-ext-chat-progress" aria-hidden="true"><span style="width:' +
          Math.round((step / total) * 100) +
          '%"></span></div>'
        : "";
    var stepLabel =
      step && step > 0 ? '<span class="tt-ext-chat-step">Шаг ' + step + " из " + total + "</span>" : "";
    return (
      '<div class="tt-panel tt-ext-request" data-tt="ext-request">' +
      '<div class="tt-ext-chat-head">' +
      '<span class="tt-ext-chat-avatar" aria-hidden="true"><i data-lucide="bot"></i></span>' +
      "<div><h2>Отправить предмет</h2><p class=\"tt-ext-chat-sub\">Бот Тан-трекера</p></div>" +
      stepLabel +
      "</div>" +
      progress +
      inner +
      "</div>"
    );
  }

  function extRequestView() {
    var st = state();
    if (!st) return "";
    var phase = st.extRequestPhase || "item";
    var f = st.extRequestForm || {
      item: "",
      comment: "",
      recipientId: "",
      duePreset: "today",
      draftId: "",
      photoCount: 0,
    };
    st.extRequestForm = f;

    if (phase === "blocked") {
      return extRequestFrame(
        extRequestBotBubble("Открытых заявок уже 5 — дождитесь завершения хотя бы одной, затем попробуйте снова.") +
          '<div class="tt-ext-chat-actions">' +
          btn("Закрыть", "ext-request-close", "tt-primary tt-btn-block") +
          "</div>",
      );
    }

    if (phase === "done") {
      var staff = selectedRecipient(f, st.actingContactId);
      var photos = f.photoCount || 0;
      return extRequestFrame(
        extRequestBotBubble(
          "Заявка " +
            (f.createdId || "") +
            " создана" +
            (photos ? ", фото приложено (" + photos + ")" : "") +
            ". Передайте «" +
            (f.item || "") +
            "» — " +
            (staff?.name || "—") +
            ". При встрече введите код на странице передачи.",
        ) +
          '<div class="tt-ext-chat-actions">' +
          btn("Открыть мою передачу", "ext-request-open-order", "tt-primary tt-btn-block") +
          btn("К списку", "ext-request-close", "tt-btn-ghost tt-btn-block") +
          "</div>",
      );
    }

    var step = PHASES.indexOf(phase) + 1;
    var body = "";
    var nextLabel = "Далее";
    if (phase === "item") {
      body =
        extRequestBotBubble("Что передаёте?") +
        '<label class="tt-wizard-field tt-ext-chat-field"><span class="tt-visually-hidden">Предмет</span><input data-tt-field="extItem" value="' +
        E(f.item) +
        '" autocomplete="off" placeholder="Например: ключи, договор, образцы"></label>';
    } else if (phase === "photo") {
      body =
        extRequestBotBubble("Пришлите фото предмета — так сотруднику проще его узнать. Можно пропустить.") +
        '<div class="tt-ext-chat-attach"><p class="tt-muted tt-att-hint">Фото попадёт в карточку передачи.</p><input type="file" accept="image/*" data-tt="ext-photo-input" /></div>';
      if (!f.photoCount) nextLabel = "Пропустить";
    } else if (phase === "comment") {
      body =
        extRequestBotBubble("Добавите комментарий? Можно пропустить.") +
        '<label class="tt-wizard-field tt-ext-chat-field"><span class="tt-visually-hidden">Комментарий</span><input data-tt-field="extComment" value="' +
        E(f.comment) +
        '" placeholder="Комментарий (необязательно)"></label>';
      if (!(f.comment && f.comment.trim())) nextLabel = "Пропустить";
    } else if (phase === "recipient") {
      body =
        extRequestBotBubble("Кому передать?") +
        '<div class="tt-contact-pick tt-ext-chat-pick" data-tt="ext-request-recipients">' +
        staffOptions(st.actingContactId)
          .map(function (c) {
            return (
              '<button type="button" data-tt="ext-pick-recipient" data-id="' +
              E(c.id) +
              '" aria-pressed="' +
              (f.recipientId === c.id) +
              '"><span class="tt-ext-pick-name">' +
              E(c.name) +
              "</span><small>" +
              E(c.phone ? fmtPhone(c.phone) : "сотрудник") +
              "</small></button>"
            );
          })
          .join("") +
        "</div>";
    } else if (phase === "due") {
      body =
        extRequestBotBubble("До какого срока нужно передать?") +
        '<div class="tt-ext-chat-chips">' +
        btn("Сегодня", "ext-due-today", f.duePreset === "today" ? "tt-primary" : "") +
        btn("Завтра", "ext-due-tomorrow", f.duePreset === "tomorrow" ? "tt-primary" : "") +
        "</div>";
    } else if (phase === "summary") {
      var staffSum = selectedRecipient(f, st.actingContactId);
      body =
        extRequestBotBubble("Проверьте заявку. Если всё верно — создаю передачу и сообщаю сотруднику.") +
        '<dl class="tt-ext-chat-summary">' +
        "<div><dt>Предмет</dt><dd>" +
        E(f.item) +
        "</dd></div>" +
        "<div><dt>Фото</dt><dd>" +
        (f.photoCount ? f.photoCount + " шт." : "без фото") +
        "</dd></div>" +
        "<div><dt>Комментарий</dt><dd>" +
        E((f.comment && f.comment.trim()) || "—") +
        "</dd></div>" +
        "<div><dt>Кому</dt><dd>" +
        E(staffSum?.name || "—") +
        (staffSum?.phone ? "<small>" + E(fmtPhone(staffSum.phone)) + "</small>" : "") +
        "</dd></div>" +
        "<div><dt>Срок</dt><dd>" +
        (f.duePreset === "tomorrow" ? "Завтра" : "Сегодня") +
        "</dd></div></dl>";
      nextLabel = "Создать заявку";
    }

    return extRequestFrame(
      extRequestAnswersHtml(f, phase) +
        body +
        (st.error ? '<p class="tt-error">' + E(st.error) + "</p>" : "") +
        '<div class="tt-ext-chat-actions">' +
        btn(nextLabel, "ext-request-next", "tt-primary tt-btn-block") +
        '<div class="tt-ext-chat-secondary">' +
        btn(step > 1 ? "Назад" : "К списку", "ext-request-back", "tt-link") +
        btn("Отмена", "ext-request-close", "tt-link") +
        "</div></div>",
      { step: step, total: PHASES.length },
    );
  }

  function isConfirmedHandoffNote(note) {
    return /подтвержден/i.test(String(note || "")) || /код/i.test(String(note || ""));
  }

  function externalHolderDetailBlocks(o, actor) {
    if (!o || o.holderId !== actor) return "";
    var fin = o.finalRecipientId ? contactById(o.finalRecipientId) : null;
    var mustRelay =
      !o.pendingId &&
      o.finalRecipientId &&
      o.holderId !== o.finalRecipientId &&
      o.status !== "completed" &&
      o.status !== "delivered";
    var deliveredFinal = o.status === "delivered" && o.holderId === o.finalRecipientId && !o.pendingId;
    var prevEntry =
      (o.timeline || [])
        .filter(function (t) {
          return t.to === o.holderId && isConfirmedHandoffNote(t.note);
        })
        .sort(function (a, b) {
          return a.at - b.at;
        })
        .pop() || null;
    var prevHolder = contactById(prevEntry?.from);
    var statusCard =
      '<article class="tt-panel tt-recipient-card" data-tt="holder-status-card">' +
      '<h2 class="tt-recipient-hero">Предмет у вас</h2>' +
      '<p class="tt-recipient-from">С ' +
      E(fmtDt(o.holderSince)) +
      " · получено от <strong>" +
      E(prevHolder?.name || "—") +
      "</strong></p></article>";
    var nextStep;
    if (mustRelay) {
      nextStep =
        '<div class="tt-reminder" data-tt="holder-next-step"><p><strong>Передайте дальше:</strong> ' +
        E(fin?.name || "—") +
        "</p>" +
        (o.dueAt ? '<p class="tt-muted">Срок: до ' + E(fmtDt(o.dueAt)) + "</p>" : "") +
        btn("Передать дальше", "transfer", "tt-primary tt-btn-block") +
        "</div>";
    } else if (deliveredFinal) {
      nextStep =
        '<div class="tt-panel" data-tt="holder-delivered"><p class="tt-success">Передача дошла до вас. Делать ничего не нужно.</p>' +
        btn("Передать дальше или вернуть", "transfer", "tt-btn-ghost tt-btn-block") +
        "</div>";
    } else if (o.status === "completed") {
      nextStep =
        '<div class="tt-success tt-panel" data-tt="holder-next-step"><p>Передача завершена</p><p class="tt-muted">Больше ничего делать не нужно.</p></div>';
    } else {
      return "";
    }
    return statusCard + nextStep;
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
    var idx = PHASES.indexOf(st.extRequestPhase || "item");
    if (idx < PHASES.length - 1) st.extRequestPhase = PHASES[idx + 1];
    else st.extRequestPhase = "summary";
    st.error = "";
    if (window.__ttLkRenderTracker) window.__ttLkRenderTracker();
  }

  function retreatPhase() {
    var st = state();
    if (!st) return;
    var idx = PHASES.indexOf(st.extRequestPhase || "item");
    if (idx <= 0) {
      st.view = "list";
      st.extRequestPhase = null;
      st.error = "";
    } else {
      st.extRequestPhase = PHASES[idx - 1];
      st.error = "";
    }
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
      var f = st.extRequestForm;
      if (action === "ext-request-open") {
        st.view = "list";
        st.extRequestForm = { item: "", comment: "", recipientId: "", duePreset: "today", draftId: "", photoCount: 0 };
        st.error = "";
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
        st.error = "";
        if (window.__ttLkRenderTracker) window.__ttLkRenderTracker();
        return;
      }
      if (action === "ext-request-back") {
        retreatPhase();
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
        if (window.TanTrackerPrototype && window.TanTrackerPrototype.syncPublicHolderAccessTokenForOrder) {
          window.TanTrackerPrototype.syncPublicHolderAccessTokenForOrder(st.orderId);
        }
        if (window.TanTrackerPrototype && window.TanTrackerPrototype.writeUrl) window.TanTrackerPrototype.writeUrl();
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
        f = st.extRequestForm;
        var phase = st.extRequestPhase || "item";
        if (phase === "item") {
          var input = document.querySelector('[data-tt-field="extItem"]');
          f.item = (input && input.value) || "";
          if (!f.item.trim()) return;
          void ensureDraft(f)
            .then(function () {
              return window.TanTrackerExternal.saveDraft("photo", {
                item: f.item,
                dueMode: f.duePreset === "tomorrow" ? "tomorrow" : "today",
              });
            })
            .then(advancePhase);
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
            if (f.createdId && window.TanTrackerPrototype && window.TanTrackerPrototype.syncPublicHolderAccessTokenForOrder) {
              window.TanTrackerPrototype.syncPublicHolderAccessTokenForOrder(f.createdId);
            }
            st.extRequestPhase = "done";
            st.error = "";
            if (window.__ttLkRenderTracker) window.__ttLkRenderTracker();
          });
        }
      }
      if (action === "ext-request-open-order" && f && f.createdId) {
        st.orderId = f.createdId;
        st.view = "detail";
        st.extRequestPhase = null;
        if (window.TanTrackerPrototype && window.TanTrackerPrototype.syncPublicHolderAccessTokenForOrder) {
          window.TanTrackerPrototype.syncPublicHolderAccessTokenForOrder(st.orderId);
        }
        if (window.TanTrackerPrototype && window.TanTrackerPrototype.writeUrl) window.TanTrackerPrototype.writeUrl();
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
        return window.TanTrackerExternal.uploadPhoto(draftId, file).then(function () {
          st.extRequestForm.photoCount = (st.extRequestForm.photoCount || 0) + 1;
          if (window.__ttLkRenderTracker) window.__ttLkRenderTracker();
        });
      });
    }
  });

  window.TtExternalUi = {
    externalActionBarHtml: externalActionBarHtml,
    externalShellHomeHtml: externalShellHomeHtml,
    extRequestView: extRequestView,
    externalHolderDetailBlocks: externalHolderDetailBlocks,
  };
})();
