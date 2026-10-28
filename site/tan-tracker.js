(function () {
  "use strict";
  const ROUTE = "tan-tracker";
  const CODE_TTL_MS = 5 * 60 * 1000;
  const MAX_ATTEMPTS = 5;
  const E = (v) =>
    String(v ?? "").replace(/[&<>"']/g, (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c])
    );
  const employees = {
    m1: { id: "m1", name: "Алексей Морозов", phone: "79001234001" },
    m2: { id: "m2", name: "Дмитрий Петров", phone: "79001234002" },
    m3: { id: "m3", name: "Иван Орлов", phone: "79001234003" },
    a1: { id: "a1", name: "Анна Белова", phone: "79001234011" },
    c1: { id: "c1", name: "Наталья Савельева", phone: "79001234021" },
  };
  const fmtPhone = (digits) => {
    const d = String(digits).replace(/\D/g, "");
    if (d.length < 11) return "+7 (900) 000-00-XX · демо";
    return `+7 (${d.slice(1, 4)}) ${d.slice(4, 7)}-${d.slice(7, 9)}-${d.slice(9, 11)} · демо`;
  };
  const maskPhone = (digits) => {
    const d = String(digits).replace(/\D/g, "");
    if (d.length < 4) return "··· · демо";
    return `+7 ··· ···-··-${d.slice(-2)} · демо`;
  };
  const normPhone = (raw) => {
    let d = String(raw ?? "").replace(/\D/g, "");
    if (d.length === 10) d = "7" + d;
    if (d.startsWith("8") && d.length === 11) d = "7" + d.slice(1);
    return d.length === 11 && d.startsWith("7") ? d : "";
  };
  const dt = (ts) =>
    new Intl.DateTimeFormat("ru-RU", {
      timeZone: "Europe/Moscow",
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    }).format(ts);

  let contacts = [];
  let orders = [];
  let nextTrack = 21;

  function seedContacts() {
    contacts = [
      ...Object.values(employees).map((e) => ({
        id: "emp_" + e.id,
        kind: "employee",
        employeeId: e.id,
        name: e.name,
        phone: e.phone,
      })),
      { id: "ext_01", kind: "external", name: "Сергей Приёмка", phone: "79000000001" },
      { id: "ext_02", kind: "external", name: "Ольга Магазин", phone: "79000000002" },
      { id: "ext_03", kind: "external", name: "ИП Кузнецов", phone: "79000000003" },
      { id: "ext_04", kind: "external", name: "Курьер «Быстрый»", phone: "79000000004" },
      { id: "ext_05", kind: "external", name: "Марина Склад", phone: "79000000005" },
    ];
  }

  function contactById(id) {
    return contacts.find((c) => c.id === id);
  }
  function employeeContact(empId) {
    return contacts.find((c) => c.employeeId === empId);
  }

  function seedOrders() {
    const ago = (h) => Date.now() - h * 3600000;
    const ahead = (h) => Date.now() + h * 3600000;
    const tl = (from, to, note, at) => ({ at: at ?? ago(2), from, to, note });
    orders = [
      {
        id: "TT-2026-001",
        item: "Договор поставки №24/К",
        qty: "1 комплект",
        holderId: "emp_m1",
        pendingId: "ext_01",
        status: "waiting",
        dueAt: ahead(24),
        comment: "Передать на склад клиента",
        holderSince: ago(5),
        timeline: [tl("emp_m1", "ext_01", "Ожидает подтверждения получателем", ago(1))],
        code: null,
      },
      {
        id: "TT-2026-002",
        item: "Акт сверки за III кв.",
        qty: "2 экз.",
        holderId: "emp_m2",
        pendingId: null,
        status: "active",
        dueAt: ahead(48),
        comment: "",
        holderSince: ago(20),
        timeline: [tl("emp_m1", "emp_m2", "Передано менеджеру для визита", ago(30))],
        code: null,
      },
      {
        id: "TT-2026-003",
        item: "Образцы Линия 05 / 06",
        qty: "4 полотна",
        holderId: "ext_02",
        pendingId: "emp_a1",
        status: "waiting",
        dueAt: ago(6),
        comment: "Срочно на витрину",
        holderSince: ago(8),
        timeline: [
          tl("emp_m1", "ext_02", "Передано в магазин", ago(40)),
          tl("ext_02", "emp_a1", "Ассистент заберёт завтра", ago(8)),
        ],
        code: null,
      },
      {
        id: "TT-2026-004",
        item: "Ключи от шоурума",
        qty: "2 шт.",
        holderId: "emp_m1",
        pendingId: null,
        status: "active",
        dueAt: ahead(12),
        comment: "",
        holderSince: ago(1),
        timeline: [tl("ext_05", "emp_m1", "Возврат после осмотра", ago(3))],
        code: null,
      },
      {
        id: "TT-2026-005",
        item: "Коробка фурнитуры FX-12",
        qty: "1 короб",
        holderId: "ext_03",
        pendingId: null,
        status: "completed",
        dueAt: ago(48),
        comment: "Завершено на месте",
        holderSince: ago(50),
        timeline: [
          tl("emp_m2", "ext_03", "Передано подрядчику", ago(72)),
          tl("ext_03", "ext_03", "Передача завершена", ago(50)),
        ],
        code: null,
      },
      {
        id: "TT-2026-006",
        item: "Подписанный доп. соглашение",
        qty: "1 экз.",
        holderId: "emp_m2",
        pendingId: "ext_04",
        status: "waiting",
        dueAt: ago(2),
        comment: "Курьер ждёт код",
        holderSince: ago(4),
        timeline: [tl("emp_m2", "ext_04", "Передано курьеру", ago(4))],
        code: null,
      },
      {
        id: "TT-2026-007",
        item: "Комплект документов на возврат R-008",
        qty: "3 листа",
        holderId: "emp_a1",
        pendingId: null,
        status: "active",
        dueAt: ahead(8),
        comment: "",
        holderSince: ago(12),
        timeline: [tl("emp_m1", "emp_a1", "На замещении", ago(24))],
        code: null,
      },
      {
        id: "TT-2026-008",
        item: "Образец входной двери V-21",
        qty: "1 шт.",
        holderId: "ext_01",
        pendingId: null,
        status: "active",
        dueAt: ago(12),
        comment: "Просрочен срок у держателя",
        holderSince: ago(36),
        timeline: [tl("emp_m3", "ext_01", "Демонстрация на объекте", ago(48))],
        code: null,
      },
      {
        id: "TT-2026-009",
        item: "USB с макетами витрины",
        qty: "1 носитель",
        holderId: "emp_m1",
        pendingId: null,
        status: "completed",
        dueAt: ago(96),
        comment: "",
        holderSince: ago(100),
        timeline: [tl("emp_m1", "emp_c1", "Передано координатору", ago(120)), tl("emp_c1", "emp_m1", "Возврат после согласования", ago(100))],
        code: null,
      },
      {
        id: "TT-2026-010",
        item: "Пакет счетов-фактур",
        qty: "5 шт.",
        holderId: "emp_m3",
        pendingId: "ext_05",
        status: "waiting",
        dueAt: ahead(6),
        comment: "",
        holderSince: ago(2),
        timeline: [tl("emp_m3", "ext_05", "На склад Tandoor", ago(2))],
        code: null,
      },
      {
        id: "TT-2026-011",
        item: "Макет договора (черновик)",
        qty: "1 PDF + бумага",
        holderId: "ext_02",
        pendingId: null,
        status: "active",
        dueAt: ahead(72),
        comment: "Клиент правит текст",
        holderSince: ago(15),
        timeline: [tl("emp_m2", "ext_02", "На согласовании у ЛПР", ago(20))],
        code: null,
      },
      {
        id: "TT-2026-012",
        item: "Ключ от архивной ячейки",
        qty: "1 шт.",
        holderId: "emp_c1",
        pendingId: null,
        status: "active",
        dueAt: ahead(24),
        comment: "",
        holderSince: ago(6),
        timeline: [tl("emp_m1", "emp_c1", "Временно у координатора", ago(8))],
        code: null,
      },
      {
        id: "TT-2026-013",
        item: "Образцы портала «Классика»",
        qty: "2 комплекта",
        holderId: "emp_m2",
        pendingId: null,
        status: "completed",
        dueAt: ago(24),
        comment: "Установлены",
        holderSince: ago(30),
        timeline: [tl("emp_m2", "ext_02", "Передано на ТТ", ago(50)), tl("ext_02", "ext_02", "Завершено", ago(30))],
        code: null,
      },
      {
        id: "TT-2026-014",
        item: "Акт приёма-передачи оборудования",
        qty: "1 экз.",
        holderId: "ext_04",
        pendingId: "emp_m1",
        status: "waiting",
        dueAt: ahead(3),
        comment: "",
        holderSince: ago(1),
        timeline: [tl("ext_04", "emp_m1", "Обратная передача менеджеру", ago(1))],
        code: null,
      },
      {
        id: "TT-2026-015",
        item: "Коробка образцов наличия",
        qty: "12 образцов",
        holderId: "emp_a1",
        pendingId: null,
        status: "active",
        dueAt: ago(4),
        comment: "Просрочка демонстрационная",
        holderSince: ago(30),
        timeline: [tl("emp_m1", "emp_a1", "Для визитов на неделе", ago(40))],
        code: null,
      },
      {
        id: "TT-2026-016",
        item: "Оригинал доверенности",
        qty: "1 лист",
        holderId: "emp_m1",
        pendingId: null,
        status: "active",
        dueAt: ahead(36),
        comment: "",
        holderSince: ago(10),
        timeline: [tl("emp_m2", "emp_m1", "Передано для подписи", ago(12))],
        code: null,
      },
      {
        id: "TT-2026-017",
        item: "Комплект накладных отгрузки",
        qty: "8 листов",
        holderId: "ext_05",
        pendingId: null,
        status: "completed",
        dueAt: ago(120),
        comment: "",
        holderSince: ago(130),
        timeline: [tl("emp_m3", "ext_05", "Архив склада", ago(140))],
        code: null,
      },
      {
        id: "TT-2026-018",
        item: "Планшет для осмотра витрины",
        qty: "1 шт.",
        holderId: "emp_m3",
        pendingId: "ext_01",
        status: "waiting",
        dueAt: ahead(18),
        comment: "Вернуть после фото",
        holderSince: ago(3),
        timeline: [tl("emp_m3", "ext_01", "На объекте клиента", ago(3))],
        code: null,
      },
      {
        id: "TT-2026-019",
        item: "Согласованный прайс VIP",
        qty: "1 брошюра",
        holderId: "ext_03",
        pendingId: null,
        status: "active",
        dueAt: ahead(96),
        comment: "",
        holderSince: ago(50),
        timeline: [tl("emp_m2", "ext_03", "Для переговоров", ago(55))],
        code: null,
      },
      {
        id: "TT-2026-020",
        item: "Пакет закрывающих за сентябрь",
        qty: "4 документа",
        holderId: "emp_m2",
        pendingId: null,
        status: "active",
        dueAt: ago(1),
        comment: "Ждёт отправки в бухгалтерию",
        holderSince: ago(8),
        timeline: [tl("emp_m1", "emp_m2", "Собрано на замещении", ago(10))],
        code: null,
      },
    ];
    nextTrack = 21;
  }

  seedContacts();
  seedOrders();

  const TT_BODY = ["tt-active", "tt-recipient-shell", "tt-external-shell"];
  let ttShellMounted = false;
  let lastViewKey = "";

  const state = {
    view: "list",
    orderId: null,
    query: "",
    statusFilter: "all",
    employeeId: "m1",
    actingContactId: null,
    recipientMode: false,
    recipientVia: "code",
    recipientTicket: null,
    handoffTab: "code",
    form: null,
    codeInput: "",
    toast: "",
    error: "",
    phoneVerified: false,
    phoneVerifiedKey: "",
    contactSearch: "",
    newRecipient: false,
  };

  function syncInvitation(o) {
    if (!o.pendingId) {
      o.activeInvitation = null;
      return;
    }
    o.activeInvitation = {
      hv: o.handoffVer ?? 0,
      pendingId: o.pendingId,
      holderId: o.holderId,
      item: o.item,
      id: o.id,
    };
  }
  orders.forEach((o) => {
    if (o.handoffVer == null) o.handoffVer = o.pendingId ? 1 : 0;
    if (o.pendingId) syncInvitation(o);
  });

  function archiveInvitation(o) {
    if (!o.activeInvitation) return;
    o.pastInvitations = o.pastInvitations || [];
    o.pastInvitations.push({ ...o.activeInvitation });
  }

  function recipientKey(o) {
    return `${o.id}|${o.handoffVer ?? 0}|${o.pendingId || ""}`;
  }

  function resetPhoneIdentity() {
    state.phoneVerified = false;
    state.phoneVerifiedKey = "";
  }

  function identityVerified(o) {
    return state.phoneVerified && state.phoneVerifiedKey === recipientKey(o);
  }

  function isExternalShell() {
    if (state.recipientMode) return false;
    const c = state.actingContactId && contactById(state.actingContactId);
    return !!(c && c.kind === "external");
  }

  function handoffUrl(o, inv) {
    const t = inv || o.activeInvitation;
    if (!t) return `${location.pathname}#tan-tracker?role=${prototypeRole}`;
    const p = new URLSearchParams({ role: prototypeRole, tt_view: "recipient", tt_order: t.id, tt_hv: String(t.hv), tt_rcv: t.pendingId, tt_via: "qr" });
    return `${location.pathname}#tan-tracker?${p}`;
  }

  function qrSvg(text) {
    if (typeof qrcode !== "function") return "";
    const qr = qrcode(0, "M");
    qr.addData(text);
    qr.make();
    const n = qr.getModuleCount();
    const cell = Math.max(4, Math.ceil(252 / n));
    return qr.createSvgTag(cell, 4);
  }

  function resolveInvitation(o, urlHv) {
    const hv = Number(urlHv);
    if (o.activeInvitation && o.activeInvitation.hv === hv) return { inv: o.activeInvitation, stale: false };
    const past = (o.pastInvitations || []).find((x) => x.hv === hv);
    if (past) return { inv: past, stale: true };
    if (o.activeInvitation) return { inv: o.activeInvitation, stale: o.activeInvitation.hv !== hv };
    return { inv: null, stale: true };
  }

  function leaveRouteCleanup() {
    state.recipientMode = false;
    state.recipientVia = "code";
    state.recipientTicket = null;
    state.actingContactId = null;
    state.orderId = null;
    state.view = "list";
    resetPhoneIdentity();
    ttShellMounted = false;
    TT_BODY.forEach((c) => document.body.classList.remove(c));
    document.dispatchEvent(new Event("assistant:paint"));
  }

  function applyBodyClasses() {
    const on = current === ROUTE;
    if (!on) {
      TT_BODY.forEach((c) => document.body.classList.remove(c));
      return;
    }
    const ext = isExternalShell();
    document.body.classList.toggle("tt-active", !state.recipientMode && !ext);
    document.body.classList.toggle("tt-recipient-shell", state.recipientMode);
    document.body.classList.toggle("tt-external-shell", ext);
  }

  function captureFocus() {
    const el = document.activeElement;
    if (!el || !el.closest?.("#tt-root")) return null;
    if (el.matches('[data-tt="search"]')) return { type: "search", start: el.selectionStart, end: el.selectionEnd };
    if (el.dataset?.ttField) return { type: "field", field: el.dataset.ttField, start: el.selectionStart, end: el.selectionEnd };
    return null;
  }

  function restoreFocus(snap) {
    if (!snap) return;
    requestAnimationFrame(() => {
      const el =
        snap.type === "search"
          ? document.querySelector('[data-tt="search"]')
          : document.querySelector(`[data-tt-field="${snap.field}"]`);
      if (!el) return;
      el.focus();
      if (snap.start != null && el.setSelectionRange) el.setSelectionRange(snap.start, snap.end);
    });
  }

  function registryRowsHtml(rows) {
    return rows
      .map((o) => {
        const h = contactById(o.holderId);
        const p = o.pendingId ? contactById(o.pendingId) : null;
        return `<tr data-tt-open="${E(o.id)}"><td><strong>${E(o.id)}</strong></td><td>${E(o.item)}<small>${E(o.qty || "")}</small></td><td>${E(h?.name || "—")}</td><td>${p ? E(p.name) : "—"}</td><td>${statusBadge(o)}</td><td>${dueCell(o)}</td><td>${o.holderSince ? dt(o.holderSince) : "—"}</td></tr>`;
      })
      .join("");
  }

  function registryCardsHtml(rows) {
    return rows
      .map((o) => {
        const h = contactById(o.holderId);
        return `<article class="tt-card" data-tt-open="${E(o.id)}"><h3>${E(o.id)} · ${E(o.item)}</h3><p>Держатель: ${E(h?.name)}</p><p>${statusBadge(o)}</p></article>`;
      })
      .join("");
  }

  function patchRegistry() {
    const rows = visibleOrders();
    const tbody = document.querySelector("#tt-registry-body");
    const cards = document.querySelector('[data-tt="cards"]');
    const empty = document.querySelector('[data-tt="empty"]');
    const scroll = document.querySelector(".tt-table-scroll");
    if (!tbody) return false;
    if (rows.length) {
      tbody.innerHTML = registryRowsHtml(rows);
      if (cards) cards.innerHTML = registryCardsHtml(rows);
      empty?.remove();
      if (scroll && scroll.style.display === "none") scroll.style.display = "";
    } else {
      tbody.innerHTML = "";
      if (cards) cards.innerHTML = "";
      if (!empty) {
        document.getElementById("tt-content")?.insertAdjacentHTML(
          "beforeend",
          `<div class="tt-empty" data-tt="empty"><p>Нет передач по фильтрам.</p><button type="button" class="tt-link" data-tt="reset-filters">Сбросить фильтры</button></div>`
        );
      }
    }
    return true;
  }

  function patchContactPick() {
    const host = document.querySelector('[data-tt="contact-pick"]');
    if (!host || !state.form) return false;
    const f = state.form;
    const pick = contacts.filter((c) => {
      const q = f.pickQ || "";
      if (!q) return true;
      return (c.name + c.phone).toLowerCase().includes(q.toLowerCase());
    });
    host.innerHTML = pick
      .slice(0, 12)
      .map(
        (c) =>
          `<button type="button" data-tt-pick="${E(c.id)}" aria-pressed="${f.recipientId === c.id}">${E(c.name)}<br><small>${E(fmtPhone(c.phone))}</small></button>`
      )
      .join("");
    return true;
  }

  function paintQrHosts() {
    document.querySelectorAll('[data-tt="qr-host"]').forEach((host) => {
      const payload = host.getAttribute("data-payload");
      if (!payload) return;
      host.innerHTML = qrSvg(payload);
    });
  }

  function now() {
    return Date.now();
  }

  function orderStatus(o) {
    if (o.status === "completed") return "completed";
    if (o.pendingId) return "waiting";
    return "active";
  }
  function isOverdue(o) {
    return o.status !== "completed" && o.dueAt && o.dueAt < now();
  }
  function statusBadge(o) {
    const st = orderStatus(o);
    const overdue = isOverdue(o);
    const overdueChip = overdue ? `<span class="tt-badge bad tt-badge-overdue">Просрочено</span>` : "";
    if (st === "completed") return `<span class="tt-badge good">Завершена</span>`;
    if (st === "waiting") {
      return `<span class="tt-status-group"><span class="tt-badge blue">Ожидает код</span>${overdueChip}</span>`;
    }
    if (overdue) return `<span class="tt-badge bad">Просрочка</span>`;
    return `<span class="tt-badge warn">В работе</span>`;
  }

  function dueCell(o) {
    if (!o.dueAt) return "—";
    const label = dt(o.dueAt);
    return isOverdue(o) ? `<span class="tt-due-overdue">${E(label)}</span>` : E(label);
  }

  function invalidateCode(o) {
    o.code = null;
    resetPhoneIdentity();
  }

  function completeHandoff(o, via, ticket) {
    state.error = "";
    if (!o.pendingId) {
      state.error = "Ожидание уже подтверждено или отменено.";
      return false;
    }
    if (o.status === "completed") {
      state.error = "Передача завершена.";
      return false;
    }
    if (ticket) {
      const cur = o.activeInvitation;
      const ticketPending = ticket.pendingId ?? ticket.rcv;
      if (!cur || cur.hv !== ticket.hv || cur.pendingId !== ticketPending) {
        state.error = "Приглашение устарело: получатель или передача изменились.";
        return false;
      }
    }
    const from = o.holderId;
    const to = o.pendingId;
    o.holderId = to;
    o.pendingId = null;
    o.holderSince = now();
    o.status = "active";
    o.code = null;
    archiveInvitation(o);
    o.activeInvitation = null;
    resetPhoneIdentity();
    o.timeline.push({
      at: now(),
      from,
      to,
      note: via === "qr" ? "Подтверждено по QR" : "Подтверждено одноразовым кодом",
    });
    state.toast = "Держатель обновлён.";
    return true;
  }

  function generateCode(o) {
    if (o.status === "completed" || !o.pendingId) return null;
    const code = String(Math.floor(100000 + Math.random() * 900000));
    o.code = {
      code,
      expiresAt: now() + CODE_TTL_MS,
      attempts: 0,
      used: false,
      forContact: o.pendingId,
    };
    return o.code;
  }

  function codeValid(o) {
    const c = o.code;
    return c && !c.used && c.expiresAt > now() && c.attempts < MAX_ATTEMPTS;
  }

  function tryConfirmCode(o, input) {
    state.error = "";
    if (o._codeBusy) return false;
    if (!o.pendingId) {
      state.error = "Ожидание уже подтверждено или отменено.";
      return false;
    }
    o._codeBusy = true;
    if (o.status === "completed") {
      state.error = "Передача завершена — код больше не действует.";
      o._codeBusy = false;
      return false;
    }
    if (!o.pendingId) {
      state.error = "Нет ожидающего получателя.";
      o._codeBusy = false;
      return false;
    }
    const c = o.code;
    if (!c) {
      state.error = "Код не выпущен. Получатель должен сгенерировать код.";
      o._codeBusy = false;
      return false;
    }
    if (c.used) {
      state.error = "Код уже использован.";
      o._codeBusy = false;
      return false;
    }
    if (c.expiresAt <= now()) {
      state.error = "Срок кода истёк. Получатель должен выпустить новый код.";
      o._codeBusy = false;
      return false;
    }
    if (c.attempts >= MAX_ATTEMPTS) {
      state.error = "Превышено число попыток. Получатель должен выпустить новый код.";
      o._codeBusy = false;
      return false;
    }
    c.attempts += 1;
    if (String(input).replace(/\D/g, "") !== c.code) {
      state.error = "Неверный код. Текущий держатель не изменился.";
      o._codeBusy = false;
      return false;
    }
    c.used = true;
    const okHandoff = completeHandoff(o, "code");
    o._codeBusy = false;
    return okHandoff;
  }

  function tryConfirmQr(o, ticket) {
    if (!identityVerified(o)) {
      state.error = "Сначала подтвердите номер (демо).";
      return false;
    }
    if (ticket?.stale) {
      state.error = "Это приглашение больше не действует. Запросите новый QR у передающего.";
      return false;
    }
    return completeHandoff(o, "qr", ticket?.inv);
  }

  function cancelPending(o) {
    if (!o.pendingId) return;
    o.timeline.push({
      at: now(),
      from: o.holderId,
      to: o.pendingId,
      note: "Ожидание передачи отменено",
    });
    o.pendingId = null;
    archiveInvitation(o);
    o.activeInvitation = null;
    o.code = null;
    resetPhoneIdentity();
    o.status = "active";
    state.toast = "Ожидание отменено.";
  }

  function completeOrder(o) {
    if (o.status === "completed") return;
    if (o.pendingId) {
      state.error = "Сначала отмените ожидание или подтвердите передачу.";
      return;
    }
    const actor = state.actingContactId || employeeContact(state.employeeId)?.id;
    if (!actor || o.holderId !== actor) {
      state.error = "Завершить может только текущий держатель.";
      return;
    }
    o.status = "completed";
    o.timeline.push({
      at: now(),
      from: o.holderId,
      to: o.holderId,
      note: "Передача явно завершена",
    });
    invalidateCode(o);
    state.toast = "Передача завершена.";
  }

  function startPending(o, recipientId) {
    const holder = contactById(o.holderId);
    const selfEmp = employeeContact(state.employeeId);
    const actorId = state.actingContactId || selfEmp?.id;
    if (o.holderId !== actorId && !state.recipientMode) {
      state.error = "Передать может только текущий держатель.";
      return;
    }
    if (recipientId === o.holderId) {
      state.error = "Нельзя передать самому себе.";
      return;
    }
    if (o.status === "completed") {
      state.error = "Завершённую передачу нельзя продолжить.";
      return;
    }
    archiveInvitation(o);
    o.pendingId = recipientId;
    o.status = "waiting";
    o.handoffVer = (o.handoffVer ?? 0) + 1;
    o.code = null;
    resetPhoneIdentity();
    syncInvitation(o);
    o.timeline.push({
      at: now(),
      from: o.holderId,
      to: recipientId,
      note: "Назначен следующий получатель",
    });
    state.toast = "Получатель выбран. Прежний код и QR аннулированы.";
  }

  function addExternalContact(name, phoneRaw) {
    const phone = normPhone(phoneRaw);
    if (!phone) return { error: "Укажите демонстрационный телефон: 10 цифр после +7." };
    const dup = contacts.find((c) => c.phone === phone);
    if (dup) return { error: `Контакт с этим номером уже есть: ${dup.name}.`, existing: dup };
    const id = "ext_" + String(contacts.length + 1).padStart(2, "0");
    const c = { id, kind: "external", name: name.trim() || "Внешний получатель", phone };
    contacts.push(c);
    return { contact: c };
  }

  function visibleOrders() {
    const actor = state.actingContactId || employeeContact(state.employeeId)?.id;
    let list = orders.slice();
    if (state.actingContactId) {
      const seen = new Set();
      list = list.filter((o) => {
        const parts = [o.holderId, o.pendingId, ...o.timeline.flatMap((t) => [t.from, t.to])];
        return parts.includes(state.actingContactId);
      });
    }
    const q = state.query.trim().toLowerCase();
    list = list.filter((o) => {
      const h = contactById(o.holderId);
      const p = o.pendingId ? contactById(o.pendingId) : null;
      const hay = [o.id, o.item, h?.name, p?.name].join(" ").toLowerCase();
      if (q && !hay.includes(q)) return false;
      const st = orderStatus(o);
      if (state.statusFilter === "waiting" && st !== "waiting") return false;
      if (state.statusFilter === "active" && st !== "active") return false;
      if (state.statusFilter === "completed" && st !== "completed") return false;
      if (state.statusFilter === "overdue" && !isOverdue(o)) return false;
      return true;
    });
    return list;
  }

  function writeUrl() {
    const p = new URLSearchParams(location.hash.split("?")[1] || "");
    p.set("role", prototypeRole);
    if (state.recipientMode && state.orderId) {
      p.set("tt_view", "recipient");
      p.set("tt_order", state.orderId);
      const o = orders.find((x) => x.id === state.orderId);
      if (o?.activeInvitation) {
        p.set("tt_hv", String(o.activeInvitation.hv));
        p.set("tt_rcv", o.activeInvitation.pendingId);
      }
      if (state.recipientVia === "qr") p.set("tt_via", "qr");
      else p.delete("tt_via");
    } else {
      p.delete("tt_view");
      p.delete("tt_order");
      p.delete("tt_hv");
      p.delete("tt_rcv");
      p.delete("tt_via");
    }
    if (state.actingContactId) p.set("tt_act", state.actingContactId);
    else p.delete("tt_act");
    if (state.view !== "list") p.set("tt_screen", state.view);
    else p.delete("tt_screen");
    if (state.orderId && !state.recipientMode) p.set("tt_id", state.orderId);
    else if (!state.recipientMode) p.delete("tt_id");
    history.replaceState(null, "", `#${ROUTE}?${p}`);
  }

  function readUrl() {
    const p = new URLSearchParams(location.hash.split("?")[1] || "");
    state.recipientMode = p.get("tt_view") === "recipient";
    const oid = p.get("tt_order") || p.get("tt_id");
    if (oid) state.orderId = oid;
    state.actingContactId = p.get("tt_act") || null;
    state.recipientVia = p.get("tt_via") === "qr" ? "qr" : "code";
    if (state.recipientMode && oid) {
      state.recipientTicket = { hv: p.get("tt_hv"), rcv: p.get("tt_rcv"), order: oid };
      resetPhoneIdentity();
    } else state.recipientTicket = null;
    const scr = p.get("tt_screen");
    if (scr) state.view = scr;
    else if (oid && !state.recipientMode) state.view = "detail";
    if (state.recipientMode) state.view = "recipient";
  }

  function btn(label, attrs = "", cls = "tt-link") {
    const type = /type=/.test(attrs) ? "" : 'type="button"';
    return `<button ${type} class="${cls}" ${attrs}>${E(label)}</button>`;
  }

  function registryView() {
    const rows = visibleOrders();
    return `<div class="tt-toolbar">
      <label>Поиск<input data-tt="search" value="${E(state.query)}" placeholder="Трек, предмет, держатель"></label>
      <label>Статус<select data-tt="filter">
        <option value="all">Все</option>
        <option value="waiting" ${state.statusFilter === "waiting" ? "selected" : ""}>Ожидают код</option>
        <option value="active" ${state.statusFilter === "active" ? "selected" : ""}>В работе</option>
        <option value="overdue" ${state.statusFilter === "overdue" ? "selected" : ""}>Просрочка</option>
        <option value="completed" ${state.statusFilter === "completed" ? "selected" : ""}>Завершены</option>
      </select></label>
      ${btn("Сбросить фильтры", 'data-tt="reset-filters"', "tt-link")}
    </div>
    ${rows.length ? `<div class="tt-table-scroll" tabindex="0" aria-label="Реестр передач"><table class="tt-table" data-tt="registry"><thead><tr>
      <th>Трек</th><th>Предмет</th><th>Держатель</th><th>Ожидает</th><th>Статус</th><th>Срок</th><th>У держателя</th>
    </tr></thead><tbody id="tt-registry-body">${registryRowsHtml(rows)}</tbody></table></div>
    <div class="tt-cards" data-tt="cards">${rows
      .map((o) => {
        const h = contactById(o.holderId);
        return `<article class="tt-card" data-tt-open="${E(o.id)}"><h3>${E(o.id)} · ${E(o.item)}</h3><p>Держатель: ${E(h?.name)}</p><p>${statusBadge(o)}</p></article>`;
      })
      .join("")}</div>` : `<div class="tt-empty" data-tt="empty"><p>Нет передач по фильтрам.</p>${btn("Сбросить фильтры", 'data-tt="reset-filters"')}</div>`}`;
  }

  function createView() {
    const f = state.form || { item: "", recipientId: "", due: "", comment: "", newName: "", newPhone: "", mode: "list" };
    state.form = f;
    const pick = contacts.filter((c) => {
      const q = f.pickQ || "";
      if (!q) return true;
      return (c.name + c.phone).toLowerCase().includes(q.toLowerCase());
    });
    return `<div class="tt-panel"><h2>Создать передачу</h2>
    <form class="tt-form" data-tt="create-form">
      <label>Что передаём (обязательно)<input data-tt-field="item" value="${E(f.item)}" placeholder="Договор, образцы, ключи…"></label>
      <label>Комментарий<textarea data-tt-field="comment" placeholder="Необязательно">${E(f.comment)}</textarea></label>
      <label>Срок (необязательно)<input type="datetime-local" data-tt-field="due" value="${E(f.due)}"></label>
      <fieldset><legend>Получатель (обязательно)</legend>
        <label>Поиск<input data-tt-field="pickQ" value="${E(f.pickQ || "")}" placeholder="Имя или телефон"></label>
        <div class="tt-contact-pick" data-tt="contact-pick">${pick
          .slice(0, 12)
          .map(
            (c) =>
              `<button type="button" data-tt-pick="${E(c.id)}" aria-pressed="${f.recipientId === c.id}">${E(c.name)}<br><small>${E(fmtPhone(c.phone))}</small></button>`
          )
          .join("")}</div>
        ${btn("Новый получатель", 'data-tt="toggle-new"')}
        ${f.mode === "new" ? `<label>Имя<input data-tt-field="newName" value="${E(f.newName)}"></label><label>Телефон (демо)<input data-tt-field="newPhone" value="${E(f.newPhone)}" placeholder="+7 900 000 00 00"></label>` : ""}
      </fieldset>
      ${state.error ? `<p class="tt-error" data-tt="form-error">${E(state.error)}</p>` : ""}
      <div class="tt-actions">${btn("Сохранить передачу", 'data-tt="submit-create" type="submit"', "tt-primary")}${btn("Отмена", 'data-tt="back-list"')}</div>
    </form></div>`;
  }

  function pendingHandoffPanel(o) {
    if (!o.pendingId || !o.activeInvitation) return "";
    const tab = state.handoffTab || "code";
    const inv = o.activeInvitation;
    const payload = handoffUrl(o, inv);
    return `<div class="tt-handoff" data-tt="handoff-panel">
      <div class="tt-seg" role="tablist"><button type="button" data-tt="tab-code" aria-pressed="${tab === "code"}">По коду</button><button type="button" data-tt="tab-qr" aria-pressed="${tab === "qr"}">По QR</button></div>
      ${
        tab === "code"
          ? `<p class="tt-muted">Получатель подтверждает номер и сообщает одноразовый код.</p>
        ${btn("Открыть экран получателя", 'data-tt="open-recipient"')} ${btn("Ввести код", 'data-tt="enter-code"')}`
          : `<div class="tt-qr-wrap" data-tt="qr-host" data-payload="${E(payload)}"></div>
        <p class="tt-muted tt-qr-note">Демо: сканирование и подтверждение в одном окне. Работа между устройствами будет подключена в ЛК.</p>
        ${btn("Сканировать QR (демо)", 'data-tt="scan-qr-demo"')}`
      }
    </div>`;
  }

  function detailView(o) {
    const h = contactById(o.holderId);
    const p = o.pendingId ? contactById(o.pendingId) : null;
    const actor = state.actingContactId || employeeContact(state.employeeId)?.id;
    const isHolder = o.holderId === actor;
    const canComplete = isHolder && !o.pendingId && o.status !== "completed";
    const showActHolder = o.holderId && o.holderId !== actor;
    return `<div class="tt-panel" data-tt="detail">
      <div class="tt-actions">${btn(isExternalShell() ? "← К передаче" : "← К реестру", 'data-tt="back-list"')}</div>
      <h2>${E(o.id)} · ${E(o.item)}</h2>
      <p>${E(o.qty || "")}${o.comment ? " · " + E(o.comment) : ""}</p>
      <p><strong>Текущий держатель:</strong> ${E(h?.name)} ${h ? `<small>${E(fmtPhone(h.phone))}</small>` : ""}</p>
      <p><strong>Следующий:</strong> ${p ? E(p.name) : "не назначен"}</p>
      <p><strong>Срок:</strong> ${o.dueAt ? dt(o.dueAt) : "не указан"} · ${statusBadge(o)}</p>
      ${isHolder && o.pendingId ? pendingHandoffPanel(o) : ""}
      <div class="tt-timeline" data-tt="timeline">${o.timeline
        .slice()
        .reverse()
        .map((t) => {
          const fr = contactById(t.from);
          const to = contactById(t.to);
          return `<div><strong>${E(fr?.name || "?")} → ${E(to?.name || "?")}</strong><small>${dt(t.at)} · ${E(t.note)}</small></div>`;
        })
        .join("")}</div>
      <div class="tt-actions" style="margin-top:16px">
        ${isHolder && o.status !== "completed" ? btn("Передать", 'data-tt="transfer"') : ""}
        ${canComplete ? btn("Завершить передачу", 'data-tt="complete"') : ""}
        ${isHolder && o.pendingId ? btn("Отменить ожидание", 'data-tt="cancel-pending"') : ""}
        ${showActHolder ? btn("Смотреть как текущий держатель (демо)", 'data-tt="act-holder"') : ""}
        ${p && o.holderId !== p.id && !state.actingContactId ? btn("Действовать как получатель", 'data-tt="act-recipient"') : ""}
      </div>
      ${state.toast ? `<p class="tt-success" data-tt="toast">${E(state.toast)}</p>` : ""}
      ${state.error ? `<p class="tt-error">${E(state.error)}</p>` : ""}
    </div>`;
  }

  function transferView(o) {
    const f = state.form || { pickQ: "", recipientId: "", mode: "list", newName: "", newPhone: "" };
    state.form = f;
    const allowed = contacts.filter((c) => {
      if (c.id === o.holderId) return false;
      if (state.actingContactId) {
        const inOrder = [o.holderId, o.pendingId, ...o.timeline.flatMap((t) => [t.from, t.to])].includes(c.id);
        const addedByActor = c.addedBy === state.actingContactId;
        return inOrder || addedByActor || c.id === f.recipientId;
      }
      return true;
    });
    const pick = allowed.filter((c) => !f.pickQ || (c.name + c.phone).toLowerCase().includes(f.pickQ.toLowerCase()));
    return `<div class="tt-panel"><h2>Передать «${E(o.item)}»</h2>
      <label>Поиск<input data-tt-field="pickQ" value="${E(f.pickQ)}"></label>
      <div class="tt-contact-pick" data-tt="contact-pick">${pick
        .map(
          (c) =>
            `<button type="button" data-tt-pick="${E(c.id)}" aria-pressed="${f.recipientId === c.id}">${E(c.name)}<br><small>${E(fmtPhone(c.phone))}</small></button>`
        )
        .join("")}</div>
      ${btn("Новый получатель", 'data-tt="toggle-new"')}
      ${f.mode === "new" ? `<label>Имя<input data-tt-field="newName" value="${E(f.newName)}"><label>Телефон<input data-tt-field="newPhone" value="${E(f.newPhone)}"></label>` : ""}
      ${state.error ? `<p class="tt-error">${E(state.error)}</p>` : ""}
      <div class="tt-actions">${btn("Назначить получателя", 'data-tt="confirm-transfer"', "tt-primary")}${btn("Назад", 'data-tt="detail"')}</div></div>`;
  }

  function codeView(o) {
    return `<div class="tt-panel"><h2>Ввести код получателя</h2>
      <p>Предмет: ${E(o.item)} · ожидает ${E(contactById(o.pendingId)?.name || "")}</p>
      <label>6-значный код<input inputmode="numeric" maxlength="6" data-tt="code-input" value="${E(state.codeInput)}" autocomplete="one-time-code"></label>
      ${state.error ? `<p class="tt-error" data-tt="code-error">${E(state.error)}</p>` : ""}
      ${state.toast ? `<p class="tt-success">${E(state.toast)}</p>` : ""}
      <div class="tt-actions">${btn("Подтвердить", 'data-tt="confirm-code"', "tt-primary")}${btn("Назад", 'data-tt="detail"')}</div>
      <div class="tt-demo-controls">${btn("Истечь срок кода (демо)", 'data-tt="demo-expire"')}</div>
    </div>`;
  }

  function recipientScreen(o) {
    const ticketHv = state.recipientTicket?.hv;
    const resolved = ticketHv != null ? resolveInvitation(o, ticketHv) : { inv: o.activeInvitation, stale: false };
    const inv = resolved.inv || o.activeInvitation;
    const from = contactById(inv?.holderId || o.holderId);
    const to = contactById(inv?.pendingId || o.pendingId);
    const c = o.code;
    const verified = identityVerified(o);
    const qrMode = state.recipientVia === "qr";
    const stale = resolved.stale;
    return `<div class="tt-recipient" data-tt="recipient-screen">
      <p class="tt-demo">Демо-данные · изменения до обновления страницы</p>
      ${stale ? `<p class="tt-warning">Это приглашение устарело (версия ${E(String(inv?.hv ?? ticketHv))}). Актуальный получатель мог измениться.</p>` : ""}
      <h1>${E(inv?.item || o.item)}</h1>
      <p>Трек ${E(o.id)}</p>
      <p>От: <strong>${E(from?.name || "—")}</strong></p>
      <p>Кому: <strong>${E(to?.name || "—")}</strong></p>
      <p>Телефон: ${E(maskPhone(to?.phone || ""))}</p>
      <p class="tt-warning">Демонстрация: подтверждение телефона. СМС не отправляется.</p>
      ${!verified ? btn("Подтвердить номер (демо)", 'data-tt="demo-verify-phone"', "tt-primary") : `<p class="tt-success">Номер отмечен в демо (без реальной проверки).</p>`}
      ${!stale && qrMode && verified ? btn("Подтвердить получение", 'data-tt="confirm-qr-receive"', "tt-primary") : ""}
      ${!stale && !qrMode && verified && !c ? btn("Получить код", 'data-tt="gen-code"', "tt-primary") : ""}
      ${!stale && !qrMode && verified && c && codeValid(o) ? `<div class="tt-code" data-tt="shown-code">${E(c.code)}</div><p>Код действует 5 мин · до ${dt(c.expiresAt)}</p><p class="tt-warning">Сообщайте код только после получения предмета.</p>` : ""}
      ${!stale && !qrMode && verified && c && !codeValid(o) ? `<p class="tt-error">Код недоступен (истёк, использован или исчерпаны попытки).</p>${btn("Получить новый код", 'data-tt="gen-code"', "tt-primary")}` : ""}
      ${stale && qrMode ? `<p class="tt-error">Подтверждение по этому QR недоступно.</p>` : ""}
      <div class="tt-demo-controls">${!qrMode ? btn("Истечь срок кода (демо)", 'data-tt="demo-expire"') : ""}${btn("Вернуться к передаче", 'data-tt="exit-recipient"')}</div>
    </div>`;
  }

  function bodyHtml() {
    const o = state.orderId ? orders.find((x) => x.id === state.orderId) : null;
    if (state.view === "create") return createView();
    if (state.view === "transfer" && o) return transferView(o);
    if (state.view === "code" && o) return codeView(o);
    if (state.view === "detail" && o) return detailView(o);
    if (isExternalShell() && o) return detailView(o);
    if (isExternalShell()) return `<div class="tt-empty"><p>Нет доступных передач для этого участника.</p></div>`;
    return registryView();
  }

  function renderTracker(opts = {}) {
    if (current !== ROUTE) return;
    applyBodyClasses();
    const main = document.querySelector(".main");
    if (!main) return;

    const viewKey = `${state.view}|${state.orderId}|${state.recipientMode}|${state.handoffTab}`;
    if (viewKey !== lastViewKey && !opts.soft) {
      window.scrollTo(0, 0);
      lastViewKey = viewKey;
    }

    if (state.recipientMode) {
      ttShellMounted = false;
      const o = orders.find((x) => x.id === state.orderId);
      main.innerHTML = o
        ? `<div class="tt-work">${recipientScreen(o)}</div>`
        : `<div class="tt-work tt-recipient"><p class="tt-error">Передача не найдена в демо-памяти. Откройте ссылку из того же окна прототипа.</p></div>`;
      document.title = "Tandoor RF · Тан-трекер · получатель";
      lucide.createIcons();
      return;
    }

    const snap = opts.soft ? captureFocus() : null;
    if (opts.soft && state.view === "list" && patchRegistry()) {
      restoreFocus(snap);
      return;
    }
    if (opts.soft && (state.view === "create" || state.view === "transfer") && document.activeElement?.dataset?.ttField === "pickQ" && patchContactPick()) {
      restoreFocus(snap);
      return;
    }

    const ext = isExternalShell();
    const chrome =
      ext
        ? `<div class="tt-external-bar"><strong>${E(contactById(state.actingContactId)?.name || "Внешний участник")}</strong>${btn("Выйти из демо-профиля", 'data-tt="clear-act"')}</div>`
        : `<label>Текущий сотрудник (демо)<select data-tt="employee">${Object.entries(employees)
            .map(([id, e]) => `<option value="${id}" ${state.employeeId === id ? "selected" : ""}>${E(e.name)}</option>`)
            .join("")}</select></label>`;

    if (!ttShellMounted) {
      main.innerHTML = `<div class="tt-work" data-testid="tan-tracker" id="tt-root">
      <div class="tt-head"><div><h1>Тан-трекер</h1><p>Передача документов и предметов</p></div>
        <span data-tt="head-cta">${state.view === "list" && !ext ? btn("Создать передачу", 'data-tt="create" data-tt-main-cta', "tt-primary") : ""}</span>
      </div>
      <p class="tt-demo">Демо-данные · изменения до обновления страницы</p>
      <div data-tt="chrome">${chrome}</div>
      <div id="tt-content"></div></div>`;
      ttShellMounted = true;
    } else {
      const cta = document.querySelector('[data-tt="head-cta"]');
      if (cta) cta.innerHTML = state.view === "list" && !ext ? btn("Создать передачу", 'data-tt="create" data-tt-main-cta', "tt-primary") : "";
      const ch = document.querySelector('[data-tt="chrome"]');
      if (ch) ch.innerHTML = chrome;
    }

    const content = document.getElementById("tt-content");
    if (content) content.innerHTML = bodyHtml();
    paintQrHosts();
    document.title = "Tandoor RF · Тан-трекер";
    lucide.createIcons();
    restoreFocus(snap);
  }

  function submitCreate() {
    const f = state.form;
    state.error = "";
    if (!f.item.trim()) {
      state.error = "Укажите, что передаёте.";
      return;
    }
    let recipientId = f.recipientId;
    if (f.mode === "new") {
      const r = addExternalContact(f.newName, f.newPhone);
      if (r.error) {
        state.error = r.error;
        if (r.existing) f.recipientId = r.existing.id;
        return;
      }
      recipientId = r.contact.id;
      r.contact.addedBy = employeeContact(state.employeeId)?.id;
    }
    if (!recipientId) {
      state.error = "Выберите или добавьте получателя.";
      return;
    }
    const holder = employeeContact(state.employeeId);
    if (recipientId === holder?.id) {
      state.error = "Нельзя назначить себя получателем при создании.";
      return;
    }
    const id = `TT-2026-${String(nextTrack++).padStart(3, "0")}`;
    const dueAt = f.due ? new Date(f.due).getTime() : null;
    const order = {
      id,
      item: f.item.trim(),
      qty: "",
      holderId: holder.id,
      pendingId: recipientId,
      status: "waiting",
      dueAt,
      comment: f.comment.trim(),
      holderSince: now(),
      timeline: [{ at: now(), from: holder.id, to: recipientId, note: "Создана передача" }],
      code: null,
      handoffVer: 1,
      pastInvitations: [],
    };
    syncInvitation(order);
    orders.unshift(order);
    state.orderId = id;
    state.view = "detail";
    state.form = null;
    state.toast = "Передача создана. Держатель — создатель; получатель ожидает код.";
    writeUrl();
  }

  document.addEventListener("click", (e) => {
    const b = e.target.closest("[data-tt], [data-tt-open], [data-tt-pick]");
    if (!b || current !== ROUTE) return;
    const o = state.orderId ? orders.find((x) => x.id === state.orderId) : null;

    if (b.hasAttribute("data-tt-open")) {
      state.orderId = b.getAttribute("data-tt-open");
      state.view = "detail";
      state.error = state.toast = "";
      writeUrl();
      renderTracker();
      return;
    }
    if (b.hasAttribute("data-tt-pick")) {
      if (!state.form) state.form = {};
      state.form.recipientId = b.getAttribute("data-tt-pick");
      renderTracker();
      return;
    }
    const action = b.getAttribute("data-tt");
    if (action === "create") {
      state.view = "create";
      state.form = { item: "", recipientId: "", comment: "", due: "", mode: "list" };
      state.error = "";
      writeUrl();
      renderTracker();
      return;
    }
    if (action === "back-list") {
      state.view = "list";
      state.orderId = null;
      state.form = null;
      state.error = state.toast = "";
      writeUrl();
      renderTracker();
      return;
    }
    if (action === "detail" && o) {
      state.view = "detail";
      writeUrl();
      renderTracker();
      return;
    }
    if (action === "transfer" && o) {
      state.view = "transfer";
      state.form = { pickQ: "", mode: "list" };
      state.error = "";
      writeUrl();
      renderTracker();
      return;
    }
    if (action === "enter-code" && o) {
      state.view = "code";
      state.codeInput = "";
      state.error = "";
      writeUrl();
      renderTracker();
      return;
    }
    if (action === "toggle-new") {
      if (!state.form) state.form = {};
      state.form.mode = state.form.mode === "new" ? "list" : "new";
      renderTracker();
      return;
    }
    if (action === "confirm-transfer" && o && state.form) {
      let rid = state.form.recipientId;
      if (state.form.mode === "new") {
        const r = addExternalContact(state.form.newName, state.form.newPhone);
        if (r.error) {
          state.error = r.error;
          renderTracker();
          return;
        }
        rid = r.contact.id;
        r.contact.addedBy = state.actingContactId || employeeContact(state.employeeId)?.id;
      }
      if (!rid) {
        state.error = "Выберите получателя.";
        renderTracker();
        return;
      }
      startPending(o, rid);
      state.view = "detail";
      writeUrl();
      renderTracker();
      return;
    }
    if (action === "confirm-code" && o) {
      if (tryConfirmCode(o, state.codeInput)) {
        state.view = "detail";
        state.codeInput = "";
      }
      writeUrl();
      renderTracker();
      return;
    }
    if (action === "complete" && o) {
      if (confirm("Завершить передачу? Дальнейшие передачи по этому треку будут недоступны.")) completeOrder(o);
      writeUrl();
      renderTracker();
      return;
    }
    if (action === "cancel-pending" && o) {
      cancelPending(o);
      writeUrl();
      renderTracker();
      return;
    }
    if (action === "tab-code") {
      state.handoffTab = "code";
      renderTracker();
      return;
    }
    if (action === "tab-qr") {
      state.handoffTab = "qr";
      renderTracker();
      return;
    }
    if (action === "scan-qr-demo" && o) {
      state.recipientMode = true;
      state.recipientVia = "qr";
      resetPhoneIdentity();
      if (o.activeInvitation) {
        state.recipientTicket = {
          hv: String(o.activeInvitation.hv),
          rcv: o.activeInvitation.pendingId,
          order: o.id,
        };
      }
      writeUrl();
      renderTracker();
      return;
    }
    if (action === "open-recipient" && o) {
      state.recipientMode = true;
      state.recipientVia = state.handoffTab === "qr" ? "qr" : "code";
      resetPhoneIdentity();
      writeUrl();
      renderTracker();
      return;
    }
    if (action === "confirm-qr-receive" && o) {
      const ticket = resolveInvitation(o, state.recipientTicket?.hv ?? o.activeInvitation?.hv);
      if (tryConfirmQr(o, ticket)) {
        state.recipientMode = false;
        state.view = "detail";
      }
      writeUrl();
      renderTracker();
      return;
    }
    if (action === "exit-recipient") {
      state.recipientMode = false;
      state.view = "detail";
      writeUrl();
      renderTracker();
      return;
    }
    if (action === "act-recipient" && o && o.pendingId) {
      state.actingContactId = o.pendingId;
      state.recipientMode = false;
      state.view = "detail";
      writeUrl();
      renderTracker();
      return;
    }
    if (action === "act-holder" && o) {
      state.actingContactId = o.holderId;
      state.view = "detail";
      ttShellMounted = false;
      lastViewKey = "";
      writeUrl();
      renderTracker();
      return;
    }
    if (action === "clear-act") {
      state.actingContactId = null;
      ttShellMounted = false;
      lastViewKey = "";
      renderTracker();
      return;
    }
    if (action === "reset-filters") {
      state.query = "";
      state.statusFilter = "all";
      renderTracker();
      return;
    }
    if (action === "demo-expire" && o?.code) {
      o.code.expiresAt = now() - 1000;
      renderTracker();
      return;
    }
    if (action === "gen-code") {
      const order = o || orders.find((x) => x.id === state.orderId);
      if (!order) return;
      if (!identityVerified(order)) {
        state.error = "Сначала подтвердите номер (демо).";
      } else generateCode(order);
      renderTracker();
      return;
    }
    if (action === "demo-verify-phone") {
      const order = o || orders.find((x) => x.id === state.orderId);
      if (!order) return;
      const hv = state.recipientTicket?.hv;
      const resolved = hv != null ? resolveInvitation(order, hv) : null;
      const keyOrder =
        resolved?.inv && resolved.stale
          ? { id: order.id, handoffVer: resolved.inv.hv, pendingId: resolved.inv.pendingId }
          : order;
      state.phoneVerified = true;
      state.phoneVerifiedKey = recipientKey(keyOrder);
      renderTracker();
      return;
    }
  });

  document.addEventListener("submit", (e) => {
    if (current !== ROUTE) return;
    if (e.target.matches('[data-tt="create-form"]')) {
      e.preventDefault();
      submitCreate();
      renderTracker();
    }
  });

  document.addEventListener("input", (e) => {
    if (current !== ROUTE) return;
    if (e.target.matches("[data-tt-field]")) {
      if (!state.form) state.form = {};
      state.form[e.target.getAttribute("data-tt-field")] = e.target.value;
      if (e.target.getAttribute("data-tt-field") === "pickQ") renderTracker({ soft: true });
    }
    if (e.target.matches('[data-tt="search"]')) {
      state.query = e.target.value;
      renderTracker({ soft: true });
    }
    if (e.target.matches('[data-tt="code-input"]')) {
      state.codeInput = e.target.value;
    }
  });

  document.addEventListener("change", (e) => {
    if (current !== ROUTE) return;
    if (e.target.matches('[data-tt="filter"]')) {
      state.statusFilter = e.target.value;
      renderTracker();
    }
    if (e.target.matches('[data-tt="employee"]')) {
      state.employeeId = e.target.value;
      state.actingContactId = null;
      renderTracker();
    }
  });

  add("tan-tracker", "Тан-трекер", "Передача документов и предметов", "Менеджер", "tan-tracker", "", "");
  const priorNav = roleNav;
  roleNav = function (items) {
    const rows = priorNav(items);
    const at = rows.findIndex((r) => r[0] === "handover");
    const insert = ["tan-tracker", "Тан-трекер", "package-check", "tan-tracker"];
    if (at >= 0) rows.splice(at + 1, 0, insert);
    else rows.push(insert);
    return rows;
  };

  const priorRender = render;
  render = function () {
    const onRoute = current === ROUTE;
    if (!onRoute) {
      leaveRouteCleanup();
      priorRender();
      return;
    }
    readUrl();
    priorRender();
    const s = screens.find((x) => x.id === ROUTE);
    if (s) document.querySelector('.sidebar .nav button[data-go="tan-tracker"]')?.classList.add("active");
    renderTracker();
  };
  window.addEventListener("hashchange", () => {
    const route = location.hash.slice(1).split("?")[0] || "clients";
    if (route !== ROUTE) leaveRouteCleanup();
  });

  window.TanTrackerPrototype = {
    orders: () => orders,
    contacts: () => contacts,
    state,
    seed: () => {
      seedContacts();
      seedOrders();
    },
    routeActive: () => current === ROUTE,
  };

  const requestedRoute = location.hash.slice(1).split("?")[0];
  if (requestedRoute === ROUTE) {
    current = ROUTE;
    render();
  }
})();
