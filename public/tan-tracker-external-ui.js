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

  function photoHelpers() {
    return window.TtExtRequestPhotos || null;
  }

  function syncPhotoCount(f) {
    var h = photoHelpers();
    var photos = f.photos || [];
    f.photoCount = h ? h.countSuccessfulPhotos(photos) : photos.filter(function (p) {
      return p.status === "success";
    }).length;
    return f.photoCount;
  }

  function revokeExtPhotoUrls(f) {
    if (!f || !f.photos) return;
    f.photos.forEach(function (p) {
      if (p.previewUrl) {
        try {
          URL.revokeObjectURL(p.previewUrl);
        } catch (_e) {}
        p.previewUrl = "";
      }
    });
  }

  function bumpExtRequestFlow(st) {
    st.extRequestFlowId = (st.extRequestFlowId || 0) + 1;
    return st.extRequestFlowId;
  }

  function captureExtRequestToken(st, phase) {
    return {
      flowId: st.extRequestFlowId || 0,
      view: st.view,
      phase: phase,
      form: st.extRequestForm,
    };
  }

  function extRequestStillValid(st, token) {
    if (!st || !token) return false;
    if ((st.extRequestFlowId || 0) !== token.flowId) return false;
    if (st.view !== "ext-request" || token.view !== "ext-request") return false;
    if (st.extRequestPhase !== token.phase) return false;
    if (st.extRequestForm !== token.form) return false;
    return true;
  }

  function setExtRequestPhaseSaveInFlight(st, active) {
    st.extRequestPhaseSaveInFlight = !!active;
    if (window.__ttLkRenderTracker) window.__ttLkRenderTracker();
  }

  function saveWizardDraft(_st, f, step, payload) {
    var opts = f.draftId ? { draftId: f.draftId } : {};
    return window.TanTrackerExternal.saveDraft(step, payload, opts).then(function (res) {
      if (res.response.status !== 200) {
        throw new Error((res.data && res.data.error && res.data.error.message) || "Не удалось сохранить черновик.");
      }
      if (res.data && res.data.draftId && !f.draftId) f.draftId = res.data.draftId;
      return res;
    });
  }

  function advancePhaseIfToken(st, token) {
    if (!extRequestStillValid(st, token)) return;
    advancePhase();
  }

  function clearExtRequestPhaseSaveIfSameForm(st, token) {
    if (!st || !token) return;
    if ((st.extRequestFlowId || 0) !== token.flowId) return;
    if (st.extRequestForm !== token.form) return;
    setExtRequestPhaseSaveInFlight(st, false);
  }

  function resetExtRequestForm(st) {
    var prev = st.extRequestForm;
    if (prev) revokeExtPhotoUrls(prev);
    bumpExtRequestFlow(st);
    st.extRequestForm = {
      item: "",
      comment: "",
      recipientId: "",
      duePreset: "today",
      draftId: "",
      draftStartFresh: true,
      photoCount: 0,
      photos: [],
    };
    st.extRequestViewerUrl = "";
    st.extRequestViewerOpenLocalId = "";
    st.extRequestViewerReturnLocalId = "";
  }

  function extPhotoGridHtml(f, phase) {
    var photos = f.photos || [];
    var h = photoHelpers();
    var canAdd = h ? h.canAddMorePhotos(photos) : photos.filter(function (p) {
      return p.status === "success";
    }).length < 5;
    var tiles = photos
      .map(function (p) {
        var statusClass =
          p.status === "success"
            ? "tt-ext-photo--ok"
            : p.status === "error"
              ? "tt-ext-photo--err"
              : "tt-ext-photo--pending";
        var statusText =
          p.status === "uploading"
            ? "Загрузка…"
            : p.status === "error"
              ? p.errorMessage || "Ошибка"
              : "Загружено";
        var thumb =
          p.previewUrl && p.status !== "error"
            ? '<img src="' + E(p.previewUrl) + '" alt="" loading="lazy" />'
            : '<span class="tt-ext-photo-placeholder" aria-hidden="true"></span>';
        var retry =
          p.status === "error"
            ? btn("Повторить", "ext-photo-retry", "tt-ext-photo-retry") +
              ' <span class="tt-visually-hidden" data-tt-ext-retry-id="' +
              E(p.localId) +
              '"></span>'
            : "";
        return (
          '<li class="tt-ext-photo ' +
          statusClass +
          '" data-tt="ext-photo-tile" data-local-id="' +
          E(p.localId) +
          '">' +
          '<button type="button" class="tt-ext-photo-open" data-tt="ext-photo-open" data-local-id="' +
          E(p.localId) +
          '" aria-label="Открыть фото">' +
          thumb +
          "</button>" +
          '<p class="tt-ext-photo-status">' +
          E(statusText) +
          "</p>" +
          retry +
          "</li>"
        );
      })
      .join("");
    var addBtn =
      canAdd && phase === "photo"
        ? btn("Добавить фото", "ext-photo-add", "tt-ext-photo-add tt-btn-block") +
          '<input type="file" accept="image/*" class="tt-ext-photo-input-hidden" data-tt="ext-photo-input" />'
        : "";
    if (!tiles && !addBtn && phase !== "photo" && phase !== "summary") return "";
    return (
      '<div class="tt-ext-photo-wrap" data-tt="ext-photo-wrap">' +
      (phase === "photo"
        ? '<p class="tt-muted tt-att-hint">До 5 фото, каждое до 8 МБ. JPEG, PNG, GIF или WebP.</p>'
        : "") +
      '<ul class="tt-ext-photo-grid" data-tt="ext-photo-grid">' +
      tiles +
      "</ul>" +
      addBtn +
      "</div>"
    );
  }

  function extSummaryPhotosHtml(f) {
    syncPhotoCount(f);
    if (!f.photoCount) return "без фото";
    var photos = (f.photos || []).filter(function (p) {
      return p.status === "success" && p.previewUrl;
    });
    if (!photos.length) return f.photoCount + " шт.";
    return (
      '<span class="tt-ext-summary-photo-count">' +
      f.photoCount +
      " шт.</span>" +
      '<ul class="tt-ext-photo-grid tt-ext-photo-grid--summary">' +
      photos
        .map(function (p) {
          return (
            '<li class="tt-ext-photo tt-ext-photo--ok" data-tt="ext-photo-tile" data-local-id="' +
            E(p.localId) +
            '">' +
            '<button type="button" class="tt-ext-photo-open" data-tt="ext-photo-open" data-local-id="' +
            E(p.localId) +
            '" aria-label="Открыть фото">' +
            '<img src="' +
            E(p.previewUrl) +
            '" alt="" loading="lazy" />' +
            "</button></li>"
          );
        })
        .join("") +
      "</ul>"
    );
  }

  function extRequestAnswersHtml(f, phase) {
    var idx = PHASES.indexOf(phase);
    var rows = [];
    if (idx > 0 && f.item) rows.push(extRequestChatRow("Предмет", f.item));
    if (idx > 1) rows.push(extRequestChatRow("Фото", syncPhotoCount(f) ? f.photoCount + " шт." : "без фото"));
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
      photos: [],
    };
    if (!f.photos) f.photos = [];
    st.extRequestForm = f;
    syncPhotoCount(f);

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
      var hPhoto = photoHelpers();
      body =
        extRequestBotBubble("Пришлите фото предмета — так сотруднику проще его узнать. Можно пропустить.") +
        '<div class="tt-ext-chat-attach">' +
        extPhotoGridHtml(f, "photo") +
        "</div>";
      nextLabel = hPhoto ? hPhoto.photoStepNextLabel(f.photos) : f.photoCount ? "Далее" : "Пропустить";
    } else if (phase === "comment") {
      body =
        extRequestBotBubble("Добавите комментарий? Можно пропустить.") +
        '<label class="tt-wizard-field tt-ext-chat-field"><span class="tt-visually-hidden">Комментарий</span><input data-tt-field="extComment" value="' +
        E(f.comment) +
        '" placeholder="Комментарий (необязательно)"></label>';
      var hCmt = photoHelpers();
      nextLabel = hCmt ? hCmt.commentStepNextLabel(f.comment) : f.comment && f.comment.trim() ? "Далее" : "Пропустить";
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
        "<div><dt>Фото</dt><dd class=\"tt-ext-summary-photos-dd\">" +
        extSummaryPhotosHtml(f) +
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

    var hPending = photoHelpers();
    var uploadsPending = hPending ? hPending.hasPendingUploads(f.photos) : false;
    var saveInFlight = !!st.extRequestPhaseSaveInFlight;
    var nextDisabled =
      uploadsPending || saveInFlight ? ' disabled aria-disabled="true"' : "";
    var viewer =
      st.extRequestViewerUrl
        ? '<div class="tt-ext-photo-viewer" data-tt="ext-photo-viewer" role="dialog" aria-modal="true" aria-label="Просмотр фото">' +
          '<button type="button" class="tt-ext-photo-viewer-close" data-tt="ext-photo-viewer-close" aria-label="Закрыть">×</button>' +
          '<img src="' +
          E(st.extRequestViewerUrl) +
          '" alt="" class="tt-ext-photo-viewer-img" />' +
          "</div>"
        : "";

    return (
      extRequestFrame(
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
      ).replace(
        'data-tt="ext-request-next"',
        'data-tt="ext-request-next"' + nextDisabled,
      ) + viewer
    );
  }

  function findExtPhotoByLocalId(f, localId) {
    return (f.photos || []).find(function (p) {
      return p.localId === localId;
    });
  }

  function extRequestAfterRender() {
    var st = state();
    if (!st || st.view !== "ext-request") return;
    var phase = st.extRequestPhase;
    if (phase === "comment") {
      var cmt = document.querySelector('[data-tt-field="extComment"]');
      if (cmt && !cmt.dataset.ttExtBound) {
        cmt.dataset.ttExtBound = "1";
        cmt.addEventListener("input", function () {
          st.extRequestForm.comment = cmt.value;
          var next = document.querySelector('[data-tt="ext-request-next"]');
          if (!next) return;
          var h = photoHelpers();
          next.textContent = h ? h.commentStepNextLabel(cmt.value) : cmt.value.trim() ? "Далее" : "Пропустить";
        });
      }
    }
    if (st.extRequestViewerReturnLocalId && !st.extRequestViewerUrl) {
      var returnId = st.extRequestViewerReturnLocalId;
      st.extRequestViewerReturnLocalId = "";
      var thumbBtn = document.querySelector('[data-tt="ext-photo-open"][data-local-id="' + returnId + '"]');
      if (thumbBtn && typeof thumbBtn.focus === "function") thumbBtn.focus();
    }
    if (st.extRequestViewerUrl) {
      var viewerEl = document.querySelector('[data-tt="ext-photo-viewer"]');
      var closeCtl = viewerEl && viewerEl.querySelector('[data-tt="ext-photo-viewer-close"]');
      if (closeCtl && typeof closeCtl.focus === "function") closeCtl.focus();
      if (viewerEl && !viewerEl.dataset.ttExtTrap) {
        viewerEl.dataset.ttExtTrap = "1";
        viewerEl.addEventListener("keydown", function (ev) {
          if (ev.key !== "Tab") return;
          ev.preventDefault();
          if (closeCtl && typeof closeCtl.focus === "function") closeCtl.focus();
        });
      }
    }
  }

  function closeExtPhotoViewer(st) {
    if (!st) return;
    st.extRequestViewerReturnLocalId = st.extRequestViewerOpenLocalId || st.extRequestViewerReturnLocalId || "";
    st.extRequestViewerOpenLocalId = "";
    st.extRequestViewerUrl = "";
    if (window.__ttLkRenderTracker) window.__ttLkRenderTracker();
  }

  function photoPickDedupeKey(file) {
    return [file.name, file.size, file.lastModified].join(":");
  }

  function queueExtPhotoUpload(st, file, retryLocalId) {
    var f = st.extRequestForm;
    if (!f) return;
    if (!retryLocalId) {
      var pickKey = photoPickDedupeKey(file);
      var now = Date.now();
      if (
        st.extRequestLastPhotoPickKey === pickKey &&
        now - (st.extRequestLastPhotoPickAt || 0) < 800
      ) {
        return;
      }
      st.extRequestLastPhotoPickKey = pickKey;
      st.extRequestLastPhotoPickAt = now;
      f.photos = f.photos || [];
      var dupUpload = f.photos.some(function (p) {
        return p.status === "uploading" && p.file === file;
      });
      if (dupUpload) return;
    }
    var h = photoHelpers();
    if (!retryLocalId && h && h.hasPendingUploads(f.photos || [])) {
      return;
    }
    var v = h ? h.validatePhotoFile(file) : { ok: true };
    if (!v.ok) {
      st.error = v.message || "Некорректный файл.";
      if (window.__ttLkRenderTracker) window.__ttLkRenderTracker();
      return;
    }
    st.error = "";
    var flowId = st.extRequestFlowId || 0;
    var localId =
      retryLocalId ||
      "p-" + Date.now().toString(36) + "-" + Math.random().toString(36).slice(2, 8);
    var previewUrl = URL.createObjectURL(file);
    if (retryLocalId) {
      var existing = findExtPhotoByLocalId(f, retryLocalId);
      if (existing) {
        if (existing.previewUrl) {
          try {
            URL.revokeObjectURL(existing.previewUrl);
          } catch (_e) {}
        }
        existing.previewUrl = previewUrl;
        existing.status = "uploading";
        existing.errorMessage = "";
        existing.file = file;
      }
    } else {
      if (h && !h.canAddMorePhotos(f.photos || [])) {
        try {
          URL.revokeObjectURL(previewUrl);
        } catch (_e2) {}
        st.error = "Не более 5 фото.";
        if (window.__ttLkRenderTracker) window.__ttLkRenderTracker();
        return;
      }
      f.photos = f.photos || [];
      f.photos.push({
        localId: localId,
        previewUrl: previewUrl,
        status: "uploading",
        errorMessage: "",
        file: file,
        fileName: file.name || "photo.jpg",
      });
    }
    syncPhotoCount(f);
    if (window.__ttLkRenderTracker) window.__ttLkRenderTracker();

    var boundDraftId = f.draftId || "";
    void ensureDraft(st, f)
      .then(function (draftId) {
        if ((st.extRequestFlowId || 0) !== flowId) return null;
        if (st.view !== "ext-request") return null;
        if (boundDraftId && boundDraftId !== draftId) return null;
        return window.TanTrackerExternal.uploadPhoto(draftId, file).then(function () {
          return { ok: true, draftId: draftId };
        });
      })
      .then(function (result) {
        if (!result || !result.ok) return;
        if ((st.extRequestFlowId || 0) !== flowId) {
          try {
            URL.revokeObjectURL(previewUrl);
          } catch (_e3) {}
          return;
        }
        var entry = findExtPhotoByLocalId(st.extRequestForm, localId);
        if (!entry || entry.status !== "uploading") return;
        entry.status = "success";
        entry.errorMessage = "";
        syncPhotoCount(st.extRequestForm);
        if (window.__ttLkRenderTracker) window.__ttLkRenderTracker();
      })
      .catch(function (err) {
        if ((st.extRequestFlowId || 0) !== flowId) {
          try {
            URL.revokeObjectURL(previewUrl);
          } catch (_e4) {}
          return;
        }
        var entry = findExtPhotoByLocalId(st.extRequestForm, localId);
        if (!entry) return;
        entry.status = "error";
        entry.errorMessage = (err && err.message) || "Не удалось загрузить фото.";
        if (window.__ttLkRenderTracker) window.__ttLkRenderTracker();
      });
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

  function ensureDraft(st, f) {
    if (!st || !f) return Promise.reject(new Error("Черновик недоступен."));
    if (f.draftId) return Promise.resolve(f.draftId);
    if (f.draftEnsurePromise) return f.draftEnsurePromise;
    var flowId = st.extRequestFlowId || 0;
    var startFresh = f.draftStartFresh === true;

    function dispatchEnsureDraft() {
      if ((st.extRequestFlowId || 0) !== flowId) {
        return Promise.reject(new Error("Заявка отменена."));
      }
      if (f.draftId) return Promise.resolve(f.draftId);
      return window.TanTrackerExternal.saveDraft("item", {}, { startFresh: startFresh }).then(function (res) {
        if ((st.extRequestFlowId || 0) !== flowId) {
          throw new Error("Заявка отменена.");
        }
        if (res.response.status !== 200) {
          throw new Error((res.data && res.data.error && res.data.error.message) || "Черновик недоступен.");
        }
        f.draftId = res.data.draftId;
        f.draftStartFresh = false;
        return f.draftId;
      });
    }

    var chained = startFresh
      ? (st.extRequestStartFreshTail || Promise.resolve()).then(dispatchEnsureDraft)
      : dispatchEnsureDraft();
    f.draftEnsurePromise = chained.finally(function () {
      delete f.draftEnsurePromise;
    });
    if (startFresh) {
      st.extRequestStartFreshTail = f.draftEnsurePromise.catch(function () {});
    }
    return f.draftEnsurePromise;
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
      if (action === "ext-photo-add") {
        var addInput = document.querySelector('[data-tt="ext-photo-input"]');
        if (addInput) addInput.click();
        return;
      }
      if (action === "ext-photo-retry") {
        var tile = t.closest('[data-tt="ext-photo-tile"]');
        var lid = tile && tile.getAttribute("data-local-id");
        f = st.extRequestForm;
        if (!lid || !f) return;
        var ent = findExtPhotoByLocalId(f, lid);
        if (ent && ent.file) queueExtPhotoUpload(st, ent.file, lid);
        return;
      }
      if (action === "ext-photo-open") {
        var openId = t.getAttribute("data-local-id");
        f = st.extRequestForm;
        var shot = openId && f && findExtPhotoByLocalId(f, openId);
        if (shot && shot.previewUrl && shot.status === "success") {
          st.extRequestViewerOpenLocalId = openId;
          st.extRequestViewerUrl = shot.previewUrl;
          if (window.__ttLkRenderTracker) window.__ttLkRenderTracker();
        }
        return;
      }
      if (action === "ext-photo-viewer-close") {
        closeExtPhotoViewer(st);
        return;
      }
      if (action === "ext-request-open") {
        st.view = "list";
        resetExtRequestForm(st);
        st.error = "";
        if (externalOpenRequestCount(st.actingContactId) >= 5) {
          st.extRequestPhase = "blocked";
          st.view = "ext-request";
          if (window.__ttLkRenderTracker) window.__ttLkRenderTracker();
          return;
        }
        var openFlowId = st.extRequestFlowId;
        void (window.TanTrackerExternal && window.TanTrackerExternal.fetchIntakeRecipients
          ? window.TanTrackerExternal.fetchIntakeRecipients().then(function (rows) {
              if ((st.extRequestFlowId || 0) !== openFlowId) return;
              window.__TT_EXT_INTAKE_RECIPIENTS__ = rows;
            })
          : Promise.resolve()
        ).finally(function () {
          if ((st.extRequestFlowId || 0) !== openFlowId) return;
          st.extRequestPhase = "item";
          st.view = "ext-request";
          if (window.__ttLkRenderTracker) window.__ttLkRenderTracker();
        });
        return;
      }
      if (action === "ext-request-close") {
        revokeExtPhotoUrls(st.extRequestForm);
        bumpExtRequestFlow(st);
        st.view = "list";
        st.extRequestPhase = null;
        st.extRequestViewerUrl = "";
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
        if (t.hasAttribute("disabled") || t.getAttribute("aria-disabled") === "true") return;
        if (st.extRequestPhaseSaveInFlight) return;
        f = st.extRequestForm;
        var phase = st.extRequestPhase || "item";
        var hNext = photoHelpers();
        if (phase === "photo" && hNext && hNext.hasPendingUploads(f.photos || [])) return;
        if (phase === "summary" && hNext && hNext.hasPendingUploads(f.photos || [])) return;
        var token = captureExtRequestToken(st, phase);
        if (phase === "item") {
          var input = document.querySelector('[data-tt-field="extItem"]');
          f.item = (input && input.value) || "";
          if (!f.item.trim()) return;
          setExtRequestPhaseSaveInFlight(st, true);
          void ensureDraft(st, f)
            .then(function () {
              if (!extRequestStillValid(st, token)) return;
              return saveWizardDraft(st, f, "photo", {
                item: f.item,
                dueMode: f.duePreset === "tomorrow" ? "tomorrow" : "today",
              });
            })
            .then(function () {
              advancePhaseIfToken(st, token);
            })
            .catch(function (err) {
              if (!extRequestStillValid(st, token)) return;
              st.error = (err && err.message) || "Черновик недоступен.";
              if (window.__ttLkRenderTracker) window.__ttLkRenderTracker();
            })
            .finally(function () {
              clearExtRequestPhaseSaveIfSameForm(st, token);
            });
          return;
        }
        if (phase === "photo") {
          advancePhase();
          return;
        }
        if (phase === "comment") {
          var cmt = document.querySelector('[data-tt-field="extComment"]');
          f.comment = (cmt && cmt.value) || "";
          setExtRequestPhaseSaveInFlight(st, true);
          void saveWizardDraft(st, f, "recipient", {
            item: f.item,
            comment: f.comment,
            dueMode: f.duePreset === "tomorrow" ? "tomorrow" : "today",
          })
            .then(function () {
              advancePhaseIfToken(st, token);
            })
            .catch(function (err) {
              if (!extRequestStillValid(st, token)) return;
              st.error = (err && err.message) || "Не удалось сохранить черновик.";
              if (window.__ttLkRenderTracker) window.__ttLkRenderTracker();
            })
            .finally(function () {
              clearExtRequestPhaseSaveIfSameForm(st, token);
            });
          return;
        }
        if (phase === "recipient") {
          if (!f.recipientUserId) return;
          setExtRequestPhaseSaveInFlight(st, true);
          void saveWizardDraft(st, f, "due", {
            item: f.item,
            comment: f.comment,
            recipientUserId: f.recipientUserId,
            dueMode: f.duePreset === "tomorrow" ? "tomorrow" : "today",
          })
            .then(function () {
              advancePhaseIfToken(st, token);
            })
            .catch(function (err) {
              if (!extRequestStillValid(st, token)) return;
              st.error = (err && err.message) || "Не удалось сохранить черновик.";
              if (window.__ttLkRenderTracker) window.__ttLkRenderTracker();
            })
            .finally(function () {
              clearExtRequestPhaseSaveIfSameForm(st, token);
            });
          return;
        }
        if (phase === "due") {
          setExtRequestPhaseSaveInFlight(st, true);
          void saveWizardDraft(st, f, "summary", {
            item: f.item,
            comment: f.comment,
            recipientUserId: f.recipientUserId,
            dueMode: f.duePreset === "tomorrow" ? "tomorrow" : "today",
          })
            .then(function () {
              advancePhaseIfToken(st, token);
            })
            .catch(function (err) {
              if (!extRequestStillValid(st, token)) return;
              st.error = (err && err.message) || "Не удалось сохранить черновик.";
              if (window.__ttLkRenderTracker) window.__ttLkRenderTracker();
            })
            .finally(function () {
              clearExtRequestPhaseSaveIfSameForm(st, token);
            });
          return;
        }
        if (phase === "summary") {
          if (!f.draftId) return;
          var confirmDraftId = f.draftId;
          setExtRequestPhaseSaveInFlight(st, true);
          void window.TanTrackerExternal.confirmDraft(confirmDraftId)
            .then(function (res) {
              if (!extRequestStillValid(st, token)) return;
              if (res.response.status !== 200) {
                throw new Error((res.data && res.data.error && res.data.error.message) || "Не удалось создать заявку.");
              }
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
            })
            .catch(function (err) {
              if (!extRequestStillValid(st, token)) return;
              st.error = (err && err.message) || "Не удалось создать заявку.";
              if (window.__ttLkRenderTracker) window.__ttLkRenderTracker();
            })
            .finally(function () {
              clearExtRequestPhaseSaveIfSameForm(st, token);
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
      e.target.value = "";
      if (!file) return;
      if (st.extRequestPhotoPickBusy) return;
      st.extRequestPhotoPickBusy = true;
      try {
        queueExtPhotoUpload(st, file, null);
      } finally {
        st.extRequestPhotoPickBusy = false;
      }
    }
  });

  document.addEventListener("keydown", function (e) {
    if (!window.__TT_EXTERNAL_PERSON__) return;
    if (e.key !== "Escape") return;
    var st = state();
    if (!st || !st.extRequestViewerUrl) return;
    closeExtPhotoViewer(st);
  });

  (function wrapExtRenderHook() {
    var prev = window.__ttLkRenderTracker;
    window.__ttLkRenderTracker = function () {
      if (typeof prev === "function") prev();
      extRequestAfterRender();
    };
  })();

  window.TtExternalUi = {
    externalActionBarHtml: externalActionBarHtml,
    externalShellHomeHtml: externalShellHomeHtml,
    extRequestView: extRequestView,
    externalHolderDetailBlocks: externalHolderDetailBlocks,
  };
})();
