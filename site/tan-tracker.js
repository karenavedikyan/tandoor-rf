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
    ad1: { id: "ad1", name: "Администратор · демо", phone: "79001234999", team: null },
    d1: { id: "d1", name: "Андрей Власов", phone: "79001234090", team: null },
    r1: { id: "r1", name: "Елена Волкова", phone: "79001234040", team: "volkova" },
    r2: { id: "r2", name: "Дмитрий Орлов", phone: "79001234041", team: "orlov" },
    m1: { id: "m1", name: "Алексей Морозов", phone: "79001234001", team: "volkova" },
    m2: { id: "m2", name: "Дмитрий Петров", phone: "79001234002", team: "orlov" },
    m3: { id: "m3", name: "Иван Орлов", phone: "79001234003", team: "orlov" },
    a1: { id: "a1", name: "Анна Белова", phone: "79001234011", team: "volkova" },
    c1: { id: "c1", name: "Наталья Савельева", phone: "79001234021", team: "volkova" },
    cr1: { id: "cr1", name: "Курьер «Быстрый»", phone: "79001234055", team: "volkova", acceptsExternalRequests: true },
    rcv1: { id: "rcv1", name: "Офис Тандор · приёмка", phone: "79001234056", team: "volkova", acceptsExternalRequests: true },
  };
  const Sc = () => window.TanTrackerScope;
  const fmtPhone = (digits) => {
    const d = String(digits).replace(/\D/g, "");
    if (d.length < 11) return "+7 (900) 000-00-XX · демо";
    return `+7 (${d.slice(1, 4)}) ${d.slice(4, 7)}-${d.slice(7, 9)}-${d.slice(9, 11)} · демо`;
  };
  const fmtPhoneCore = (digits) => {
    const d = String(digits).replace(/\D/g, "");
    if (d.length < 11) return "+7 (900) 000-00-XX";
    return `+7 (${d.slice(1, 4)}) ${d.slice(4, 7)}-${d.slice(7, 9)}-${d.slice(9, 11)}`;
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
  function orderIsCompleted(o) {
    return o?.status === "completed";
  }
  function orderIsDelivered(o) {
    return o?.status === "delivered";
  }
  function orderTrackOpen(o) {
    return o?.status !== "completed";
  }
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
  // Demo-only registry metadata, separate from custody, files and order timelines.
  const registryArchive = new Map();
  const registryArchiveAudit = new Map();
  const deletedTrackIds = new Set();

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

  function scopeCtx() {
    const actor = state.actingContactId || employeeContact(state.employeeId)?.id;
    const role = state.ttRoleUnsupported ? null : state.ttPrototypeRole || "manager";
    return {
      prototypeRole: role,
      employeeId: state.employeeId,
      actorContactId: actor,
      contacts,
      employees,
      externalActing: isExternalShell(),
    };
  }

  let lastPrototypeRoleSynced = null;

  function syncEmployeeFromRole(forcedPersonId) {
    if (state.ttRoleUnsupported) return;
    const map = Sc()?.ROLE_EMPLOYEE || { manager: "m1", director: "d1", rop: "r1", assistant: "a1", coordinator: "c1" };
    const role = state.ttPrototypeRole || "manager";
    const next = map[role] || "m1";
    if (forcedPersonId && employees[forcedPersonId]) {
      state.employeeId = forcedPersonId;
      lastPrototypeRoleSynced = role;
      return;
    }
    if (lastPrototypeRoleSynced !== role) {
      state.employeeId = next;
      const extAct = state.actingContactId && contactById(state.actingContactId)?.kind === "external";
      if (!extAct) state.actingContactId = null;
      bumpAttachOpGen();
      lastPrototypeRoleSynced = role;
    }
  }

  function orderVisible(o) {
    if (!o) return false;
    if (!Sc()) return true;
    return Sc().canViewOrder(o, scopeCtx());
  }

  function deniedView() {
    return `<div class="tt-panel tt-denied" data-tt="access-denied"><h2>Нет доступа к этой передаче</h2><p>По правам прототипа эта передача недоступна. Содержимое и файлы не показываются.</p>${btn("← К реестру", 'data-tt="back-list"')}</div>`;
  }

  function unsupportedRoleView() {
    const label = state.ttRequestedRole ? `«${state.ttRequestedRole}»` : "не указана";
    return `<div class="tt-panel tt-denied" data-tt="unsupported-role"><h2>Роль не поддерживается в Тан-трекере</h2><p>Запрошена роль ${E(label)}. Здесь доступны демо-роли: менеджер, РОП, директор, ассистент, координатор, администратор.</p><p class="tt-muted">Область не расширяется до директора и не подменяется другой ролью автоматически.</p>${btn("← К реестру", 'data-tt="back-list"')}</div>`;
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
        createdById: "emp_m1",
        finalRecipientId: "ext_01",
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
        finalRecipientId: "emp_m2",
        createdById: "emp_m1",
        allowLegacyComplete: true,
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
          tl("emp_m1", "emp_m2", "Координировал отгрузку (без передачи)", ago(74)),
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
        createdById: "emp_m3",
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
        finalRecipientId: "ext_02",
        createdById: "emp_m3",
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
      {
        id: "TT-2026-021",
        item: "Образцы для клиента «Север»",
        qty: "1 пакет",
        holderId: "ext_04",
        pendingId: null,
        finalRecipientId: "ext_01",
        createdById: "emp_m1",
        status: "active",
        dueAt: ahead(8),
        comment: "Курьер везёт в магазин клиента",
        holderSince: ago(2),
        timeline: [
          tl("emp_m1", "ext_04", "Создана передача · сначала курьеру", ago(3)),
          tl("ext_04", "ext_04", "Курьер принял в демо", ago(2)),
        ],
        code: null,
      },
    ];
    nextTrack = 22;
    orders.forEach((o) => {
      Sc()?.migrateOrderFields(o);
      if (
        o.status === "completed" &&
        (o.timeline || []).some((t) => t.note === "Доставлено конечному получателю") &&
        !(o.timeline || []).some((t) => t.note === "Передача завершена" || t.note === "Передача явно завершена")
      ) {
        o.status = "delivered";
      }
    });
  }

  seedContacts();
  seedOrders();
  if (window.TanTrackerAttachments) TanTrackerAttachments.seedDemoAttachments(orders, contactById);
  else orders.forEach((o) => {
    if (!o.attachments) o.attachments = [];
  });

  const TT_BODY = ["tt-active", "tt-recipient-shell", "tt-external-shell"];
  let ttShellMounted = false;
  let detailDockObserver = null;
  let lastViewKey = "";

  function trackerShellLive(main) {
    return !!(main && main.querySelector("#tt-root") && main.querySelector("#tt-content"));
  }

  function syncTrackerShellMountFlag(main) {
    if (!trackerShellLive(main)) ttShellMounted = false;
  }

  const state = {
    view: "list",
    orderId: null,
    query: "",
    statusFilter: "all",
    mineFilter: "all",
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
    recipientChannel: null,
    messengerVerified: false,
    messengerVerifiedKey: "",
    messengerError: "",
    contactSearch: "",
    newRecipient: false,
    completeConfirmOrderId: null,
    createPhase: "item",
    createReturnPhase: null,
    attachStaging: [],
    attachOrderStaging: [],
    attachError: "",
    attachBusy: false,
    attachOpGen: 0,
    attachBusyGen: null,
    lightboxReturn: null,
    ttPrototypeRole: "manager",
    ttRoleUnsupported: false,
    ttRequestedRole: "",
    handoffReceipt: null,
    recipientReceivedPreview: null,
    recipientWelcomeAck: false,
    codeDemoRevealed: false,
    detailAttDisclosureOpen: null,
    registryFilterSheet: false,
    registryPersonalView: "main",
    registryConfirmRemoveOrderId: null,
    registrySelection: [],
    registrySelectionKey: null,
    registryVisibleIds: [],
    editOrderId: null,
    extRequestPhase: null,
    extRequestForm: null,
    extDeclineConfirmOrderId: null,
    archiveDialog: null,
    archiveSelection: [],
    archiveScope: "selected",
    archiveReason: "",
    archiveAllAck: false,
    archiveReturnFocus: null,
    archiveError: "",
    archiveTypedAck: "",
  };

  const Att = () => window.TanTrackerAttachments;
  const Ms = () => window.TanTrackerMessengerDemo;
  const RegPersonal = () => window.TtRegistryPersonal;

  function detailActorKey() {
    return state.actingContactId || employeeContact(state.employeeId)?.id || state.employeeId || "";
  }

  function clearDetailAttDisclosure() {
    state.detailAttDisclosureOpen = null;
  }

  function isDetailAttDisclosureOpen(o) {
    const key = state.detailAttDisclosureOpen;
    if (!key || !o) return false;
    return key.orderId === o.id && key.actorId === detailActorKey();
  }

  function syncDetailAttDisclosureFromDom(o) {
    if (!o || state.view !== "detail" || state.orderId !== o.id) return;
    const el = document.querySelector('[data-tt="detail-attachments-disclosure"]');
    if (!el) return;
    if (el.open) state.detailAttDisclosureOpen = { orderId: o.id, actorId: detailActorKey() };
    else if (isDetailAttDisclosureOpen(o)) clearDetailAttDisclosure();
  }

  function bumpAttachOpGen() {
    state.attachOpGen += 1;
  }

  function captureAttachSnap(target) {
    return {
      gen: state.attachOpGen,
      target,
      orderId: state.orderId,
      view: state.view,
      createPhase: state.createPhase,
      employeeId: state.employeeId,
      actingContactId: state.actingContactId,
    };
  }

  function attachSnapValid(snap) {
    if (!snap || snap.gen !== state.attachOpGen) return false;
    if (snap.target === "create") {
      return state.view === "create" || (state.view === "ext-request" && state.extRequestPhase === "photo");
    }
    return state.view === "detail" && snap.orderId === state.orderId;
  }

  function finishAttachIngest(opGen) {
    if (state.attachBusyGen === opGen) {
      state.attachBusy = false;
      state.attachBusyGen = null;
    }
  }

  function invalidateAttachContext() {
    bumpAttachOpGen();
    if (Att()) {
      Att().revokeStaging(state.attachStaging);
      Att().revokeStaging(state.attachOrderStaging);
    }
    state.attachStaging = [];
    state.attachOrderStaging = [];
    state.attachError = "";
    state.attachBusy = false;
    state.attachBusyGen = null;
  }

  function clearAttachStaging() {
    invalidateAttachContext();
  }

  function clearCompleteConfirm() {
    state.completeConfirmOrderId = null;
  }

  function syncInvitation(o) {
    if (!o.pendingId) {
      o.activeInvitation = null;
      return;
    }
    const hv = o.handoffVer ?? 0;
    const prev = o.activeInvitation;
    const samePending = prev && prev.pendingId === o.pendingId && prev.hv === hv;
    let startTokenPlain = samePending && prev.startTokenPlain ? prev.startTokenPlain : null;
    if (!startTokenPlain && Ms()?.mintStartToken) startTokenPlain = Ms().mintStartToken();
    o.activeInvitation = {
      hv,
      pendingId: o.pendingId,
      holderId: o.holderId,
      item: o.item,
      id: o.id,
      startTokenPlain,
      startTokenIssuedAt: samePending && prev.startTokenIssuedAt ? prev.startTokenIssuedAt : now(),
      codeIssueCount: samePending && prev.codeIssueCount != null ? prev.codeIssueCount : 0,
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

  function resetMessengerSession() {
    state.recipientChannel = null;
    state.messengerVerified = false;
    state.messengerVerifiedKey = "";
    state.messengerError = "";
  }

  function resetRecipientIdentity() {
    resetPhoneIdentity();
    resetMessengerSession();
  }

  function resetRecipientWelcome() {
    state.recipientWelcomeAck = false;
  }

  function recipientBrandHeader() {
    return `<header class="tt-recipient-brand" data-tt="recipient-brand">
      <img class="tt-recipient-logo tt-recipient-logo-light" src="./assets/logo.png" alt="" width="128" height="36" decoding="async">
      <img class="tt-recipient-logo tt-recipient-logo-dark" src="./assets/logo-light.png" alt="" width="128" height="36" decoding="async">
      <span class="tt-recipient-brand-name">Тандор</span>
    </header>`;
  }

  function invitationMessagePlain(o, inv, url) {
    const from = contactById(inv?.holderId || o.holderId);
    const item = inv?.item || o.item;
    const abs = url ? new URL(url, location.href).href : "";
    return [
      "Вам передают предмет",
      "",
      `Отправитель: ${from?.name || "—"}`,
      `Предмет: ${item || "—"}`,
      "",
      "Здесь можно посмотреть детали и подтвердить получение. Регистрация не нужна.",
      "",
      `Посмотреть передачу: ${abs}`,
    ].join("\n");
  }

  function recipientWelcomeAboutDisclosure() {
    return `<details class="tt-disclosure tt-recipient-welcome-about" data-tt="recipient-welcome-about">
      ${disclosureSummary("Что это за ссылка?", { icon: "help-circle" })}
      <div class="tt-disclosure-body tt-recipient-welcome-about-body">
        <p>Тандор помогает отследить передачу документа или предмета между людьми. Личный кабинет получателю не нужен.</p>
        <p>Ссылка персональная — рассчитана на получателя. Подтверждение своего номера в боте помогает показать ваши передачи и выдать код получения.</p>
        <p>Код получения сообщайте отправителю только после того, как предмет реально у вас.</p>
      </div>
    </details>`;
  }

  function recipientInvitationBlocked(o, resolved) {
    const inv = resolved?.inv;
    const token = state.recipientTicket?.st || "";
    if (resolved?.stale) return { blocked: true, kind: "stale" };
    if (!inv) return { blocked: true, kind: "missing" };
    if (inv.startTokenPlain) {
      if (!token || !Ms()?.tokenMatches?.(inv, token)) return { blocked: true, kind: "token" };
      if (!invitationTokenValid(o, inv, token)) return { blocked: true, kind: "expired" };
    }
    return { blocked: false, kind: "" };
  }

  function recipientWelcomeScreen(o, ctx) {
    const { inv, from, item, blocked } = ctx;
    const kicker = o?.id ? `<p class="tt-recipient-kicker">${E(o.id)}</p>` : "";
    if (blocked.blocked) {
      const copy =
        blocked.kind === "stale"
          ? "Это приглашение устарело — отправитель мог изменить получателя или параметры передачи. Попросите прислать новую ссылку."
          : blocked.kind === "expired"
            ? "Срок действия ссылки истёк. Попросите отправителя прислать новое приглашение."
            : "Ссылка приглашения недействительна. Попросите отправителя прислать новую ссылку.";
      return `<div class="tt-recipient-wrap"><article class="tt-recipient-card tt-recipient-card--welcome" data-tt="recipient-welcome-invalid">
        ${recipientBrandHeader()}
        ${kicker}
        <h1 class="tt-recipient-welcome-heading">Приглашение недоступно</h1>
        <p class="tt-recipient-welcome-lead">${E(copy)}</p>
        ${recipientWelcomeAboutDisclosure()}
      </article></div>`;
    }
    return `<div class="tt-recipient-wrap"><article class="tt-recipient-card tt-recipient-card--welcome" data-tt="recipient-welcome">
      ${recipientBrandHeader()}
      ${kicker}
      <h1 class="tt-recipient-welcome-heading">Вам передают предмет</h1>
      <dl class="tt-recipient-welcome-facts">
        <div><dt>Отправитель</dt><dd>${E(from?.name || "—")}</dd></div>
        <div><dt>Предмет</dt><dd>${E(item || "—")}</dd></div>
      </dl>
      <p class="tt-recipient-welcome-lead">Здесь можно посмотреть детали и подтвердить получение. Регистрация не нужна.</p>
      ${btn("Посмотреть передачу", 'data-tt="recipient-welcome-continue"', "tt-primary tt-btn-block tt-recipient-welcome-cta")}
      ${recipientWelcomeAboutDisclosure()}
    </article></div>`;
  }

  function identityVerified(o) {
    if (state.messengerVerified && state.messengerVerifiedKey === recipientKey(o) && state.recipientChannel) {
      return true;
    }
    return state.phoneVerified && state.phoneVerifiedKey === recipientKey(o);
  }

  function pendingIsExternal(o) {
    const p = o?.pendingId || o?.activeInvitation?.pendingId;
    return !!(p && contactById(p)?.kind === "external");
  }

  function holderDemoCodeAllowed(o) {
    return !pendingIsExternal(o);
  }

  function invitationTokenValid(o, inv, token) {
    if (!token || !inv) return false;
    if (!Ms()?.tokenMatches?.(inv, token)) return false;
    const ttl = Ms()?.START_TOKEN_TTL_MS ?? 7 * 24 * 60 * 60 * 1000;
    const issued = inv.startTokenIssuedAt ?? 0;
    if (issued && now() - issued > ttl) return false;
    return true;
  }

  function isExternalShell() {
    if (state.recipientMode) return false;
    const c = state.actingContactId && contactById(state.actingContactId);
    return !!(c && c.kind === "external");
  }

  function externalActionBarHtml() {
    if (!isExternalShell()) return "";
    const c = contactById(state.actingContactId);
    const name = c?.name || "Внешний участник";
    const phone = c?.phone ? fmtPhone(c.phone) : "";
    const onHome = !state.orderId && state.view !== "ext-request";
    if (!onHome) {
      return `<div class="tt-ext-bar tt-ext-bar--compact" data-tt="external-bar">
        ${btn("← Мои передачи", 'data-tt="back-list"', "tt-ext-bar-back")}
        <span class="tt-ext-bar-name">${E(name)}</span>
        ${btn("Выйти", 'data-tt="clear-act"', "tt-ext-bar-exit")}
      </div>`;
    }
    return `<header class="tt-ext-head" data-tt="external-bar">
      <div class="tt-ext-head-row">
        <div class="tt-ext-head-id">
          <p class="tt-ext-kicker">Мои передачи</p>
          <h1 class="tt-ext-name">${E(name)}</h1>
          <p class="tt-ext-sub">${phone ? `${E(phone)} · ` : ""}вход через Telegram или MAX</p>
        </div>
        ${btn("Выйти", 'data-tt="clear-act"', "tt-ext-bar-exit")}
      </div>
      ${btn("Отправить предмет", 'data-tt="ext-request-open"', "tt-primary tt-btn-block tt-ext-cta")}
      <p class="tt-ext-cta-hint">Как в боте: что передаёте → фото → кому → срок. Сотрудник получит уведомление.</p>
    </header>`;
  }

  function handoffUrl(o, inv) {
    const t = inv || o.activeInvitation;
    const role = state.ttPrototypeRole || "manager";
    if (!t) return `${location.pathname}#tan-tracker?role=${role}`;
    const p = new URLSearchParams({
      role,
      tt_view: "recipient",
      tt_order: t.id,
      tt_hv: String(t.hv),
      tt_rcv: t.pendingId,
      tt_via: "qr",
    });
    if (t.startTokenPlain) p.set("tt_st", t.startTokenPlain);
    return `${location.pathname}#tan-tracker?${p}`;
  }

  function qrSvg(text) {
    if (typeof qrcode !== "function") return "";
    const qr = qrcode(0, "M");
    qr.addData(text);
    qr.make();
    const n = qr.getModuleCount();
    const maxSide = 280;
    const cell = Math.max(4, Math.min(8, Math.floor(maxSide / (n + 8))));
    const margin = cell * 4;
    return qr.createSvgTag({ cellSize: cell, margin, scalable: true });
  }

  function invitationForTicket(o, urlHv) {
    const hv = Number(urlHv);
    if (o.activeInvitation && o.activeInvitation.hv === hv) return o.activeInvitation;
    return (o.pastInvitations || []).find((x) => x.hv === hv) || null;
  }

  function invitationTicketReceiver(inv) {
    return inv?.pendingId ?? inv?.rcv ?? null;
  }

  function recipientHandoffReceived(o, ticketRcv, urlHv) {
    if (!o || !ticketRcv || urlHv == null || urlHv === "") return null;
    if (o.holderId !== ticketRcv) return null;
    const inv = invitationForTicket(o, urlHv);
    if (!inv) return null;
    if (invitationTicketReceiver(inv) !== ticketRcv) return null;
    if (o.activeInvitation?.hv === Number(urlHv) && o.pendingId === ticketRcv) return null;
    const entry =
      o.timeline
        .filter((t) => t.to === ticketRcv && isConfirmedHandoffTimelineNote(t.note))
        .sort((a, b) => a.at - b.at)
        .pop() || null;
    if (!entry && o.status !== "completed") return null;
    if (!entry && o.status === "completed" && o.finalRecipientId === ticketRcv) {
      return {
        inv,
        receivedAt: o.holderSince,
        fromId: o.timeline.filter((t) => t.to === ticketRcv).sort((a, b) => a.at - b.at).pop()?.from,
      };
    }
    if (!entry) return null;
    return { inv, receivedAt: entry.at, fromId: entry.from };
  }

  function resolveInvitation(o, urlHv, ticketRcv) {
    const hv = Number(urlHv);
    const rcv = ticketRcv || null;
    if (o.activeInvitation && o.activeInvitation.hv === hv) return { inv: o.activeInvitation, stale: false };
    const past = (o.pastInvitations || []).find((x) => x.hv === hv);
    if (past) {
      if (rcv && recipientHandoffReceived(o, rcv, urlHv)) return { inv: past, stale: false, consumed: true };
      return { inv: past, stale: true };
    }
    if (o.activeInvitation) return { inv: o.activeInvitation, stale: o.activeInvitation.hv !== hv };
    return { inv: null, stale: true };
  }

  function externalHolderPageDemoUrl(o, contactId) {
    const p = new URLSearchParams({
      role: state.ttPrototypeRole || "manager",
      tt_act: contactId,
      tt_id: o.id,
    });
    return `${location.origin}${location.pathname}#tan-tracker?${p}`;
  }

  function leaveRouteCleanup() {
    state.recipientMode = false;
    state.recipientVia = "code";
    state.recipientTicket = null;
    resetRecipientWelcome();
    state.actingContactId = null;
    state.orderId = null;
    state.view = "list";
    clearCompleteConfirm();
    clearAttachStaging();
    closeAttachLightbox();
    resetPhoneIdentity();
    state.createPhase = "item";
    state.handoffReceipt = null;
    state.codeDemoRevealed = false;
    ttShellMounted = false;
    TT_BODY.forEach((c) => document.body.classList.remove(c));
    document.dispatchEvent(new Event("assistant:paint"));
  }

  function applyBodyClasses() {
    const on = current === ROUTE;
    if (!on) {
      TT_BODY.forEach((c) => document.body.classList.remove(c));
      document.body.classList.remove("tt-create-wizard", "tt-detail-focus");
      return;
    }
    const ext = isExternalShell();
    document.body.classList.toggle("tt-active", !state.recipientMode && !ext);
    document.body.classList.toggle("tt-recipient-shell", state.recipientMode);
    document.body.classList.toggle("tt-external-shell", ext);
    document.body.classList.toggle("tt-create-wizard", !state.recipientMode && !ext && state.view === "create");
    document.body.classList.toggle(
      "tt-create-review",
      !state.recipientMode && !ext && state.view === "create" && state.createPhase === "review"
    );
    document.body.classList.toggle(
      "tt-detail-focus",
      !state.recipientMode && !ext && state.view === "detail" && !!state.orderId
    );
    document.body.classList.toggle(
      "tt-registry-list",
      !state.recipientMode && !ext && state.view === "list"
    );
    document.body.classList.toggle("tt-code-view", !state.recipientMode && !ext && state.view === "code");
  }

  let detailOverflowListenersBound = false;
  function setupDetailOverflowMenu() {
    const overflow = document.querySelector('[data-tt="detail-overflow"]');
    if (!overflow || detailOverflowListenersBound) return;
    detailOverflowListenersBound = true;
    document.addEventListener("click", (e) => {
      const open = document.querySelector('[data-tt="detail-overflow"][open]');
      if (!open || open.contains(e.target)) return;
      open.open = false;
    });
    document.addEventListener("keydown", (e) => {
      if (e.key !== "Escape") return;
      document.querySelectorAll('[data-tt="detail-overflow"][open]').forEach((el) => {
        el.open = false;
      });
    });
  }

  function setupDetailMobileDock() {
    detailDockObserver?.disconnect();
    detailDockObserver = null;
    const root = document.querySelector('[data-tt="detail"]');
    const dock = document.querySelector('[data-tt="detail-mobile-dock"]');
    const hero = document.querySelector("[data-tt-detail-hero-primary]");
    if (!root || !dock || !hero) return;
    dock.hidden = true;
    root.classList.remove("tt-detail-panel--dock-visible");
    detailDockObserver = new IntersectionObserver(
      (entries) => {
        const visible = entries[0]?.isIntersecting;
        dock.hidden = !!visible;
        root.classList.toggle("tt-detail-panel--dock-visible", !visible);
      },
      { threshold: 0, rootMargin: "0px 0px 0px 0px" }
    );
    detailDockObserver.observe(hero);
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

  function avatarToneIndex(id) {
    let h = 0;
    for (let i = 0; i < (id || "").length; i++) h = (h + id.charCodeAt(i) * 17) % 6;
    return h;
  }

  function contactAvatarHtml(c, sizeClass = "") {
    const ext = c?.kind === "external" ? " tt-avatar--external" : "";
    const tone = avatarToneIndex(c?.id);
    return `<span class="tt-avatar tt-avatar-tone-${tone}${sizeClass ? ` ${sizeClass}` : ""}${ext}" aria-hidden="true">${E(contactInitials(c))}</span>`;
  }

  function moscowParts(ts) {
    const d = new Date(ts);
    const fmt = new Intl.DateTimeFormat("en-CA", {
      timeZone: "Europe/Moscow",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    });
    const parts = Object.fromEntries(fmt.formatToParts(d).map((p) => [p.type, p.value]));
    return parts;
  }

  function humanDueLabel(o) {
    if (!o.dueAt) return { primary: "Срок не указан", secondary: "", overdue: false, title: "" };
    const full = dt(o.dueAt);
    const overdue = isOverdue(o);
    const ms = o.dueAt - now();
    const absH = Math.abs(ms) / 3600000;
    const p = moscowParts(o.dueAt);
    const nowP = moscowParts(now());
    const dueDay = `${p.year}-${p.month}-${p.day}`;
    const today = `${nowP.year}-${nowP.month}-${nowP.day}`;
    const timeShort = `${p.hour}:${p.minute}`;
    if (overdue) {
      let primary = "просрочено";
      if (absH >= 1 && absH < 48) primary = `на ${Math.round(absH)} ч`;
      return { primary, secondary: full, overdue: true, title: full };
    }
    let primary = full;
    if (dueDay === today) primary = `сегодня до ${timeShort}`;
    else {
      const tomorrow = new Date(now());
      tomorrow.setDate(tomorrow.getDate() + 1);
      const tm = moscowParts(tomorrow.getTime());
      if (dueDay === `${tm.year}-${tm.month}-${tm.day}`) primary = `завтра до ${timeShort}`;
      else if (ms > 0 && ms < 86400000 * 2) primary = `через ${Math.max(1, Math.round(absH))} ч`;
    }
    return { primary, secondary: full, overdue: false, title: full };
  }

  function detailDuePhrase(o) {
    const d = humanDueLabel(o);
    if (!o.dueAt) return "Срок доставки не указан";
    if (d.overdue) {
      const was = d.secondary || d.title || dt(o.dueAt);
      if (d.primary.startsWith("на ")) return `Просрочено ${d.primary} · было до ${was}`;
      return `Просрочено · было до ${was}`;
    }
    if (/^(сегодня|завтра|через )/.test(d.primary)) return `Доставить ${d.primary}`;
    return `Доставить до ${d.primary}`;
  }

  function humanDueHtml(o) {
    const d = humanDueLabel(o);
    const cls = d.overdue ? "tt-due-human tt-due-human--over" : "tt-due-human";
    return `<span class="${cls}" title="${E(d.title || d.secondary)}">${E(d.primary)}</span>${d.secondary && d.primary !== d.secondary ? `<span class="tt-due-human-sub">${E(d.secondary)}</span>` : ""}`;
  }

  function registryCardDuePrimary(o) {
    const d = humanDueLabel(o);
    if (!d.overdue) return d.primary;
    return d.primary.startsWith("на ") ? `просрочено ${d.primary}` : "просрочено";
  }

  function humanDueTableCell(o) {
    const d = humanDueLabel(o);
    if (!o.dueAt) return "—";
    const cls = d.overdue ? "tt-due-human tt-due-human--over" : "tt-due-human";
    let primary = d.primary;
    if (d.overdue) {
      primary = primary.startsWith("на ") ? `просрочено ${primary}` : "просрочено";
    }
    return `<span class="${cls}">${E(primary)}</span><span class="tt-due-human-sub">${E(d.secondary || d.title)}</span>`;
  }

  function registryActorContext(o, actor) {
    if (!actor) return { key: "route", label: "В пути", icon: "route" };
    if (orderIsCompleted(o)) return { key: "done", label: "Завершена", icon: "check-circle" };
    if (orderIsDelivered(o)) return { key: "delivered", label: "Доставлено", icon: "package-check" };
    if (o.pendingId === actor) return { key: "inbox", label: "Жду получения", icon: "download" };
    if (o.holderId === actor && o.pendingId) {
      const p = contactById(o.pendingId);
      return { key: "wait", label: "Ожидает код", icon: "key-round", hint: p?.name };
    }
    if (o.holderId === actor && !o.pendingId && orderTrackOpen(o) && !orderIsDelivered(o))
      return { key: "send", label: "Нужно передать", icon: "send" };
    return { key: "route", label: "В пути", icon: "route" };
  }

  function looksLikePersonalName(name) {
    const n = (name || "").trim();
    if (!n || /[«""]/.test(n)) return false;
    if (/^(ООО|ИП|АО|ЗАО|ПАО|Курьер|ОАО)/i.test(n)) return false;
    const parts = n.split(/\s+/).filter(Boolean);
    if (parts.length < 2) return false;
    return parts.every((p) => /^[\p{L}.-]+$/u.test(p) && p.length <= 24);
  }

  function shortContactName(c) {
    if (!c?.name) return "—";
    if (!looksLikePersonalName(c.name)) return c.name;
    const parts = c.name.trim().split(/\s+/).filter(Boolean);
    return `${parts[0]} ${parts[parts.length - 1][0]}.`;
  }

  function routeDisplayName(c, { table = false } = {}) {
    if (!c?.name) return "—";
    if (table) return c.name;
    return looksLikePersonalName(c.name) ? shortContactName(c) : c.name;
  }

  function statusChipIcon(ctx) {
    if (ctx.key === "route") return `<span class="tt-status-dot" aria-hidden="true"></span>`;
    return `<i data-lucide="${ctx.icon}"></i>`;
  }

  function statusBadge(o, actor, opts = {}) {
    actor = actor ?? state.actingContactId ?? employeeContact(state.employeeId)?.id;
    const ctx = registryActorContext(o, actor);
    const overdue = isOverdue(o);
    const compact = !!opts.compact;
    const overdueChip = overdue
      ? `<span class="tt-status-chip tt-status-chip--bad" data-tt-status="overdue"><i data-lucide="alert-triangle"></i>Просрочено</span>`
      : "";
    const label = ctx.key === "wait" && compact ? ctx.label : `${ctx.label}${ctx.hint && !compact ? ` · ${ctx.hint}` : ""}`;
    const main = `<span class="tt-status-chip tt-status-chip--${ctx.key}" data-tt-status="${ctx.key}">${statusChipIcon(ctx)}${E(label)}</span>`;
    if (ctx.key === "done") return main;
    return `<span class="tt-status-group">${main}${overdueChip}</span>`;
  }

  function registryRouteLine(o, { table = false } = {}) {
    const h = contactById(o.holderId);
    const p = o.pendingId ? contactById(o.pendingId) : null;
    const fin = o.finalRecipientId ? contactById(o.finalRecipientId) : null;
    const next = p || (fin && fin.id !== o.holderId ? fin : null);
    const name = (c) => E(routeDisplayName(c, { table }));
    return `<span class="tt-card-v2-route">${contactAvatarHtml(h)}<span class="tt-card-v2-route-name">${name(h)}</span>${
      next
        ? `<span class="tt-card-v2-route-arrow" aria-hidden="true">→</span>${contactAvatarHtml(next)}<span class="tt-card-v2-route-name">${name(next)}</span>`
        : ""
    }</span>`;
  }

  function registryCardMeta(o) {
    const parts = [E(o.id)];
    if (o.qty) parts.push(E(o.qty));
    const ts = o.dueAt || o.holderSince;
    if (ts) parts.push(E(dt(ts)));
    return parts.join(" · ");
  }

  function registryCardHtml(o, actor) {
    const ctx = registryActorContext(o, actor);
    const overdue = isOverdue(o);
    const done = orderIsCompleted(o) || orderIsDelivered(o);
    const due = humanDueLabel(o);
    const accent =
      ctx.key === "send"
        ? "var(--green,#507f22)"
        : ctx.key === "wait"
          ? "var(--tt-blue,#285a82)"
          : ctx.key === "inbox"
            ? "var(--warn,#93600d)"
            : overdue
              ? "var(--bad,#ac4343)"
              : "var(--line)";
    const extBadge =
      o.fromExternal && !isExternalShell()
        ? ` <span class="tt-badge" data-tt="from-external">От внешнего</span>`
        : "";
    return `<div class="tt-selectable-card${state.registrySelection.includes(o.id) ? " tt-is-selected" : ""}">${registryCheckbox(o, true)}
    <button type="button" class="tt-card-v2${overdue ? " tt-card-v2--overdue" : ""}${done ? " tt-card-v2--completed" : ""}" data-tt-open="${E(o.id)}" style="--tt-card-accent:${accent}">
      <span class="tt-card-v2-accent" aria-hidden="true"></span>
      <div class="tt-card-v2-top"><h3 class="tt-card-v2-title">${E(o.item)}${extBadge}</h3><i data-lucide="chevron-right"></i></div>
      ${registryRouteLine(o)}
      <div class="tt-card-v2-foot">${statusBadge(o, actor, { compact: true })}<span class="tt-card-v2-due-inline ${due.overdue ? "tt-due-human--over" : ""}">${E(registryCardDuePrimary(o))}</span></div>
      <p class="tt-card-v2-meta">${registryCardMeta(o)}</p>
    </button></div>`;
  }

  function registryCounts() {
    const actor = registryActorId();
    const scopeVisible = orders.filter((o) => orderVisible(o) && !registryArchive.has(o.id));
    let base = scopeVisible;
    if (state.registryPersonalView === "main") {
      base = base.filter((o) => !registryPersonallyHidden(o, actor));
    }
    const handoff = scopeVisible.filter(
      (o) =>
        o.holderId === actor &&
        orderTrackOpen(o) &&
        !orderIsDelivered(o) &&
        o.finalRecipientId &&
        o.holderId !== o.finalRecipientId
    ).length;
    const receive = scopeVisible.filter((o) => o.pendingId === actor).length;
    const overdue = base.filter((o) => isOverdue(o)).length;
    const active = base.filter((o) => orderTrackOpen(o) && !orderIsDelivered(o)).length;
    return { handoff, receive, overdue, active, total: base.length };
  }

  function registryGroupOrders(rows, actor) {
    const action = [];
    const progress = [];
    const done = [];
    rows.forEach((o) => {
      const ctx = registryActorContext(o, actor);
      if (orderIsCompleted(o) || orderIsDelivered(o)) done.push(o);
      else if (ctx.key === "send" || ctx.key === "wait" || ctx.key === "inbox") action.push(o);
      else progress.push(o);
    });
    return [
      { id: "action", title: "Требуют вашего действия", items: action },
      { id: "progress", title: "В работе", items: progress },
      { id: "done", title: "Завершённые", items: done },
    ].filter((g) => g.items.length);
  }

  function registrySectionsHtml(rows) {
    const actor = state.actingContactId || employeeContact(state.employeeId)?.id;
    const groups = registryGroupOrders(rows, actor);
    if (!groups.length) return "";
    return groups
      .map(
        (g) => `<section class="tt-registry-section" data-tt-registry-section="${g.id}">
      <h2 class="tt-registry-section-title">${E(g.title)}</h2>
      <div class="tt-registry-cards">${g.items.map((o) => registryCardHtml(o, actor)).join("")}</div>
    </section>`
      )
      .join("");
  }

  function registryCardsHtml(rows) {
    return registrySectionsHtml(rows);
  }

  function registryRowsHtml(rows) {
    const actor = state.actingContactId || employeeContact(state.employeeId)?.id;
    return rows
      .map((o) => {
        const overdue = isOverdue(o);
        const extBadge =
          o.fromExternal && !isExternalShell()
            ? ` <span class="tt-badge" data-tt="from-external">От внешнего</span>`
            : "";
        return `<tr data-tt-open="${E(o.id)}" class="${overdue ? "tt-row--overdue" : ""}${state.registrySelection.includes(o.id) ? " tt-is-selected" : ""}">
          ${!cleanupPreviewReadOnly() ? `<td class="tt-selection-cell">${registryCheckbox(o)}</td>` : ""}
          <td><strong>${E(o.item)}</strong>${extBadge}<small>${E(o.id)}${o.qty ? ` · ${E(o.qty)}` : ""}</small></td>
          <td>${registryRouteLine(o)}</td>
          <td>${statusBadge(o, actor)}</td>
          <td class="tt-table-due">${humanDueTableCell(o)}</td>
        </tr>`;
      })
      .join("");
  }

  function registryEmptyHtml() {
    if (["archived", "registry-archive"].includes(state.registryPersonalView)) {
      const personal = state.registryPersonalView === "archived";
      return `<div class="tt-empty-v2 tt-empty" data-tt="empty"><i data-lucide="archive" aria-hidden="true"></i>
        <p><strong>${personal ? "Мой архив пока пуст" : "Общий архив пока пуст"}</strong></p>
        <p class="tt-muted">${personal ? "Выполненные передачи можно убрать сюда из карточки или кнопкой «В мой архив»." : "Здесь появятся треки, которые администратор уберёт из общего реестра с сохранением истории."}</p>
        ${btn("К актуальным передачам", 'data-tt="registry-empty-main"', "tt-link")}</div>`;
    }
    return `<div class="tt-empty-v2 tt-empty" data-tt="empty">
      <svg viewBox="0 0 120 80" aria-hidden="true"><rect x="20" y="24" width="80" height="48" rx="10" fill="var(--tint,#eef5e7)" stroke="var(--green,#507f22)" stroke-width="2"/><path d="M40 44h40M40 54h28" stroke="var(--green,#507f22)" stroke-width="2" stroke-linecap="round"/></svg>
      <p><strong>Нет передач по фильтрам</strong></p>
      <p class="tt-muted">Измените поиск или сбросьте фильтры</p>
      ${btn("Сбросить фильтры", 'data-tt="reset-filters"', "tt-link")}
    </div>`;
  }

  function patchRegistryStats() {
    const c = registryCounts();
    document.querySelectorAll('[data-tt-stat="handoff"]').forEach((el) => {
      el.textContent = String(c.handoff);
      el.closest(".tt-stat-tile")?.classList.toggle("tt-stat-tile--dim", c.handoff === 0);
    });
    document.querySelectorAll('[data-tt-stat="receive"]').forEach((el) => {
      el.textContent = String(c.receive);
      el.closest(".tt-stat-tile")?.classList.toggle("tt-stat-tile--dim", c.receive === 0);
    });
    document.querySelectorAll('[data-tt-stat="overdue"]').forEach((el) => {
      el.textContent = String(c.overdue);
      el.closest(".tt-stat-tile")?.classList.toggle("tt-stat-tile--dim", c.overdue === 0);
    });
    document.querySelectorAll('[data-tt-stat="active"]').forEach((el) => {
      el.textContent = String(c.active);
    });
  }

  function patchRegistryResetRow() {
    const host = document.querySelector('[data-tt="registry-shell"]');
    if (!host) return;
    const active = state.statusFilter !== "all" || state.mineFilter !== "all" || !!state.query.trim();
    let row = host.querySelector('[data-tt="registry-reset-row"]');
    if (!active) {
      row?.remove();
      return;
    }
    const html = `<div class="tt-registry-reset-row" data-tt="registry-reset-row">${btn("Сбросить фильтры", 'data-tt="reset-filters"', "tt-link")}</div>`;
    if (row) row.outerHTML = html;
    else host.querySelector(".tt-registry-toolbar")?.insertAdjacentHTML("afterend", html);
  }

  function patchRegistry() {
    const rows = visibleOrders();
    syncRegistrySelection(rows);
    const tbody = document.querySelector("#tt-registry-body");
    const cardsHost = document.querySelector('[data-tt="cards"]');
    const sectionsHost = document.querySelector('[data-tt="registry-sections"]');
    const empty = document.querySelector('[data-tt="empty"]');
    if (!tbody && !sectionsHost) return false;
    patchRegistryStats();
    patchRegistryResetRow();
    if (rows.length) {
      if (tbody) tbody.innerHTML = registryRowsHtml(rows);
      const cardHtml = registryCardsHtml(rows);
      if (cardsHost) cardsHost.innerHTML = cardHtml;
      if (sectionsHost) sectionsHost.innerHTML = cardHtml;
      empty?.remove();
    } else {
      if (tbody) tbody.innerHTML = "";
      if (cardsHost) cardsHost.innerHTML = "";
      if (sectionsHost) sectionsHost.innerHTML = "";
      if (!empty) document.getElementById("tt-content")?.insertAdjacentHTML("beforeend", registryEmptyHtml());
    }
    paintRegistrySelection();
    return true;
  }

  function patchContactPick() {
    const host = document.querySelector('[data-tt="contact-pick"]');
    if (!host || !state.form) return false;
    const f = state.form;
    const relay = state.createPhase === "relay-pick";
    const holder = employeeContact(state.employeeId);
    const q = (f.pickQ || "").toLowerCase().trim();
    const pick = contacts.filter((c) => {
      if (c.id === holder?.id) return false;
      if (!q) return true;
      return (c.name + c.phone + fmtPhone(c.phone)).toLowerCase().includes(q);
    });
    const sel = relay ? f.relayId : f.finalRecipientId || f.recipientId;
    const emps = pick.filter((c) => c.kind === "employee").slice(0, 40);
    const ext = pick.filter((c) => c.kind === "external").slice(0, 40);
    const btn = (c) => wizardContactButton(c, sel === c.id);
    host.innerHTML = pick.length
      ? `${emps.length ? `<p class="tt-muted">Сотрудники · справочник компании</p><div class="tt-wizard-contact-list tt-wizard-contact-list--group">${emps.map(btn).join("")}</div>` : ""}${
          ext.length ? `<p class="tt-muted">Внешние контакты</p><div class="tt-wizard-contact-list tt-wizard-contact-list--group">${ext.map(btn).join("")}</div>` : ""
        }`
      : `<p class="tt-wizard-contact-empty" data-tt="contact-pick-empty">Никого не найдено. Измените запрос или добавьте нового получателя.</p>`;
    return true;
  }

  function paintQrHosts() {
    document.querySelectorAll('[data-tt="qr-host"]').forEach((host) => {
      const payload = host.getAttribute("data-payload");
      if (!payload) return;
      host.innerHTML = qrSvg(payload);
    });
  }

  function scrollQrIntoView() {
    if (window.innerWidth >= 768) return;
    const minTop = 80;
    const bottomGap = 150;
    const pick = () =>
      document.querySelector('[data-tt="handoff-panel"] .tt-qr-wrap') ||
      document.querySelector('[data-tt="handoff-panel"] [data-tt="qr-host"]') ||
      document.querySelector('[data-tt="qr-host"]');
    const fit = (el) => {
      const r = el.getBoundingClientRect();
      const vh = window.innerHeight;
      return r.top >= minTop && r.bottom <= vh - bottomGap;
    };
    const nudge = (el, attempt) => {
      const r = el.getBoundingClientRect();
      const vh = window.innerHeight;
      let delta = 0;
      if (r.top < minTop) delta = r.top - minTop;
      else if (r.bottom > vh - bottomGap) delta = r.bottom - (vh - bottomGap);
      if (delta) window.scrollBy({ top: delta, behavior: attempt === 0 ? "smooth" : "auto" });
      if (attempt < 20 && !fit(el)) requestAnimationFrame(() => nudge(el, attempt + 1));
    };
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        const el = pick();
        if (!el) return;
        el.scrollIntoView({ behavior: "smooth", block: "center", inline: "nearest" });
        requestAnimationFrame(() => nudge(el, 0));
      });
    });
  }

  function attachmentsSection(o, opts = {}) {
    if (!Att()) return "";
    const items = opts.items || Att().listForOrder(o);
    const stagedIds = new Set((state.attachOrderStaging || []).map((s) => s.id));
    const compact = !!opts.compact;
    return Att().blockHtml({
      items,
      stagedIds,
      readonly: !!opts.readonly,
      showPicker: !!opts.showPicker,
      inputKey: opts.inputKey || "detail",
      orderId: o?.id || "",
      error: opts.attachError || state.attachError,
      hint: opts.hint,
      compact,
      omitResetNote: compact,
      title: compact ? "Файлы" : "Фото и файлы",
      pickerLabel: compact ? "Добавить фото или файл" : "Прикрепить фото или файл",
      pickerMode: compact ? "button" : "native",
    });
  }

  function createAttachmentsSection(opts = {}) {
    if (!Att()) return "";
    const staged = [...state.attachStaging];
    return Att().blockHtml({
      items: staged,
      stagedIds: new Set(staged.map((s) => s.id)),
      showPicker: !state.attachBusy,
      inputKey: "create",
      omitTitle: true,
      pickerMode: "button",
      pickerLabel: opts.pickerLabel || "Выбрать файл на устройстве",
      error: state.attachError,
      hint: opts.hint || "Можно пропустить этот шаг, если фото не нужны.",
    });
  }

  function createStepNumber(phase) {
    if (phase === "item") return 1;
    if (phase === "files") return 2;
    if (phase.startsWith("recipient") || phase === "relay-pick" || phase === "edit-relay") return 3;
    return 4;
  }

  function defaultCreateForm() {
    return {
      item: "",
      finalRecipientId: "",
      relayId: "",
      recipientId: "",
      comment: "",
      due: "",
      pickQ: "",
      newName: "",
      newPhone: "",
      mode: "list",
      pickTarget: "final",
      recipientStep: "choose",
    };
  }

  function ensureRecipientStep(f) {
    if (!f.recipientStep) {
      f.recipientStep = f.finalRecipientId || f.recipientId ? "confirmed" : "choose";
    }
  }

  function wizardContactPickList(f, { relay = false, selectedId }) {
    const holder = employeeContact(state.employeeId);
    const q = (f.pickQ || "").toLowerCase().trim();
    const pick = contacts.filter((c) => {
      if (c.id === holder?.id) return false;
      if (!q) return true;
      return (c.name + c.phone + fmtPhone(c.phone)).toLowerCase().includes(q);
    });
    const sel = selectedId || (relay ? f.relayId : f.finalRecipientId || f.recipientId);
    const emps = pick.filter((c) => c.kind === "employee").slice(0, 40);
    const ext = pick.filter((c) => c.kind === "external").slice(0, 40);
    const btn = (c) => wizardContactButton(c, sel === c.id);
    const listInner = pick.length
      ? `${emps.length ? `<p class="tt-muted">Сотрудники · справочник компании</p><div class="tt-wizard-contact-list tt-wizard-contact-list--group">${emps.map(btn).join("")}</div>` : ""}${
          ext.length ? `<p class="tt-muted">Внешние контакты</p><div class="tt-wizard-contact-list tt-wizard-contact-list--group">${ext.map(btn).join("")}</div>` : ""
        }`
      : `<p class="tt-wizard-contact-empty" data-tt="contact-pick-empty">Никого не найдено. Измените запрос или добавьте нового получателя.</p>`;
    return `<label class="tt-wizard-field">Поиск по имени или телефону<input data-tt-field="pickQ" value="${E(f.pickQ || "")}" placeholder="Начните вводить имя или цифры телефона" autocomplete="off"></label>
        <div class="tt-wizard-contact-list" data-tt="contact-pick">${listInner}</div>
        <button type="button" class="tt-wizard-btn tt-wizard-btn-secondary tt-wizard-new-recipient-link" data-tt="create-new-recipient" aria-label="Добавить нового получателя">Добавить нового получателя</button>`;
  }

  function wizardRecipientSelectedCard(contactId) {
    const c = contactById(contactId);
    if (!c) return "";
    return `<div class="tt-wizard-recipient-selected" data-tt="recipient-selected">
      <div class="tt-wizard-recipient-selected-card">
        <span class="tt-wizard-recipient-selected-label">Конечный получатель</span>
        <strong class="tt-wizard-recipient-selected-name">${E(c.name)}</strong>
        <span class="tt-wizard-recipient-selected-phone">${E(fmtPhone(c.phone))}</span>
      </div>
      ${wizardReviewLink("Выбрать другого получателя", "create-recipient-change", "Выбрать другого получателя")}
    </div>`;
  }

  function wizardRouteConnectorLi() {
    return `<li class="tt-wizard-route-connector" role="presentation" aria-hidden="true"><span class="tt-wizard-route-arrow"></span></li>`;
  }

  function wizardReviewRouteNav(f, finContact, finSummary, relay) {
    const sender = contactById(state.actingContactId) || employeeContact(state.employeeId);
    const directHint = "Отдайте предмет этому получателю напрямую, без посредника.";
    const relayHint = finContact
      ? `Должен передать предмет дальше: ${finContact.name} · ${fmtPhone(finContact.phone)}.`
      : "Должен передать предмет конечному получателю.";
    const relayEditLabel = relay ? "Изменить посредника" : "Передать через другого человека";
    const relayEditAria = relay ? "Изменить посредника" : "Передать через другого человека";
    const senderLi = `<li class="tt-wizard-route-stop" data-tt="route-stop-sender">
      <span class="tt-wizard-route-role">Отправитель</span>
      <span class="tt-wizard-route-you">Вы</span>
      ${
        sender
          ? `<div class="tt-wizard-route-person">${reviewPersonHtml(sender)}</div>`
          : `<p class="tt-wizard-route-missing">Текущий участник не определён в демо.</p>`
      }
    </li>`;
    const finalLi = `<li class="tt-wizard-route-stop" data-tt="route-stop-final">
      <div class="tt-wizard-review-block-head">
        <span class="tt-wizard-route-role">Получатель</span>
        ${wizardReviewLink("Выбрать другого получателя", "create-edit-recipient", "Выбрать другого получателя", true)}
      </div>
      <div class="tt-wizard-route-person">${reviewPersonHtml(finContact, finSummary, f)}</div>
      ${!relay ? `<p class="tt-wizard-review-handoff-hint">${E(directHint)}</p>` : ""}
      ${
        !relay
          ? `<div class="tt-wizard-route-relay-cta" data-tt="review-handoff">${wizardReviewLink(relayEditLabel, "create-edit-relay", relayEditAria, true)}</div>`
          : ""
      }
    </li>`;
    if (relay) {
      const relayLi = `<li class="tt-wizard-route-stop" data-tt="review-handoff">
        <div class="tt-wizard-review-block-head">
          <span class="tt-wizard-route-role">Передать сейчас</span>
          <span class="tt-wizard-route-subrole">Посредник</span>
          ${wizardReviewLink(relayEditLabel, "create-edit-relay", relayEditAria, false)}
        </div>
        <div class="tt-wizard-route-person">${reviewPersonHtml(relay)}</div>
        <p class="tt-wizard-review-handoff-hint">${E(relayHint)}</p>
      </li>`;
      return `<section class="tt-wizard-review-route-nav tt-wizard-review-route-card" data-tt="review-route-nav" aria-label="План маршрута до создания">
        <p class="tt-wizard-route-plan-note">План маршрута · передача ещё не создана</p>
        <ol class="tt-wizard-route-scheme tt-wizard-route-scheme--relay">${senderLi}${wizardRouteConnectorLi()}${relayLi}${wizardRouteConnectorLi()}${finalLi}</ol>
      </section>`;
    }
    return `<section class="tt-wizard-review-route-nav tt-wizard-review-route-card" data-tt="review-route-nav" aria-label="План маршрута до создания">
      <p class="tt-wizard-route-plan-note">План маршрута · передача ещё не создана</p>
      <ol class="tt-wizard-route-scheme tt-wizard-route-scheme--direct">${senderLi}${wizardRouteConnectorLi()}${finalLi}</ol>
    </section>`;
  }

  function wizardRecipientChooseBody() {
    return `<div class="tt-wizard-recipient-choose" data-tt="recipient-choose">
      <button type="button" class="tt-wizard-choice-card" data-tt="create-recipient-browse">
        <span class="tt-wizard-choice-title">Выбрать из списка</span>
        <span class="tt-wizard-choice-hint">Контакты компании и клиенты демо-каталога</span>
      </button>
      <button type="button" class="tt-wizard-choice-card" data-tt="create-new-recipient" aria-label="Добавить нового получателя">
        <span class="tt-wizard-choice-title">Добавить нового</span>
        <span class="tt-wizard-choice-hint">Имя и телефон — как в карточке контакта</span>
      </button>
    </div>`;
  }

  function wizardShell(phase, title, hint, body, actionsHtml) {
    const n = createStepNumber(phase);
    const phaseClass = phase === "review" ? " tt-wizard--review" : "";
    const segments = [1, 2, 3, 4]
      .map((i) => {
        let cls = "tt-wizard-segment";
        if (i < n) cls += " tt-wizard-segment--done";
        if (i === n) cls += " tt-wizard-segment--active";
        return `<span class="${cls}" aria-hidden="true"></span>`;
      })
      .join("");
    return `<div class="tt-wizard-shell-card tt-view-enter"><div class="tt-wizard${phaseClass}" data-tt="create-wizard" data-create-phase="${E(phase)}">
      <div class="tt-wizard-segments" aria-hidden="true">${segments}</div>
      <p class="tt-wizard-progress">Шаг ${n} из 4</p>
      <h2 class="tt-wizard-title">${E(title)}</h2>
      <p class="tt-wizard-hint">${E(hint)}</p>
      <div class="tt-wizard-body">${body}</div>
      ${state.attachBusy ? `<p class="tt-muted" data-tt="attach-busy">Обрабатываем файлы… Подождите — «Далее» и «Создать передачу» включатся сами.</p>` : ""}
      ${state.error ? `<p class="tt-error" data-tt="form-error">${E(state.error)}</p>` : ""}
      <div class="tt-wizard-actions tt-wizard-actions--dock">${actionsHtml}</div>
    </div></div>`;
  }

  function wizardBtn(label, action, primary = false, extraClass = "") {
    const freeze =
      state.attachBusy &&
      (action === "create-wizard-next" || action === "create-wizard-submit" || action === "create-skip-files");
    const extra = freeze ? ' disabled aria-disabled="true"' : "";
    const base = primary ? "tt-primary tt-wizard-btn" : "tt-wizard-btn tt-wizard-btn-secondary";
    const cls = extraClass ? `${base} ${extraClass}` : base;
    return btn(label, `data-tt="${action}"${extra}`, cls);
  }

  function wizardReviewLink(label, action, ariaLabel = "", long = false) {
    const freeze =
      state.attachBusy &&
      (action === "create-wizard-next" || action === "create-wizard-submit" || action === "create-skip-files");
    const dis = freeze ? " disabled aria-disabled=\"true\"" : "";
    const aria = ariaLabel ? ` aria-label="${E(ariaLabel)}"` : "";
    const longCls = long ? " tt-wizard-review-link-long" : "";
    return `<button type="button" class="tt-wizard-review-link${longCls}" data-tt="${action}"${aria}${dis}>${E(label)}</button>`;
  }

  function reviewPersonHtml(c, summaryFallback, form) {
    if (c) {
      return `<strong class="tt-wizard-review-person-name">${E(c.name)}</strong><span class="tt-wizard-review-person-phone">${E(fmtPhone(c.phone))}</span>`;
    }
    const f = form || state.form;
    if (f?.mode === "new" && f.newName?.trim()) {
      const p = normPhone(f.newPhone || "");
      const phoneLine = p ? fmtPhone(p) : f.newPhone?.trim() || "";
      if (phoneLine) {
        return `<strong class="tt-wizard-review-person-name">${E(f.newName.trim())}</strong><span class="tt-wizard-review-person-phone">${E(phoneLine)}</span>`;
      }
      return `<strong class="tt-wizard-review-person-name">${E(f.newName.trim())}</strong>`;
    }
    const s = summaryFallback || "—";
    const sep = " · ";
    const idx = s.indexOf(sep);
    if (idx > -1) {
      return `<strong class="tt-wizard-review-person-name">${E(s.slice(0, idx))}</strong><span class="tt-wizard-review-person-phone">${E(s.slice(idx + sep.length))}</span>`;
    }
    return `<strong class="tt-wizard-review-person-name">${E(s)}</strong>`;
  }

  function recipientSummary(f) {
    const fid = f.finalRecipientId || f.recipientId;
    if (fid) {
      const c = contactById(fid);
      return c ? `${c.name} · ${fmtPhone(c.phone)}` : "—";
    }
    if (f.mode === "new" && f.newName && f.newPhone) {
      const p = normPhone(f.newPhone);
      return p ? `${f.newName} · ${fmtPhone(p)}` : f.newName;
    }
    return "Не выбран";
  }

  function wizardValidate(phase) {
    const f = state.form || defaultCreateForm();
    if (phase === "item") {
      if (!f.item.trim()) return "Напишите, что передаёте. Это обязательное поле.";
    }
    if (phase === "recipient") {
      if (!f.finalRecipientId && !f.recipientId) return "Выберите конечного получателя из списка или добавьте нового.";
    }
    if (phase === "relay-pick") {
      if (!f.relayId) return "Выберите, кому передать первым.";
    }
    if (phase === "recipient-new-name") {
      if (!f.newName.trim()) return "Введите имя получателя.";
    }
    if (phase === "recipient-new-phone") {
      if (!normPhone(f.newPhone)) return "Введите телефон: 10 цифр после +7 (демо).";
    }
    return "";
  }

  function syncWizardFieldsFromDom() {
    if (state.view !== "create") return;
    if (!state.form) state.form = defaultCreateForm();
    document.querySelectorAll('[data-tt="create-wizard"] [data-tt-field]').forEach((el) => {
      state.form[el.getAttribute("data-tt-field")] = el.value;
    });
  }

  function wizardAdvance() {
    syncWizardFieldsFromDom();
    state.error = wizardValidate(state.createPhase);
    if (state.error) return false;
    const p = state.createPhase;
    if (state.createReturnPhase === "review" && (p === "item" || p === "files")) {
      state.createPhase = "review";
      state.createReturnPhase = null;
      return true;
    }
    if (p === "item") state.createPhase = "files";
    else if (p === "files") {
      state.createPhase = "recipient";
      ensureRecipientStep(state.form);
      if (!state.form.finalRecipientId && !state.form.recipientId) state.form.recipientStep = "choose";
    }
    else if (p === "recipient") {
      state.createPhase = "review";
      state.createReturnPhase = null;
    } else if (p === "relay-pick") {
      state.createPhase = "review";
      state.createReturnPhase = null;
    }
    else if (p === "recipient-new-name") {
      const r = addExternalContact(state.form.newName, state.form.newPhone);
      if (r.error) {
        state.error = r.error;
        if (r.existing) {
          if (state.form.pickTarget === "relay") state.form.relayId = r.existing.id;
          else state.form.finalRecipientId = r.existing.id;
        }
        return false;
      }
      r.contact.addedBy = employeeContact(state.employeeId)?.id;
      state.form.mode = "list";
      if (state.form.pickTarget === "relay") {
        state.form.relayId = r.contact.id;
        state.createPhase = "review";
        state.createReturnPhase = null;
      } else {
        state.form.finalRecipientId = r.contact.id;
        state.form.recipientId = r.contact.id;
        state.form.recipientStep = "confirmed";
        state.createPhase = state.form.pickTarget === "final" ? "review" : "recipient";
        if (state.createPhase === "review") state.createReturnPhase = null;
      }
    } else if (p === "recipient-new-phone") {
      const existing = contactByPhone(state.form.newPhone);
      if (existing) {
        state.form.existingMatchId = existing.id;
        state.error = "";
        return false;
      }
      state.form.existingMatchId = "";
      state.form.newPhoneStep = "name";
      state.createPhase = "recipient-new-name";
    } else if (p === "edit-comment" || p === "edit-due" || p === "edit-relay") {
      state.createPhase = "review";
      state.createReturnPhase = null;
    }
    return true;
  }

  function wizardBack() {
    state.error = "";
    const p = state.createPhase;
    if (p === "item") {
      if (state.createReturnPhase === "review") {
        state.createPhase = "review";
        state.createReturnPhase = null;
        return "ok";
      }
      return "cancel";
    }
    if (state.createReturnPhase === "review" && (p === "files" || p === "recipient" || p === "relay-pick")) {
      state.createPhase = "review";
      state.createReturnPhase = null;
      return "ok";
    }
    if (p === "files") state.createPhase = "item";
    else if (p === "recipient") {
      const f = state.form || defaultCreateForm();
      if (f.recipientStep === "pick-list") f.recipientStep = "choose";
      else state.createPhase = "files";
    } else if (p === "recipient-new-name") {
      state.createPhase = "recipient";
      if (state.form) state.form.recipientStep = "choose";
    }
    else if (p === "recipient-new-phone") {
      state.createPhase = "recipient";
      if (state.form) {
        state.form.recipientStep = "choose";
        state.form.existingMatchId = "";
        state.form.newPhoneStep = "phone";
      }
    }
    else if (p === "review") {
      state.createPhase = "recipient";
      ensureRecipientStep(state.form || defaultCreateForm());
      if (state.form) {
        state.form.recipientStep =
          state.form.finalRecipientId || state.form.recipientId ? "confirmed" : "choose";
      }
    }
    else if (p === "relay-pick") state.createPhase = "review";
    else if (p === "edit-comment" || p === "edit-due" || p === "edit-relay") state.createPhase = "review";
    return "ok";
  }

  function closeAttachLightbox() {
    const lb = document.querySelector('[data-tt="attach-lightbox"]');
    if (!lb) return;
    lb.hidden = true;
    const img = lb.querySelector('[data-tt="attach-lightbox-img"]');
    if (img) img.removeAttribute("src");
    if (state.lightboxReturn?.focus) {
      try {
        state.lightboxReturn.focus();
      } catch (_) {}
    }
    state.lightboxReturn = null;
  }

  function openAttachLightbox(a, trigger) {
    if (!Att()?.canPreview(a.mime)) return;
    let lb = document.querySelector('[data-tt="attach-lightbox"]');
    if (!lb && Att()) {
      document.querySelector("#tt-root")?.insertAdjacentHTML("beforeend", Att().lightboxHtml());
      lb = document.querySelector('[data-tt="attach-lightbox"]');
    }
    if (!lb) return;
    state.lightboxReturn = trigger || document.activeElement;
    const img = lb.querySelector('[data-tt="attach-lightbox-img"]');
    const cap = lb.querySelector('[data-tt="attach-lightbox-cap"]');
    if (img) {
      img.src = a.url;
      img.alt = a.name;
    }
    if (cap) cap.textContent = `${a.name} · ${Att().fmtBytes(a.size)}`;
    lb.hidden = false;
    lb.querySelector('[data-tt="attach-lightbox-close"]')?.focus();
  }

  function resolveAttachment(orderId, attId) {
    const o = orders.find((x) => x.id === orderId);
    if (!o) return null;
    return Att()?.findAttachment(o, attId);
  }

  async function ingestFiles(fileList, target) {
    if (!Att() || state.attachBusy) return;
    const files = [...fileList];
    if (!files.length) return;
    const snap = captureAttachSnap(target);
    const opGen = snap.gen;
    if (target === "detail") {
      const cur = orders.find((x) => x.id === state.orderId);
      syncDetailAttDisclosureFromDom(cur);
    }
    state.attachBusy = true;
    state.attachBusyGen = opGen;
    state.attachError = "";
    renderTracker();
    const order = target === "create" ? null : orders.find((x) => x.id === state.orderId);
    const existing = target === "create" ? [] : Att().listForOrder(order);
    const staging = target === "create" ? state.attachStaging : state.attachOrderStaging;
    const addedBy = state.actingContactId || employeeContact(state.employeeId)?.id;
    const errors = [];
    const accepted = [];
    try {
      for (const file of files) {
        if (!attachSnapValid(snap)) break;
        const v = Att().validatePick(file, existing, [...staging, ...accepted]);
        if (v.length) {
          errors.push(...v);
          continue;
        }
        const r = await Att().fileToStaging(file, target === "create" ? "staging:create" : `staging:${order?.id}`);
        if (!attachSnapValid(snap)) {
          if (r.item) Att().revokeStagingItem(r.item);
          break;
        }
        if (r.error) errors.push(r.error);
        else accepted.push(r.item);
      }
      if (attachSnapValid(snap)) {
        if (target === "create") state.attachStaging = [...staging, ...accepted];
        else if (order && accepted.length) {
          Att().mergeToOrder(order, accepted, addedBy);
          state.toast = `Добавлено файлов: ${accepted.length}.`;
        }
        if (errors.length) state.attachError = errors.slice(0, 3).join(" ");
      } else Att().revokeStagingItems(accepted);
    } finally {
      finishAttachIngest(opGen);
      renderTracker();
    }
  }

  function now() {
    return Date.now();
  }

  function orderStatus(o) {
    if (o.status === "completed") return "completed";
    if (o.status === "delivered") return "delivered";
    if (o.pendingId) return "waiting";
    return "active";
  }
  function isOverdue(o) {
    return orderTrackOpen(o) && !orderIsDelivered(o) && o.dueAt && o.dueAt < now();
  }
  function dueCell(o) {
    if (!o.dueAt) return "—";
    return humanDueHtml(o);
  }

  function invalidateCode(o) {
    o.code = null;
    resetRecipientIdentity();
  }

  function completeHandoff(o, via, ticket) {
    state.error = "";
    if (!o.pendingId) {
      state.error = "Ожидание уже подтверждено или отменено.";
      return false;
    }
    if (orderIsCompleted(o)) {
      state.error = "Передача завершена.";
      return false;
    }
    if (orderIsDelivered(o) && !o.pendingId) {
      state.error = "Сначала назначьте следующего получателя или завершите передачу.";
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
    resetRecipientIdentity();
    o.timeline.push({
      at: now(),
      from,
      to,
      note: via === "qr" ? "Подтверждено по QR" : "Подтверждено одноразовым кодом",
    });
    if (o.holderId === o.finalRecipientId) {
      o.status = "delivered";
      o.timeline.push({
        at: now(),
        from: o.holderId,
        to: o.finalRecipientId,
        note: "Доставлено конечному получателю",
      });
      state.toast = "Доставлено — предмет у конечного получателя.";
    } else state.toast = "Держатель обновлён.";
    return true;
  }

  function applyContactProfile(contactId) {
    const c = contactById(contactId);
    if (!c) return;
    if (c.kind === "external") {
      state.actingContactId = contactId;
      return;
    }
    if (c.employeeId && employees[c.employeeId]) {
      state.actingContactId = null;
      state.employeeId = c.employeeId;
      if (Sc()?.effectiveRoleForEmployee) {
        state.ttPrototypeRole = Sc().effectiveRoleForEmployee(c.employeeId);
        lastPrototypeRoleSynced = state.ttPrototypeRole;
      }
    }
  }

  function afterQrReceive(o) {
    state.recipientMode = false;
    state.recipientTicket = null;
    state.codeInput = "";
    state.handoffReceipt = null;
    state.view = "detail";
    applyContactProfile(o.holderId);
    ttShellMounted = false;
  }

  function afterCodeSend(o, senderContactId) {
    state.recipientMode = false;
    state.recipientTicket = null;
    state.codeInput = "";
    const sender = senderContactId || employeeContact(state.employeeId)?.id;
    const senderContact = contactById(sender);
    if (senderContact?.kind === "external") {
      state.actingContactId = sender;
      state.handoffReceipt = {
        orderId: o.id,
        senderId: sender,
        receiverId: o.holderId,
        item: o.item,
        at: now(),
        ver: o.handoffVer ?? 0,
      };
      state.view = "handoff-receipt";
    } else {
      state.handoffReceipt = null;
      if (senderContact?.employeeId) applyContactProfile(sender);
      else state.actingContactId = null;
      state.view = "detail";
    }
    ttShellMounted = false;
  }

  function handoffReceiptValid(o) {
    const r = state.handoffReceipt;
    if (!r || !o || r.orderId !== o.id) return false;
    if ((o.handoffVer ?? 0) !== r.ver) return false;
    if (r.senderId !== (state.actingContactId || employeeContact(state.employeeId)?.id)) return false;
    return true;
  }

  function handoffReceiptView(o) {
    const r = state.handoffReceipt;
    const recv = contactById(r?.receiverId || o.holderId);
    const sender = contactById(r?.senderId);
    return `<div class="tt-panel tt-handoff-receipt" data-tt="handoff-receipt">
      <h2>Передача подтверждена</h2>
      <p class="tt-success">Код принят · ${E(o.item)}</p>
      <p><strong>Новый держатель:</strong> ${E(recv?.name || "—")}</p>
      <p class="tt-muted">${E(dt(r?.at || now()))} МСК · ${E(o.id)}</p>
      <p class="tt-muted">От имени: ${E(sender?.name || "—")}. Дальнейшие файлы и история передачи здесь не показываются.</p>
      ${btn(isExternalShell() ? "Закрыть" : "← К реестру", 'data-tt="back-list"')}
    </div>`;
  }

  function ensureDemoCodeForHolder(o) {
    state.error = "";
    state.toast = "";
    if (!o || o.status === "completed") {
      state.error = "Передача завершена — код недоступен.";
      return null;
    }
    if (!o.pendingId) {
      state.error = "Нет ожидающего получателя.";
      return null;
    }
    const actor = state.actingContactId || employeeContact(state.employeeId)?.id;
    if (o.holderId !== actor) {
      state.error = "Демо-код доступен только текущему держателю.";
      return null;
    }
    if (!holderDemoCodeAllowed(o)) {
      state.error = "Для внешнего получателя код выдаётся только в его мессенджере.";
      return null;
    }
    state.phoneVerified = true;
    state.phoneVerifiedKey = recipientKey(o);
    if (codeValid(o)) {
      state.codeDemoRevealed = true;
      return o.code;
    }
    const c = generateCode(o);
    if (c) state.codeDemoRevealed = true;
    else state.error = "Не удалось выпустить код для этой передачи.";
    return c;
  }

  function generateCode(o, opts = {}) {
    state.messengerError = "";
    if (o.status === "completed" || !o.pendingId) return null;
    if (!identityVerified(o)) {
      state.messengerError = "Сначала подтвердите номер через выбранный мессенджер.";
      return null;
    }
    const inv = o.activeInvitation;
    if (inv && state.recipientTicket?.hv != null && Number(state.recipientTicket.hv) !== inv.hv) {
      state.messengerError = "Приглашение устарело — запросите новую ссылку у отправителя.";
      return null;
    }
    const st = state.recipientTicket?.st;
    if (st && inv && !invitationTokenValid(o, inv, st)) {
      state.messengerError = "Ссылка приглашения недействительна или истекла.";
      return null;
    }
    const limit = Ms()?.CODE_ISSUE_LIMIT ?? 5;
    if (inv && inv.codeIssueCount >= limit && !opts.forceReissue) {
      state.messengerError = "Превышен лимит выдачи кодов. Попросите отправителя обновить приглашение.";
      return null;
    }
    if (o.code && codeValid(o) && !opts.forceReissue) return o.code;
    const code = String(Math.floor(100000 + Math.random() * 900000));
    o.code = {
      code,
      expiresAt: now() + CODE_TTL_MS,
      issuedAt: now(),
      attempts: 0,
      used: false,
      forContact: o.pendingId,
      channel: state.recipientChannel || null,
    };
    if (inv) inv.codeIssueCount = (inv.codeIssueCount || 0) + 1;
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
      state.error = "Сначала подтвердите номер в выбранном мессенджере.";
      return false;
    }
    if (pendingIsExternal(o)) {
      state.error = "Для внешнего получателя нужен одноразовый код из мессенджера.";
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
    const revoked = o.pendingId;
    o.timeline.push({
      at: now(),
      from: o.holderId,
      to: revoked,
      note: "Ожидание передачи отменено",
    });
    o.revokedParticipants = o.revokedParticipants || [];
    if (!o.revokedParticipants.includes(revoked)) o.revokedParticipants.push(revoked);
    o.pendingId = null;
    archiveInvitation(o);
    o.activeInvitation = null;
    o.code = null;
    resetRecipientIdentity();
    o.status =
      o.holderId === o.finalRecipientId && !orderIsCompleted(o) ? "delivered" : "active";
    state.toast = "Ожидание отменено.";
  }

  function canExplicitComplete(o, actor) {
    if (!o || !actor || o.pendingId || orderIsCompleted(o)) return false;
    if (orderIsDelivered(o)) {
      if (isExternalShell() && o.holderId === actor) return false;
      if (o.holderId === actor && !isExternalShell()) return true;
      if (o.createdById === actor) return true;
      return false;
    }
    if (o.holderId !== actor || isExternalShell()) return false;
    if (o.finalRecipientId && o.holderId !== o.finalRecipientId && !o.allowLegacyComplete) return false;
    return true;
  }

  function completeOrder(o) {
    if (orderIsCompleted(o)) return;
    const actor = state.actingContactId || employeeContact(state.employeeId)?.id;
    if (!canExplicitComplete(o, actor)) {
      state.error = "Завершить передачу сейчас нельзя.";
      return;
    }
    o.status = "completed";
    o.timeline.push({
      at: now(),
      from: actor,
      to: o.holderId,
      note: "Передача завершена",
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
    if (orderIsCompleted(o)) {
      state.error = "Завершённую передачу нельзя продолжить.";
      return;
    }
    const fromDelivered = orderIsDelivered(o);
    const prevPending = o.pendingId;
    archiveInvitation(o);
    if (prevPending && prevPending !== recipientId) {
      o.revokedParticipants = o.revokedParticipants || [];
      if (!o.revokedParticipants.includes(prevPending)) o.revokedParticipants.push(prevPending);
    }
    o.revokedParticipants = (o.revokedParticipants || []).filter((id) => id !== recipientId);
    o.pendingId = recipientId;
    if (fromDelivered) o.finalRecipientId = recipientId;
    o.status = "waiting";
    o.handoffVer = (o.handoffVer ?? 0) + 1;
    o.code = null;
    resetRecipientIdentity();
    syncInvitation(o);
    state.handoffTab = "code";
    let note = "Назначен следующий получатель";
    if (fromDelivered) {
      o.status = "active";
      const creator = o.createdById || orderCreatorId(o);
      const seenBefore = o.timeline.some((t) => t.from === recipientId || t.to === recipientId);
      note = recipientId === creator || seenBefore ? "Возврат" : "Продолжение после доставки";
    }
    o.timeline.push({
      at: now(),
      from: o.holderId,
      to: recipientId,
      note,
    });
    state.toast = fromDelivered ? "Получатель выбран — передача продолжается." : "Получатель выбран. Прежний код и QR аннулированы.";
  }

  function contactByPhone(phoneRaw) {
    const phone = normPhone(phoneRaw);
    if (!phone) return null;
    return contacts.find((c) => c.phone === phone) || null;
  }

  function contactKindLabel(c) {
    return c?.kind === "employee" ? "сотрудник" : "внешний";
  }

  function contactAddedByLabel(c) {
    if (!c || c.kind === "employee") return "справочник компании";
    const by = contactById(c.addedBy)?.name;
    return by ? `добавил ${by}` : "контакт компании";
  }

  function contactExistsBlock(c) {
    return `<div class="tt-reminder" data-tt="contact-exists">
      <p>Этот номер уже записан: <strong>${E(c.name)}</strong> · ${E(contactKindLabel(c))} · ${E(contactAddedByLabel(c))}</p>
      ${btn("Выбрать", 'data-tt="pick-existing"', "tt-primary")}
    </div>`;
  }

  function renderContactPickGrouped(list, selectedId) {
    const emps = list.filter((c) => c.kind === "employee");
    const ext = list.filter((c) => c.kind === "external");
    const btnHtml = (c) =>
      `<button type="button" data-tt-pick="${E(c.id)}" aria-pressed="${selectedId === c.id}">${E(c.name)}<br><small>${E(fmtPhone(c.phone))}</small></button>`;
    return `${emps.length ? `<p class="tt-muted">Сотрудники · справочник компании</p><div class="tt-contact-pick">${emps.map(btnHtml).join("")}</div>` : ""}${
      ext.length ? `<p class="tt-muted">Внешние контакты</p><div class="tt-contact-pick">${ext.map(btnHtml).join("")}</div>` : ""
    }`;
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

  function registryActorId() {
    return state.actingContactId || employeeContact(state.employeeId)?.id;
  }

  function syncRegistrySelection(rows) {
    const key = `${registryActorId()}|${state.ttPrototypeRole}|${state.registryPersonalView}|${cleanupPreviewReadOnly()}`;
    if (state.registrySelectionKey !== key) state.registrySelection = [];
    state.registrySelectionKey = key;
    state.registryVisibleIds = rows.map((o) => o.id);
    state.registrySelection = state.registrySelection.filter((id) =>
      !cleanupPreviewReadOnly() && state.registryVisibleIds.includes(id));
    queueMicrotask(() => {
      const all = document.querySelector('[data-tt="registry-select-all"]');
      if (all) all.indeterminate = state.registrySelection.length > 0 &&
        state.registrySelection.length < state.registryVisibleIds.length;
    });
  }

  function registryCheckbox(o, card = false) {
    if (cleanupPreviewReadOnly()) return "";
    return `<label class="tt-registry-check${card ? " tt-registry-check--card" : ""}" data-tt="registry-check-label">
      <input type="checkbox" data-tt="registry-select" value="${E(o.id)}"
        aria-label="Выбрать ${E(o.id)}: ${E(o.item)}" ${state.registrySelection.includes(o.id) ? "checked" : ""}>
      ${card ? '<span class="tt-sr-only">Выбрать передачу</span>' : ""}
    </label>`;
  }

  function registrySelectionOrders() {
    return state.registrySelection.filter((id) => state.registryVisibleIds.includes(id))
      .map((id) => orders.find((o) => o.id === id)).filter((o) => o && orderVisible(o));
  }

  function registrySelectionToolbar() {
    if (cleanupPreviewReadOnly()) return "";
    const selected = registrySelectionOrders();
    const n = selected.length;
    const all = n > 0 && n === state.registryVisibleIds.length;
    const action = (mode, label) => {
      const count = selected.filter((o) => cleanupEligible(o, mode)).length;
      return btn(`${label} (${count})`, `data-tt="registry-batch" data-mode="${mode}" ${count ? "" : "disabled"} title="${count} из ${n} выбранных доступны для действия"`,
        mode === "delete" ? "tt-cleanup-danger" : "tt-link");
    };
    const personalMode = state.registryPersonalView === "archived" ? "personal-restore" : "personal";
    const generalMode = state.registryPersonalView === "registry-archive" ? "restore" : "archive";
    return `<div class="tt-registry-selection" data-tt="registry-selection">
      <div class="tt-registry-selection-top">
        <label class="tt-registry-select-all"><input type="checkbox" data-tt="registry-select-all" ${all ? "checked" : ""} ${state.registryVisibleIds.length ? "" : "disabled"}>
          <span>Выбрать показанные</span></label>
        <span class="tt-registry-selection-count" role="status">Выбрано: ${n}</span>
      </div>
      ${n ? `<div class="tt-registry-selection-actions" role="group" aria-label="Действия с выбранными треками">
        ${state.registryPersonalView !== "registry-archive" ? action(personalMode, personalMode === "personal" ? "В мой архив" : "Восстановить мои") : ""}
        ${canManageRegistry() ? action(generalMode, generalMode === "restore" ? "Восстановить общие" : "В общий архив") : ""}
        ${canManageRegistry() || selected.some((o) => orderCreatorId(o) === registryActorId()) ? action("delete", "Удалить") : ""}
        ${btn("Снять выбор", 'data-tt="registry-selection-clear"', "tt-link")}
      </div><p>Числа на кнопках: доступные треки. Удаление только до первого получения.</p>` :
        "<p>Отметьте один или несколько треков для архивирования или удаления. Выбор действует только в текущем списке.</p>"}
    </div>`;
  }

  function paintRegistrySelection() {
    const host = document.querySelector('[data-tt="registry-selection"]');
    if (host) host.outerHTML = registrySelectionToolbar();
    document.querySelectorAll('[data-tt="registry-select"]').forEach((el) => {
      el.checked = state.registrySelection.includes(el.value);
      (el.closest(".tt-selectable-card") || el.closest("tr"))?.classList.toggle("tt-is-selected", el.checked);
    });
    const all = document.querySelector('[data-tt="registry-select-all"]');
    if (all) all.indeterminate = state.registrySelection.length > 0 &&
      state.registrySelection.length < state.registryVisibleIds.length;
  }

  function cleanupPreviewReadOnly() {
    const p = new URLSearchParams(location.hash.split("?")[1] || "");
    return state.recipientMode || state.ttRoleUnsupported ||
      p.has("as_role") || p.has("as_person") || p.get("preview") === "1";
  }

  function canManageRegistry() {
    return !cleanupPreviewReadOnly() && !isExternalShell() &&
      !state.actingContactId && state.ttPrototypeRole === "admin";
  }

  function trackNotYetReceived(o) {
    if (!o || !orderCreatorId(o) || o.holderId !== orderCreatorId(o) ||
      orderIsCompleted(o) || orderIsDelivered(o) || hasFirstConfirmedCustodyHandoff(o)) return false;
    // Old demo tracks contain narrative custody events instead of canonical receipts.
    // Treat unknown history conservatively, never as permission to erase it.
    return o.timeline.every((t) =>
      /^(Создана передача|Ожидает подтверждения получателем|Назначен следующий получатель|Ожидание передачи отменено|Изменён|Отредактирована)/.test(t.note || ""));
  }

  function canDeleteTrack(o) {
    return !cleanupPreviewReadOnly() && !!o && orderVisible(o) &&
      trackNotYetReceived(o) &&
      (registryActorId() === orderCreatorId(o) || canManageRegistry());
  }

  function cleanupEligible(o, mode) {
    if (!o || !orderVisible(o) || cleanupPreviewReadOnly()) return false;
    const actor = registryActorId();
    if (mode === "delete") return canDeleteTrack(o);
    if (mode === "restore") return canManageRegistry() && registryArchive.has(o.id);
    if (mode === "personal-restore") return !!RegPersonal()?.isArchived(o.id, actor);
    if (mode === "personal") return canPersonalArchive(o, actor) &&
      !RegPersonal()?.isArchived(o.id, actor) && !registryArchive.has(o.id);
    return canManageRegistry() && !registryArchive.has(o.id) && !o.pendingId &&
      (orderIsCompleted(o) || orderIsDelivered(o));
  }

  function cleanupCandidates(mode) {
    return orders.filter((o) => orderVisible(o) &&
      (mode === "restore" ? registryArchive.has(o.id) :
        mode === "personal-restore" ? RegPersonal()?.isArchived(o.id, registryActorId()) :
          mode === "personal" ? !RegPersonal()?.isArchived(o.id, registryActorId()) :
            !registryArchive.has(o.id)));
  }

  function cleanupTitle(mode) {
    return {
      archive: "Архивировать треки",
      restore: "Вернуть из общего архива",
      personal: "В мой архив",
      "personal-restore": "Вернуть из моего архива",
      delete: "Удалить до первого получения",
    }[mode];
  }

  function cleanupSelection() {
    const ids = state.archiveScope === "all" ? state.archiveCandidateIds : state.archiveSelection;
    return (ids || []).map((id) => orders.find((o) => o.id === id)).filter(Boolean);
  }

  function openCleanup(mode, order, selectedIds) {
    if (cleanupPreviewReadOnly()) return;
    if (["archive", "restore"].includes(mode) && !canManageRegistry()) return;
    const preselected = selectedIds ? registrySelectionOrders().filter((o) => selectedIds.includes(o.id)) : null;
    if (preselected && !preselected.some((o) => cleanupEligible(o, mode))) return;
    if (mode === "delete" && !canManageRegistry() && !canDeleteTrack(order) &&
      !preselected?.some((o) => canDeleteTrack(o))) return;
    state.archiveReturnFocus = document.activeElement?.getAttribute("data-tt") || null;
    state.archiveDialog = mode;
    state.archiveActorKey = `${registryActorId()}|${state.ttPrototypeRole}`;
    state.archiveCandidateIds = preselected ? preselected.map((o) => o.id) : order ? [order.id] : cleanupCandidates(mode).map((o) => o.id);
    state.archiveSelection = preselected ? preselected.filter((o) => cleanupEligible(o, mode)).map((o) => o.id) : order ? [order.id] : [];
    state.archiveFromRegistry = !!preselected;
    state.archiveSingle = !!order;
    state.archiveScope = "selected";
    state.archiveReason = state.archiveError = state.archiveTypedAck = "";
    state.archiveAllAck = false;
    renderTracker();
  }

  function closeCleanup() {
    const focus = state.archiveReturnFocus;
    state.archiveDialog = null;
    state.archiveError = "";
    renderTracker();
    const targets = [...document.querySelectorAll("[data-tt]")];
    (targets.find((el) => el.getAttribute("data-tt") === focus) ||
      document.querySelector('[data-tt="detail-overflow"] > summary') ||
      document.querySelector('[data-tt="cleanup-open"]'))?.focus();
  }

  function cleanupDialogHtml() {
    const mode = state.archiveDialog;
    if (!mode) return "";
    const candidates = (state.archiveCandidateIds || [])
      .map((id) => orders.find((o) => o.id === id)).filter(Boolean);
    const selected = cleanupSelection();
    const eligible = selected.filter((o) => cleanupEligible(o, mode));
    const skipped = selected.length - eligible.length;
    const personal = mode.startsWith("personal");
    const restoring = mode.includes("restore");
    const deleting = mode === "delete";
    const verb = deleting ? "Удалить" : restoring ? "Восстановить" : "Архивировать";
    const all = state.archiveScope === "all";
    const disabled = !eligible.length || (all && !state.archiveAllAck) ||
      (deleting && state.archiveTypedAck !== "УДАЛИТЬ");
    const description = deleting
      ? "Только до первого подтверждённого получения кем-либо, включая промежуточного получателя. Трек и его файлы не попадут в архив; ссылка, код и QR перестанут действовать. Восстановить удалённое нельзя."
      : restoring ? (personal ? "Треки вернутся в ваш основной список. Реестры других участников не изменятся." : "Треки вернутся в общий реестр. Статусы, маршрут и история останутся прежними.")
        : personal ? "Уберите выполненные передачи из своего рабочего списка. Другие участники продолжат видеть их как прежде; история и файлы сохранятся."
          : "Выполненные треки уйдут в общий архив. История и файлы сохранятся; восстановление доступно администратору. Активные передачи будут пропущены.";
    return `<dialog class="tt-cleanup-dialog tt-work" data-tt="cleanup-dialog" aria-labelledby="tt-cleanup-title" aria-describedby="tt-cleanup-description">
      <header class="tt-cleanup-head"><h2 id="tt-cleanup-title">${E(cleanupTitle(mode))}</h2>
        ${btn("Закрыть", 'data-tt="cleanup-cancel" autofocus', "tt-link")}</header>
      <div class="tt-cleanup-body">
        ${canManageRegistry() && !state.archiveSingle && !state.archiveFromRegistry && ["archive", "delete"].includes(mode) ? `<div class="tt-cleanup-mode" role="group" aria-label="Способ очистки">
          ${btn("Архивирование", `data-tt="cleanup-mode" data-mode="archive" aria-pressed="${mode === "archive"}"`, "tt-link")}
          ${btn("Удаление", `data-tt="cleanup-mode" data-mode="delete" aria-pressed="${mode === "delete"}"`, "tt-link")}
        </div>` : ""}
        <p id="tt-cleanup-description">${E(description)}</p>
        <p class="tt-muted">${personal ? "Демо: личный архив относится только к вашему демонстрационному профилю." : "Демо: изменения треков действуют до обновления страницы."} Боевой реестр не меняется.</p>
        ${state.archiveFromRegistry ? `<p class="tt-cleanup-selected-scope">Выбрано в реестре: <strong>${candidates.length}</strong>. Только эти треки; неподходящих: <strong>${candidates.filter((o) => !cleanupEligible(o, mode)).length}</strong>.</p>` : ""}
        ${!state.archiveSingle && !state.archiveFromRegistry ? `<fieldset class="tt-cleanup-scope"><legend>Какие треки</legend>
          <label><input type="radio" name="tt-cleanup-scope" data-tt="cleanup-scope" value="selected" ${!all ? "checked" : ""}> Выбранные</label>
          <label><input type="radio" name="tt-cleanup-scope" data-tt="cleanup-scope" value="all" ${all ? "checked" : ""}> ${personal ? "Все в моей области" : "Весь реестр"} (${candidates.length})</label>
        </fieldset><p class="tt-muted">Поиск и фильтры основного реестра не ограничивают список ниже.</p>` : ""}
        <div class="tt-cleanup-list" role="group" aria-label="Треки для действия">
        ${candidates.length ? candidates.map((o) => {
          const allowed = cleanupEligible(o, mode);
          const checked = all || state.archiveSelection.includes(o.id);
          const why = allowed ? deleting ? "Получение ещё не подтверждалось" : restoring ? "Можно восстановить" : "Выполнено, без ожидаемой передачи" :
            deleting ? "Удаление недоступно: получение уже было или история не подтверждает его отсутствие" :
              registryArchive.has(o.id) ? "Будет пропущен: уже в общем архиве" :
              o.pendingId ? "Будет пропущен: ожидается получение" : "Будет пропущен: передача ещё в работе";
          return `<label class="tt-cleanup-track${allowed ? "" : " tt-cleanup-track--skip"}">
            <input type="checkbox" data-tt="cleanup-select" value="${E(o.id)}" ${checked ? "checked" : ""} ${all || !allowed ? "disabled" : ""}>
            <span><strong>${E(o.item)}</strong><span class="tt-cleanup-track-id">${E(o.id)}</span><small>${E(why)}</small></span>
          </label>`;
        }).join("") : '<p class="tt-muted">Подходящих записей пока нет.</p>'}
        </div>
        <p class="tt-cleanup-summary" data-tt="cleanup-summary" role="status">${verb}: <strong>${eligible.length}</strong>${skipped ? ` · Будет пропущено: <strong>${skipped}</strong>` : ""}</p>
        ${!deleting && !personal && !restoring ? `<label class="tt-cleanup-field">Причина (необязательно)<textarea data-tt="cleanup-reason" maxlength="300" rows="2" placeholder="Например, тестирование завершено">${E(state.archiveReason)}</textarea></label>` : ""}
        ${all ? `<label class="tt-cleanup-ack"><input type="checkbox" data-tt="cleanup-ack" ${state.archiveAllAck ? "checked" : ""}><span>Подтверждаю действие для ${personal ? "всех подходящих треков в моей области" : "всего реестра"}, независимо от текущих фильтров. Неподходящие записи останутся без изменений.</span></label>` : ""}
        ${deleting ? `<label class="tt-cleanup-field">Для подтверждения введите УДАЛИТЬ<input data-tt="cleanup-delete-ack" value="${E(state.archiveTypedAck)}" autocomplete="off" spellcheck="false"></label>` : ""}
        ${state.archiveError ? `<p class="tt-error" role="alert">${E(state.archiveError)}</p>` : ""}
      </div>
      <footer class="tt-cleanup-footer">${btn("Отмена", 'data-tt="cleanup-cancel"', "tt-link")}
        ${btn(`${verb} (${eligible.length})`, `data-tt="cleanup-confirm" ${disabled ? "disabled" : ""}`, deleting ? "tt-cleanup-danger" : "tt-primary")}</footer>
    </dialog>`;
  }

  function updateCleanupSummary() {
    const mode = state.archiveDialog;
    if (!mode) return;
    const selected = cleanupSelection();
    const count = selected.filter((o) => cleanupEligible(o, mode)).length;
    const skipped = selected.length - count;
    const verb = mode === "delete" ? "Удалить" : mode.includes("restore") ? "Восстановить" : "Архивировать";
    const summary = document.querySelector('[data-tt="cleanup-summary"]');
    if (summary) summary.textContent = `${verb}: ${count}${skipped ? ` · Будет пропущено: ${skipped}` : ""}`;
    const button = document.querySelector('[data-tt="cleanup-confirm"]');
    if (button) {
      button.textContent = `${verb} (${count})`;
      button.disabled = !count || (state.archiveScope === "all" && !state.archiveAllAck) ||
        (mode === "delete" && state.archiveTypedAck !== "УДАЛИТЬ");
    }
  }

  function confirmCleanup() {
    const mode = state.archiveDialog;
    if (!mode || cleanupPreviewReadOnly() ||
      state.archiveActorKey !== `${registryActorId()}|${state.ttPrototypeRole}`) return;
    const selected = cleanupSelection();
    const targets = selected.filter((o) => cleanupEligible(o, mode));
    if (!targets.length || (state.archiveScope === "all" && !state.archiveAllAck) ||
      (mode === "delete" && state.archiveTypedAck !== "УДАЛИТЬ")) return;
    // Revalidate the complete selected batch immediately before changing demo state.
    if (state.archiveScope !== "all" && targets.length !== state.archiveSelection.length) {
      state.archiveError = "Состояние или доступ изменились. Закройте окно и выберите треки заново.";
      renderTracker();
      return;
    }
    const actor = registryActorId();
    targets.forEach((o) => {
      if (mode === "delete") {
        o.code = null;
        o.activeInvitation = null;
        o.pastInvitations = [];
        o.handoffVer = (o.handoffVer || 1) + 1;
        (o.attachments || []).forEach((a) => Att()?.untrackUrl(a.url));
        o.attachments = [];
        deletedTrackIds.add(o.id);
        registryArchive.delete(o.id);
        registryArchiveAudit.delete(o.id);
        RegPersonal()?.forgetOrder?.(o.id);
        orders = orders.filter((x) => x.id !== o.id);
      } else if (mode === "personal") RegPersonal()?.addArchived(o.id, actor);
      else if (mode === "personal-restore") RegPersonal()?.removeArchived(o.id, actor);
      else {
        const entry = { at: now(), actor, action: mode, reason: state.archiveReason.trim() };
        if (mode === "restore") registryArchive.delete(o.id);
        else registryArchive.set(o.id, entry);
        registryArchiveAudit.set(o.id, [...(registryArchiveAudit.get(o.id) || []), entry]);
      }
    });
    const count = targets.length;
    state.registrySelection = state.registrySelection.filter((id) => !targets.some((o) => o.id === id));
    const skipped = selected.length - count;
    state.archiveDialog = null;
    state.toast = `${mode === "delete" ? "Удалено" : mode.includes("restore") ? "Восстановлено" : "В архиве"}: ${count}.${skipped ? ` Пропущено: ${skipped}.` : ""} ${mode === "delete" ? "Старые ссылки, коды и QR недействительны." : "История и файлы сохранены."}`;
    state.error = "";
    if (mode === "delete" || state.view === "list") {
      state.view = "list";
      state.orderId = null;
      if (mode === "personal") state.registryPersonalView = "main";
      writeUrl();
    }
    renderTracker();
  }

  function registryArchiveHistory(o) {
    const entries = registryArchiveAudit.get(o.id) || [];
    if (!entries.length) return "";
    return `<details class="tt-disclosure" data-tt="registry-archive-history">
      ${disclosureSummary("История архива", { icon: "archive", count: entries.length })}
      <div class="tt-disclosure-body">${entries.map((t) => `<p><strong>${t.action === "restore" ? "Восстановлено" : "Архивировано"}</strong><br>${E(dt(t.at))} · ${E(contactById(t.actor)?.name || "Администратор")}${t.reason ? `<br>${E(t.reason)}` : ""}</p>`).join("")}</div>
    </details>`;
  }

  function archivedTrackNotice(o) {
    if (!registryArchive.has(o.id)) return "";
    return `<section class="tt-archive-notice" data-tt="archive-notice"><h3>Трек в общем архиве</h3><p>История, маршрут и файлы сохранены. Для продолжения передачи администратор должен вернуть трек в реестр.</p>${canManageRegistry() ? btn("Восстановить трек", 'data-tt="cleanup-restore-one"', "tt-primary") : ""}</section>`;
  }

  function actorHasRegistryObligation(o, actor) {
    if (!o || !actor || orderIsCompleted(o) || orderIsDelivered(o)) return false;
    if (o.holderId === actor && o.pendingId) return true;
    if (o.pendingId === actor) return true;
    return false;
  }

  function isRegistryInitiator(o, actor) {
    if (!o || !actor) return false;
    const cid = o.createdById || orderCreatorId(o);
    return cid === actor;
  }

  function actorRegistrySeesOrder(o, actor) {
    if (!o || !actor) return false;
    if (!orderVisible(o)) return false;
    if (state.actingContactId) {
      const parts = [o.holderId, o.pendingId, ...o.timeline.flatMap((t) => [t.from, t.to])];
      if (!parts.includes(state.actingContactId)) return false;
    }
    return true;
  }

  function isGeneralMainRegistry() {
    return (
      (state.registryPersonalView || "main") === "main" &&
      state.mineFilter === "all" &&
      state.statusFilter === "all" &&
      !state.query.trim()
    );
  }

  function registryPersonallyHidden(o, actor) {
    const RP = RegPersonal();
    if (!RP || !actor) return false;
    if (state.registryPersonalView === "main" && RP.isArchived(o.id, actor) &&
      !o.pendingId && (orderIsCompleted(o) || orderIsDelivered(o))) return true;
    if (!isGeneralMainRegistry()) return false;
    if (RP.isRemoved(o.id, actor) && isRegistryInitiator(o, actor)) return true;
    return false;
  }

  function registryPersonalFlagsReady() {
    const RP = RegPersonal();
    if (!RP) return true;
    const DS = window.NotificationDemoStore;
    if (!DS?.isApiEnabled?.()) return true;
    return !!RP.isHydrated?.();
  }

  function applyRegistryPersonalView(list, actor) {
    const RP = RegPersonal();
    const view = state.registryPersonalView || "main";
    if (view === "registry-archive") return list;
    if (!RP || !actor) return list;
    if (view === "archived") {
      return list.filter((o) => actorRegistrySeesOrder(o, actor) && RP.isArchived(o.id, actor) &&
        !o.pendingId && (orderIsCompleted(o) || orderIsDelivered(o)));
    }
    if (view === "removed") {
      return list.filter((o) => isRegistryInitiator(o, actor) && RP.isRemoved(o.id, actor));
    }
    return list.filter((o) => !registryPersonallyHidden(o, actor));
  }

  function canInitiatorRemoveFromRegistry(o, actor) {
    return isRegistryInitiator(o, actor);
  }

  function canPersonalArchive(o, actor) {
    return !!(o && actor && !cleanupPreviewReadOnly() && !o.pendingId &&
      (orderIsCompleted(o) || orderIsDelivered(o)) && actorRegistrySeesOrder(o, actor));
  }

  function visibleOrders() {
    const actor = registryActorId();
    let list = orders.filter((o) => orderVisible(o));
    list = list.filter((o) => state.registryPersonalView === "registry-archive"
      ? registryArchive.has(o.id) : !registryArchive.has(o.id));
    if (state.actingContactId) {
      list = list.filter((o) => {
        const parts = [o.holderId, o.pendingId, ...o.timeline.flatMap((t) => [t.from, t.to])];
        return parts.includes(state.actingContactId);
      });
    }
    if (state.mineFilter === "handoff") {
      list = list.filter(
        (o) =>
          o.holderId === actor &&
          !orderIsCompleted(o) &&
          !orderIsDelivered(o) &&
          o.finalRecipientId &&
          o.holderId !== o.finalRecipientId
      );
    }
    if (state.mineFilter === "receive") {
      list = list.filter((o) => o.pendingId === actor);
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
      if (state.statusFilter === "completed" && st !== "completed" && st !== "delivered") return false;
      if (state.statusFilter === "overdue" && !isOverdue(o)) return false;
      if (state.statusFilter === "route") {
        const ctx = registryActorContext(o, actor);
        if (ctx.key !== "route" || orderIsCompleted(o) || orderIsDelivered(o)) return false;
      }
      return true;
    });
    list = applyRegistryPersonalView(list, actor);
    return list;
  }

  function registryActivePreset() {
    if (state.mineFilter === "handoff" && state.statusFilter === "all") return "handoff";
    if (state.mineFilter === "receive" && state.statusFilter === "all") return "receive";
    if (state.mineFilter === "all" && state.statusFilter === "waiting") return "waiting";
    if (state.mineFilter === "all" && state.statusFilter === "route") return "route";
    if (state.mineFilter === "all" && state.statusFilter === "overdue") return "overdue";
    if (state.mineFilter === "all" && state.statusFilter === "completed") return "completed";
    if (state.mineFilter === "all" && state.statusFilter === "all") return "all";
    return "custom";
  }

  function registryFilterBadgeCount() {
    let n = 0;
    if (state.statusFilter !== "all") n += 1;
    if (state.mineFilter !== "all") n += 1;
    return n;
  }

  function ensureMessengerDemoConfig() {
    const raw = window.__TT_MESSENGER_DEMO__;
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) window.__TT_MESSENGER_DEMO__ = {};
    return window.__TT_MESSENGER_DEMO__;
  }

  function demoMaxSimulationToggleHtml() {
    const on = ensureMessengerDemoConfig().maxEnabled === true;
    return `<label class="tt-demo-max-row"><input type="checkbox" data-tt="demo-max-enabled"${on ? " checked" : ""}> Симуляция: MAX настроен (демо, без реальных сообщений)</label>`;
  }

  function demoHeadPopoverHtml(demoBody) {
    return `<details class="tt-demo-head-popover" data-tt="demo-settings">
      <summary class="tt-demo-head-pill">Демо</summary>
      <div class="tt-demo-popover-body">${demoBody}</div>
    </details>`;
  }

  function registryDesktopStatusChips() {
    const desktop = typeof window === "undefined" || window.innerWidth >= 1024;
    if (!desktop) return "";
    const active = registryActivePreset();
    const presets = [
      ["all", "Все"],
      ["waiting", "Ожидает код"],
      ["handoff", "Нужно передать"],
      ["receive", "Жду получения"],
      ["route", "В пути"],
      ["overdue", "Просрочено"],
      ["completed", "Завершена"],
    ];
    return `<div class="tt-registry-status-chips" data-tt="registry-status-chips" role="group" aria-label="Статус передачи">${presets
      .map(
        ([key, label]) =>
          `<button type="button" class="tt-registry-status-chip" data-tt="registry-preset" data-preset="${key}" aria-pressed="${active === key}">${E(label)}</button>`
      )
      .join("")}</div>`;
  }

  function statTileLabels() {
    const narrow = typeof window !== "undefined" && window.innerWidth < 768;
    return narrow
      ? { handoff: "Передать", receive: "Получить", overdue: "Просрочено", active: "Активные" }
      : { handoff: "Нужно передать", receive: "Жду получения", overdue: "Просрочено", active: "Всего активных" };
  }

  function writeUrl() {
    const p = new URLSearchParams(location.hash.split("?")[1] || "");
    if (state.ttPrototypeRole && !state.ttRoleUnsupported) p.set("role", state.ttPrototypeRole);
    else p.delete("role");
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
      const inv = o?.activeInvitation;
      if (inv?.startTokenPlain) p.set("tt_st", inv.startTokenPlain);
      else p.delete("tt_st");
    } else {
      p.delete("tt_view");
      p.delete("tt_order");
      p.delete("tt_hv");
      p.delete("tt_rcv");
      p.delete("tt_via");
      p.delete("tt_st");
    }
    if (state.actingContactId) p.set("tt_act", state.actingContactId);
    else p.delete("tt_act");
    const urlExtActing = state.actingContactId && contactById(state.actingContactId)?.kind === "external";
    if (state.employeeId && employees[state.employeeId] && !state.ttRoleUnsupported && !urlExtActing)
      p.set("tt_emp", state.employeeId);
    else p.delete("tt_emp");
    if (state.view !== "list") p.set("tt_screen", state.view);
    else p.delete("tt_screen");
    if (state.view === "ext-request") p.set("tt_screen", "ext-request");
    if (state.orderId && !state.recipientMode) p.set("tt_id", state.orderId);
    else if (!state.recipientMode) p.delete("tt_id");
    if (state.view === "create" && state.createPhase) p.set("tt_cphase", state.createPhase);
    else p.delete("tt_cphase");
    if (state.view === "handoff-receipt" && state.handoffReceipt) {
      p.set("tt_screen", "handoff-receipt");
      p.set(
        "tt_receipt",
        `${state.handoffReceipt.senderId}|${state.handoffReceipt.orderId}|${state.handoffReceipt.ver}`
      );
    } else {
      if (state.view !== "handoff-receipt") p.delete("tt_receipt");
    }
    history.replaceState(null, "", `#${ROUTE}?${p}`);
  }

  function readUrl() {
    const p = new URLSearchParams(location.hash.split("?")[1] || "");
    const resolved = Sc()?.resolveTanTrackerRole?.(p) || {
      unsupported: false,
      role: "manager",
      person: null,
      explicit: false,
      requested: "",
    };
    state.ttRoleUnsupported = resolved.unsupported;
    state.ttRequestedRole = resolved.requested || "";
    state.actingContactId = p.get("tt_act") || null;
    const urlExternalActing = state.actingContactId && contactById(state.actingContactId)?.kind === "external";
    const ttEmp = p.get("tt_emp");
    if (!resolved.unsupported && ttEmp && employees[ttEmp] && !urlExternalActing) {
      state.employeeId = ttEmp;
      state.ttPrototypeRole = Sc().effectiveRoleForEmployee(ttEmp);
      lastPrototypeRoleSynced = state.ttPrototypeRole;
    } else {
      state.ttPrototypeRole = resolved.unsupported ? "manager" : resolved.role || "manager";
    }
    state.recipientMode = p.get("tt_view") === "recipient";
    const oid = p.get("tt_order") || p.get("tt_id");
    if (oid) state.orderId = oid;
    else if (urlExternalActing && !p.get("tt_screen") && !state.recipientMode) {
      state.orderId = null;
      if (state.view !== "ext-request") state.view = "list";
    }
    state.recipientVia = p.get("tt_via") === "qr" ? "qr" : "code";
    if (state.recipientMode && oid) {
      state.recipientTicket = {
        hv: p.get("tt_hv"),
        rcv: p.get("tt_rcv"),
        order: oid,
        st: p.get("tt_st") || "",
      };
      resetRecipientIdentity();
      resetRecipientWelcome();
    } else state.recipientTicket = null;
    const scr = p.get("tt_screen");
    if (scr) state.view = scr;
    else if (oid && !state.recipientMode) state.view = "detail";
    if (state.recipientMode) state.view = "recipient";
    if (state.view === "handoff-receipt") {
      const ord = orders.find((x) => x.id === state.orderId);
      if (!handoffReceiptValid(ord)) {
        state.handoffReceipt = null;
        state.view = oid ? "detail" : "list";
      }
    }
    if (!(ttEmp && employees[ttEmp] && !resolved.unsupported && !urlExternalActing))
      syncEmployeeFromRole(resolved.person || null);
    if (state.view === "create") {
      const ph = p.get("tt_cphase");
      const allowed = new Set([
        "item",
        "files",
        "recipient",
        "recipient-new-name",
        "recipient-new-phone",
        "relay-pick",
        "review",
        "edit-comment",
        "edit-due",
        "edit-relay",
      ]);
      state.createPhase = ph && allowed.has(ph) ? ph : state.createPhase || "item";
      if (!state.form) state.form = defaultCreateForm();
    }
  }

  function btn(label, attrs = "", cls = "tt-link") {
    const type = /type=/.test(attrs) ? "" : 'type="button"';
    return `<button ${type} class="${cls}" ${attrs}>${E(label)}</button>`;
  }

  function overflowActionBtn(label, action, icon = "circle") {
    return `<button type="button" class="tt-detail-overflow-action" data-tt="${action}"><i data-lucide="${icon}" aria-hidden="true"></i><span>${E(label)}</span></button>`;
  }

  function wizardContactButton(c, selected) {
    return `<button type="button" class="tt-wizard-contact" data-tt-pick="${E(c.id)}" aria-pressed="${selected}">
      <span class="tt-wizard-contact-body"><span class="tt-wizard-contact-name">${E(c.name)}</span><span class="tt-wizard-contact-phone">${E(fmtPhone(c.phone))}</span></span>
      <i data-lucide="check" class="tt-wizard-contact-check" aria-hidden="true"></i>
    </button>`;
  }

  function registryPersonalToolbar() {
    const actor = registryActorId();
    const RP = RegPersonal();
    const counts = RP?.counts?.(actor) || { archived: 0, removed: 0 };
    counts.archived = orders.filter((o) => orderVisible(o) && !registryArchive.has(o.id) &&
      RP?.isArchived(o.id, actor) && !o.pendingId && (orderIsCompleted(o) || orderIsDelivered(o))).length;
    const view = state.registryPersonalView || "main";
    const link = (label, action, active) =>
      btn(label, `data-tt="${action}"`, active ? "tt-link tt-registry-personal-active" : "tt-link");
    const parts = [link(view === "main" ? "Мой реестр" : "← Основной реестр", "registry-view-main", view === "main")];
    parts.push(link(`Мой архив (${counts.archived})`, "registry-view-archived", view === "archived"));
    if (!cleanupPreviewReadOnly()) parts.push(link(
      view === "archived" ? "Вернуть в мой реестр" : "В мой архив",
      view === "archived" ? "cleanup-personal-restore" : "cleanup-personal-open", false));
    if (counts.removed > 0 || view === "removed") {
      parts.push(link(`Удалённые (${counts.removed})`, "registry-view-removed", view === "removed"));
    }
    const archivedCount = orders.filter((o) => orderVisible(o) && registryArchive.has(o.id)).length;
    const general = archivedCount || canManageRegistry()
      ? `<div class="tt-registry-personal-bar tt-registry-admin-bar" data-tt="registry-admin-bar">
        ${link(`Архив реестра (${archivedCount})`, "registry-view-general-archive", view === "registry-archive")}
        ${canManageRegistry() ? link(view === "registry-archive" ? "Восстановить треки" : "Очистить реестр",
          view === "registry-archive" ? "cleanup-restore-open" : "cleanup-open", false) : ""}
        ${canManageRegistry() && view !== "registry-archive" ? '<span class="tt-muted">Только администратор · общий реестр</span>' : ""}
      </div>` : "";
    return `<div class="tt-registry-personal-bar" data-tt="registry-personal-bar">${parts.join("")}</div>${general}`;
  }

  function registryStatTiles() {
    const c = registryCounts();
    const labels = statTileLabels();
    const filtActive = state.statusFilter !== "all" || state.mineFilter !== "all" || !!state.query.trim();
    const badge = registryFilterBadgeCount();
    const tile = (action, dim, pressed, warn, icon, label, statKey, val) =>
      `<button type="button" class="tt-stat-tile${dim ? " tt-stat-tile--dim" : ""}${warn ? " tt-stat-tile--warn" : ""}${warn && val > 0 ? " tt-stat-tile--warn-hot" : ""}" data-tt="${action}" aria-pressed="${pressed}">
        <i data-lucide="${icon}" class="tt-stat-tile-icon" aria-hidden="true"></i>
        <span class="tt-stat-tile-value" data-tt-stat="${statKey}">${val}</span>
        <span class="tt-stat-tile-label">${E(label)}</span>
      </button>`;
    return `<div class="tt-stat-tiles" data-tt="registry-stats">
      ${tile("mine-handoff", !c.handoff, state.mineFilter === "handoff", false, "send", labels.handoff, "handoff", c.handoff)}
      ${tile("mine-receive", !c.receive, state.mineFilter === "receive", false, "inbox", labels.receive, "receive", c.receive)}
      ${tile("mine-overdue", !c.overdue, state.statusFilter === "overdue", true, "alert-triangle", labels.overdue, "overdue", c.overdue)}
      <button type="button" class="tt-stat-tile tt-stat-tile--desktop-only tt-stat-tile--info" data-tt="mine-active" aria-pressed="false" tabindex="-1">
        <i data-lucide="layers" class="tt-stat-tile-icon" aria-hidden="true"></i>
        <span class="tt-stat-tile-value" data-tt-stat="active">${c.active}</span>
        <span class="tt-stat-tile-label">${E(labels.active)}</span>
      </button>
    </div>
    <div class="tt-registry-toolbar">
      <div class="tt-registry-search-wrap"><span class="tt-registry-search-icon" aria-hidden="true"><i data-lucide="search"></i></span>
        <input data-tt="search" value="${E(state.query)}" placeholder="Предмет, номер, человек" autocomplete="off">
      </div>
      <button type="button" class="tt-filter-trigger" data-tt="registry-filter-open" data-active="${filtActive}" aria-label="Фильтр статуса"><i data-lucide="sliders-horizontal"></i>${badge ? `<span class="tt-filter-badge" data-tt="filter-badge">${badge}</span>` : ""}</button>
    </div>
    ${registryPersonalToolbar()}
    ${registryDesktopStatusChips()}
    <div class="tt-toolbar tt-toolbar--legacy">
      <div class="tt-mine-filters tt-mine-filters--legacy" role="group" aria-label="Мои передачи">
        ${btn("Все", `data-tt="mine-all"${state.mineFilter === "all" ? ' aria-pressed="true"' : ""}`)}
        ${btn("У меня: нужно передать", `data-tt="mine-handoff"${state.mineFilter === "handoff" ? ' aria-pressed="true"' : ""}`)}
        ${btn("Ожидает моего получения", `data-tt="mine-receive"${state.mineFilter === "receive" ? ' aria-pressed="true"' : ""}`)}
      </div>
      <label class="tt-sr-only">Статус<select data-tt="filter">
        <option value="all">Все</option>
        <option value="waiting" ${state.statusFilter === "waiting" ? "selected" : ""}>Ожидают код</option>
        <option value="active" ${state.statusFilter === "active" ? "selected" : ""}>В работе</option>
        <option value="overdue" ${state.statusFilter === "overdue" ? "selected" : ""}>Просрочка</option>
        <option value="completed" ${state.statusFilter === "completed" ? "selected" : ""}>Завершены</option>
      </select></label>
    </div>
    ${filtActive ? `<div class="tt-registry-reset-row">${btn("Сбросить фильтры", 'data-tt="reset-filters"', "tt-link")}</div>` : ""}
    <div class="tt-filter-sheet" data-tt="registry-filter-sheet" data-open="${state.registryFilterSheet}">
      <div class="tt-filter-sheet-backdrop" data-tt="registry-filter-close"></div>
      <div class="tt-filter-sheet-panel">
        <h3>Статус</h3>
        <div class="tt-filter-chips" role="group">
          ${[
            ["all", "Все"],
            ["waiting", "Ожидает код"],
            ["handoff", "Нужно передать"],
            ["receive", "Жду получения"],
            ["route", "В пути"],
            ["overdue", "Просрочено"],
            ["completed", "Завершена"],
          ]
            .map(
              ([key, label]) =>
                `<button type="button" class="tt-filter-chip" data-tt="registry-preset" data-preset="${key}" aria-pressed="${registryActivePreset() === key}">${E(label)}</button>`
            )
            .join("")}
        </div>
        ${btn("Готово", 'data-tt="registry-filter-close"', "tt-primary")}
      </div>
    </div>`;
  }

  function registryPersonalLoadingView() {
    return `<div class="tt-registry tt-view-enter" data-tt="registry-personal-loading">
      <p class="tt-muted">Загрузка вашего реестра…</p>
    </div>`;
  }

  function registryView() {
    const rows = visibleOrders();
    syncRegistrySelection(rows);
    return `<div class="tt-registry tt-view-enter" data-tt="registry-shell" data-tt-registry-personal-ready="true">
      ${registryStatTiles()}
      ${registrySelectionToolbar()}
      ${state.toast ? `<p class="tt-success" data-tt="cleanup-result" role="status">${E(state.toast)}</p>` : ""}
      ${state.registryPersonalView === "registry-archive" ? '<p class="tt-muted">Общий архив. История и файлы доступны в рамках ваших обычных прав; восстановление доступно администратору.</p>' : ""}
      ${state.registryPersonalView === "archived" ? '<p class="tt-muted">Только ваш архив. Другие участники видят передачи как прежде; историю и файлы можно открыть в карточке.</p>' : ""}
      ${
        rows.length
          ? `<div class="tt-table-scroll" tabindex="0" aria-label="Реестр передач"><table class="tt-table tt-table-v2" data-tt="registry"><thead><tr>
      ${!cleanupPreviewReadOnly() ? '<th class="tt-selection-cell"><span class="tt-sr-only">Выбор</span></th>' : ""}<th>Передача</th><th>Маршрут</th><th>Статус</th><th>Срок</th>
    </tr></thead><tbody id="tt-registry-body">${registryRowsHtml(rows)}</tbody></table></div>
    <div class="tt-cards" data-tt="cards"><div data-tt="registry-sections">${registryCardsHtml(rows)}</div></div>`
          : registryEmptyHtml()
      }
      <button type="button" class="tt-primary tt-fab" data-tt="create-fab"><i data-lucide="plus"></i><span class="tt-fab-label">Создать передачу</span></button>
    </div>`;
  }

  function createView() {
    const f = state.form || defaultCreateForm();
    state.form = f;
    const phase = state.createPhase || "item";
    const holder = employeeContact(state.employeeId);
    const pick = contacts.filter((c) => {
      if (c.id === holder?.id) return false;
      const q = (f.pickQ || "").toLowerCase();
      if (!q) return true;
      return (c.name + c.phone + fmtPhone(c.phone)).toLowerCase().includes(q);
    });

    if (phase === "item") {
      const itemActions =
        state.createReturnPhase === "review"
          ? `${wizardBtn("Готово", "create-wizard-next", true)}${wizardBtn("Назад", "create-wizard-back")}`
          : `${wizardBtn("Далее", "create-wizard-next", true)}${wizardBtn("Отмена", "back-list")}`;
      return wizardShell(
        phase,
        "Что передаём",
        "Опишите одним предложением, что вы передаёте другому человеку.",
        `<label class="tt-wizard-field">Предмет или документ<input data-tt-field="item" value="${E(f.item)}" placeholder="Например: договор, ключи, образцы ткани" autocomplete="off"></label>
        <div class="tt-item-suggest" data-tt="item-suggest">${["Договор", "Акт", "Ключи", "Образцы", "Коробка"]
          .map((s) => `<button type="button" data-tt="item-suggest" data-suggest="${E(s)}">${E(s)}</button>`)
          .join("")}</div>`,
        itemActions
      );
    }
    if (phase === "files") {
      const hasFiles = state.attachStaging.length > 0;
      const fileActions = hasFiles
        ? `${wizardBtn("Далее", "create-wizard-next", true)}${wizardBtn("Назад", "create-wizard-back")}`
        : `${wizardBtn("Пропустить", "create-skip-files", true)}${wizardBtn("Назад", "create-wizard-back")}`;
      return wizardShell(
        phase,
        "Фото и файлы",
        "Покажите, как выглядит передача. Можно пропустить, если уже всё понятно.",
        createAttachmentsSection(),
        fileActions
      );
    }
    if (phase === "recipient") {
      ensureRecipientStep(f);
      const sel = f.finalRecipientId || f.recipientId;
      let body = "";
      let actions = `${wizardBtn("Назад", "create-wizard-back")}`;
      if (f.recipientStep === "pick-list") {
        body = `${wizardReviewLink("← К выбору способа", "create-recipient-back-choose", "Вернуться к выбору способа", true)}${wizardContactPickList(f, { selectedId: sel })}`;
        actions = `${wizardBtn("Далее", "create-wizard-next", true)}${wizardBtn("Назад", "create-wizard-back")}`;
      } else if (f.recipientStep === "confirmed" && sel) {
        body = wizardRecipientSelectedCard(sel);
        actions = `${wizardBtn("Далее", "create-wizard-next", true)}${wizardBtn("Назад", "create-wizard-back")}`;
      } else {
        f.recipientStep = "choose";
        body = wizardRecipientChooseBody();
      }
      return wizardShell(
        phase,
        "Кому нужно доставить",
        "Конечный получатель — клиент или человек, которому должны передать предмет.",
        body,
        actions
      );
    }
    if (phase === "relay-pick") {
      const finPick = contactById(f.finalRecipientId || f.recipientId);
      const relayHint = finPick
        ? `Шаг 3 из 4 · водитель или коллега примет предмет. Доставить нужно получателю: ${finPick.name}.`
        : "Шаг 3 из 4 · кто примет предмет и передаст его конечному получателю.";
      return wizardShell(
        phase,
        "Кому отдадите для дальнейшей передачи",
        relayHint,
        `${wizardContactPickList(f, { relay: true, selectedId: f.relayId })}`,
        `${wizardBtn("Готово", "create-wizard-next", true)}${wizardBtn("Назад", "create-wizard-back")}`
      );
    }
    if (phase === "recipient-new-name") {
      return wizardShell(
        phase,
        "Имя нового получателя",
        "Шаг 3 из 4 · как зовут человека, которому передаёте.",
        `<span class="tt-badge" data-tt="contact-new">Новый контакт</span><label class="tt-wizard-field">Имя и фамилия<input data-tt-field="newName" value="${E(f.newName)}" placeholder="Например: Сергей Приёмка"></label>`,
        `${wizardBtn("Далее", "create-wizard-next", true)}${wizardBtn("Назад", "create-wizard-back")}`
      );
    }
    if (phase === "recipient-new-phone") {
      const existing = f.existingMatchId ? contactById(f.existingMatchId) : null;
      return wizardShell(
        phase,
        "Телефон получателя",
        "Шаг 3 из 4 · сначала номер — мы проверим, есть ли контакт.",
        `<label class="tt-wizard-field">Телефон<input inputmode="tel" data-tt-field="newPhone" value="${E(f.newPhone)}" placeholder="+7 900 000 00 00"></label>${existing ? contactExistsBlock(existing) : ""}`,
        `${existing ? wizardBtn("Выбрать", "pick-existing-wizard", true) : wizardBtn("Далее", "create-wizard-next", true)}${wizardBtn("Назад", "create-wizard-back")}`
      );
    }
    if (phase === "edit-comment") {
      return wizardShell(
        phase,
        "Комментарий",
        "Необязательно · пояснение для получателя.",
        `<label class="tt-wizard-field">Комментарий<textarea data-tt-field="comment" rows="4" placeholder="Необязательно">${E(f.comment)}</textarea></label>`,
        `${wizardBtn("Готово", "create-wizard-next", true)}${wizardBtn("Назад", "create-wizard-back")}`
      );
    }
    if (phase === "edit-due") {
      return wizardShell(
        phase,
        "До какого срока доставить",
        "Необязательно · срок для конечного получателя.",
        `<label class="tt-wizard-field">Дата и время<input type="datetime-local" data-tt-field="due" value="${E(f.due)}"></label>`,
        `${wizardBtn("Готово", "create-wizard-next", true)}${wizardBtn("Назад", "create-wizard-back")}`
      );
    }
    const attCount = state.attachStaging.length;
    const attLabel = attCount ? `${attCount} файл(ов)` : "Без файлов";
    const relay = f.relayId ? contactById(f.relayId) : null;
    const finId = f.finalRecipientId || f.recipientId;
    const finContact = finId ? contactById(finId) : null;
    const finSummary = recipientSummary(f);
    const dueValue = f.due ? f.due.replace("T", " · ") : "";
    const reviewBody = `<div class="tt-wizard-review" data-tt="wizard-review">
      <header class="tt-wizard-review-hero">
        <div class="tt-wizard-review-hero-head">
          <span class="tt-wizard-review-kicker">Предмет</span>
          ${wizardReviewLink("Изменить предмет", "create-edit-item", "Изменить предмет")}
        </div>
        <h3 class="tt-wizard-review-item-title">${E(f.item)}</h3>
      </header>
      ${wizardReviewRouteNav(f, finContact, finSummary, relay)}
      <section class="tt-wizard-review-due${f.due ? " tt-wizard-review-due--set" : " tt-wizard-review-due--empty"}">
        <div class="tt-wizard-review-block-head">
          <span class="tt-wizard-review-person-label">Срок доставки</span>
          ${wizardReviewLink(f.due ? "Изменить срок доставки" : "Указать срок доставки", "create-edit-due", f.due ? "Изменить срок доставки" : "Указать срок доставки")}
        </div>
        <p class="tt-wizard-review-due-value">${f.due ? E(dueValue) : "Срок не указан"}</p>
      </section>
      <section class="tt-wizard-review-details" aria-label="Дополнительно">
        <div class="tt-wizard-review-detail-row">
          <div class="tt-wizard-review-block-head">
            <span class="tt-wizard-review-detail-label">Фото и файлы</span>
            ${wizardReviewLink(attCount ? "Изменить фото и файлы" : "Добавить фото или файл", "create-edit-files", attCount ? "Изменить фото и файлы" : "Добавить фото или файл")}
          </div>
          <p class="tt-wizard-review-detail-value">${E(attLabel)}</p>
        </div>
        <div class="tt-wizard-review-detail-row">
          <div class="tt-wizard-review-block-head">
            <span class="tt-wizard-review-detail-label">Комментарий</span>
            ${wizardReviewLink(f.comment ? "Изменить комментарий" : "Добавить комментарий", "create-edit-comment", f.comment ? "Изменить комментарий" : "Добавить комментарий")}
          </div>
          <p class="tt-wizard-review-detail-value">${f.comment ? E(f.comment) : "Не указан"}</p>
        </div>
      </section>
    </div>`;
    const editing = !!state.editOrderId;
    return wizardShell(
      "review",
      editing ? "Проверить и сохранить" : "Проверить и создать",
      editing
        ? "Изменения сохраняются в той же передаче (тот же ID и инициатор). Любое сохранение аннулирует действующий код, ссылку и QR — получателю нужен новый код."
        : "Убедитесь, что всё верно, затем нажмите «Создать передачу».",
      reviewBody,
      editing
        ? `${wizardBtn("Сохранить изменения", "create-wizard-submit", true)}${wizardBtn("Отмена", "order-edit-cancel", false, "tt-wizard-btn-quiet")}`
        : `${wizardBtn("Создать передачу", "create-wizard-submit", true)}${wizardBtn("Назад", "create-wizard-back", false, "tt-wizard-btn-quiet")}`
    );
  }

  function contactInitials(c) {
    if (!c?.name) return "?";
    const parts = c.name.trim().split(/\s+/).filter(Boolean);
    if (parts.length >= 2) return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
    return parts[0].slice(0, 2).toUpperCase();
  }

  function routeStepperNode(c, roleEyebrow, variant, planned, showLine) {
    const phoneCore = c?.phone ? fmtPhoneCore(c.phone) : "";
    const telDigits = c?.phone ? normPhone(c.phone) : "";
    const phoneHtml =
      telDigits && c?.phone
        ? `<span class="tt-route-phone-line"><a class="tt-route-phone" href="tel:+${E(telDigits)}" data-tt="route-phone">${E(phoneCore)}</a><span class="tt-route-phone-suffix"> · демо</span></span>`
        : `<span class="tt-route-phone">${phoneCore ? E(phoneCore) : "—"}</span>`;
    const plannedChip = planned
      ? `<span class="tt-route-planned" data-tt="route-planned">План · ждёт подтверждения</span>`
      : "";
    const avSize = variant === "current" ? " tt-avatar--lg tt-avatar--current" : " tt-avatar--lg";
    return `<article class="tt-route-stepper-node tt-route-node tt-route-node--${variant}" data-tt="route-node" data-tt-route-variant="${variant}">
      <div class="tt-route-stepper-rail">${contactAvatarHtml(c, avSize)}${showLine ? '<span class="tt-route-stepper-line" aria-hidden="true"></span>' : ""}</div>
      <div class="tt-route-stepper-body">
        <span class="tt-route-label tt-route-role">${E(roleEyebrow)}</span>
        ${plannedChip}
        <strong class="tt-route-name">${E(c?.name || "—")}</strong>
        ${phoneHtml}
      </div>
    </article>`;
  }

  function detailRouteGrid(o) {
    const h = contactById(o.holderId);
    const p = o.pendingId ? contactById(o.pendingId) : null;
    const fin = o.finalRecipientId ? contactById(o.finalRecipientId) : null;
    const nodes = [];
    let nodeCount = 0;

    if (o.status === "completed" || o.status === "delivered") {
      const delivered = contactById(o.holderId);
      nodeCount = 1;
      nodes.push(routeStepperNode(delivered, "Доставлено · конечный получатель", "delivered", false, false));
      const horizontalDone = typeof window !== "undefined" && window.innerWidth >= 1024;
      return `<div class="tt-route-stepper${horizontalDone ? " tt-route-stepper--horizontal" : ""}" data-tt="detail-route-grid" data-tt-route-nodes="${nodeCount}">${nodes.join("")}</div>`;
    }

    nodes.push(routeStepperNode(h, "Сейчас у · ответственный", "current", false, !!(o.pendingId || (fin && o.holderId !== o.finalRecipientId))));
    nodeCount = 1;

    if (o.pendingId) {
      if (fin && o.pendingId === o.finalRecipientId) {
        nodes.push(routeStepperNode(p, "Следующий · конечный получатель", "pending", true, false));
        nodeCount += 1;
      } else {
        const hasFinAfter = !!(fin && o.pendingId !== o.finalRecipientId);
        nodes.push(routeStepperNode(p, "Следующий получатель", "pending", true, hasFinAfter));
        nodeCount += 1;
        if (hasFinAfter) {
          nodes.push(routeStepperNode(fin, "Конечный получатель", "final", false, false));
          nodeCount += 1;
        }
      }
    } else if (fin && o.holderId !== o.finalRecipientId) {
      nodes.push(routeStepperNode(fin, "Конечный получатель", "final", false, false));
      nodeCount += 1;
    }

    const horizontal = typeof window !== "undefined" && window.innerWidth >= 1024;
    return `<div class="tt-route-stepper${horizontal ? " tt-route-stepper--horizontal" : ""}" data-tt="detail-route-grid" data-tt-route-nodes="${nodeCount}">${nodes.join("")}</div>`;
  }

  function disclosureSummary(titleHtml, opts = {}) {
    const icon = opts.icon ? `<i class="tt-disclosure-icon" data-lucide="${opts.icon}" aria-hidden="true"></i>` : "";
    const count =
      opts.count != null && opts.count !== ""
        ? `<span class="tt-disclosure-count" aria-label="Количество: ${opts.count}">${E(String(opts.count))}</span>`
        : "";
    return `<summary><span class="tt-disclosure-title">${icon}<span class="tt-disclosure-title-text">${titleHtml}</span>${count}</span></summary>`;
  }

  function detailRouteDisclosure(o) {
    const w = typeof window !== "undefined" ? window.innerWidth : 1440;
    const openDefault = w >= 1024;
    return `<details class="tt-disclosure tt-detail-route-wrap${openDefault ? " tt-route-default-open" : ""}" data-tt="detail-route-disclosure"${openDefault ? " open" : ""}>
      ${disclosureSummary("Маршрут и контакты", { icon: "route" })}
      <div class="tt-disclosure-body tt-detail-route">${detailRouteGrid(o)}</div>
    </details>`;
  }

  function detailNotesDisclosure(o) {
    if (!o.qty && !o.comment) return "";
    const parts = [];
    if (o.qty) {
      parts.push(
        `<p class="tt-detail-note-line"><span class="tt-detail-note-label">Количество</span> <span class="tt-detail-note-value">${E(o.qty)}</span></p>`
      );
    }
    if (o.comment) {
      parts.push(`<p class="tt-detail-note-line tt-detail-note-comment">${E(o.comment)}</p>`);
    }
    const summary = o.comment ? "Комментарий и детали" : "Детали передачи";
    return `<details class="tt-disclosure tt-detail-notes" data-tt="detail-notes-disclosure">
      ${disclosureSummary(E(summary), { icon: "message-square" })}
      <div class="tt-disclosure-body">${parts.join("")}</div>
    </details>`;
  }

  function detailMobilePrimaryDock(o) {
    const actor = state.actingContactId || employeeContact(state.employeeId)?.id;
    const isHolder = o.holderId === actor;
    const heroAttr = 'data-tt-detail-hero-primary=""';
    if (o.status === "completed" || !isHolder) return "";
    if (o.pendingId) {
      return `<div class="tt-detail-dock" data-tt="detail-mobile-dock" hidden>${btn("Ввести код", `data-tt="enter-code-dock" ${heroAttr}`, "tt-primary")}</div>`;
    }
    if (orderIsDelivered(o)) {
      // Доставка — веха: держатель может передать дальше; закрыть трек из дока внешний держатель не может.
      if (isExternalShell()) return "";
      return `<div class="tt-detail-dock" data-tt="detail-mobile-dock" hidden>${btn("Передать дальше", `data-tt="transfer" ${heroAttr}`, "tt-primary")}</div>`;
    }
    const canComplete = canExplicitComplete(o, actor);
    const mustRelay = o.finalRecipientId && o.holderId !== o.finalRecipientId;
    if (mustRelay && !o.pendingId) {
      return `<div class="tt-detail-dock" data-tt="detail-mobile-dock" hidden>${btn("Передать конечному получателю", `data-tt="transfer-final" ${heroAttr}`, "tt-primary")}</div>`;
    }
    if (canComplete && state.completeConfirmOrderId !== o.id) {
      return `<div class="tt-detail-dock" data-tt="detail-mobile-dock" hidden>${btn("Завершить передачу", `data-tt="complete" ${heroAttr}`, "tt-primary")}</div>`;
    }
    return "";
  }

  function detailFactsCard(o, actor) {
    const creator = contactById(o.createdById);
    const duePhrase = detailDuePhrase(o);
    const dueHuman = humanDueLabel(o);
    const dueCls = dueHuman.overdue ? "tt-due-overdue" : "tt-due-line";
    const extBadge =
      o.fromExternal && !isExternalShell() ? `<span class="tt-badge" data-tt="from-external">От внешнего</span> ` : "";
    const rows = [
      `<div class="tt-detail-fact-row"><span class="tt-detail-fact-label">Статус</span><span class="tt-detail-fact-value">${extBadge}${statusBadge(o, actor)}</span></div>`,
      `<div class="tt-detail-fact-row"><span class="tt-detail-fact-label">Срок</span><span class="tt-detail-fact-value ${dueCls}">${E(duePhrase)}</span></div>`,
    ];
    if (o.qty) rows.push(`<div class="tt-detail-fact-row"><span class="tt-detail-fact-label">Количество</span><span class="tt-detail-fact-value">${E(o.qty)}</span></div>`);
    if (o.comment) rows.push(`<div class="tt-detail-fact-row tt-detail-fact-row--block"><span class="tt-detail-fact-label">Комментарий</span><p class="tt-detail-fact-comment">${E(o.comment)}</p></div>`);
    rows.push(
      `<div class="tt-detail-fact-row"><span class="tt-detail-fact-label">Создатель</span><span class="tt-detail-fact-value">${E(creator?.name || "—")}</span></div>`,
      `<div class="tt-detail-fact-row"><span class="tt-detail-fact-label">Номер</span><span class="tt-detail-fact-value tt-detail-fact-mono">${E(o.id)}</span></div>`
    );
    return `<section class="tt-detail-facts-card" data-tt="detail-facts">
      <h3 class="tt-detail-aside-heading">Сведения</h3>
      <div class="tt-detail-facts-body">${rows.join("")}</div>
    </section>`;
  }

  function detailHistoryHtml(o, tl, desktopPanel) {
    const entries = tl
      .map((t) => {
        const fr = contactById(t.from);
        const to = contactById(t.to);
        return `<div class="tt-timeline-entry"><time class="tt-timeline-when" datetime="">${E(dt(t.at))}</time><strong class="tt-timeline-route">${E(fr?.name || "?")} → ${E(to?.name || "?")}</strong><span class="tt-timeline-note">${E(t.note)}</span></div>`;
      })
      .join("");
    const body = `<div class="tt-timeline" data-tt="timeline">${entries}</div>`;
    if (desktopPanel) {
      return `<section class="tt-detail-history-panel" data-tt="history-panel">
        <h3 class="tt-detail-aside-heading">История передачи${tl.length ? `<span class="tt-disclosure-count">${tl.length}</span>` : ""}</h3>
        <div class="tt-detail-history-body">${body}</div>
      </section>`;
    }
    return `<details class="tt-disclosure tt-history" data-tt="history-disclosure">
      ${disclosureSummary("История передачи", { icon: "history", count: tl.length || null })}
      <div class="tt-disclosure-body tt-detail-history-body">${body}</div>
    </details>`;
  }

  function shortRelayReminder(o, p, isHolder, mustRelay) {
    if (!isHolder || !mustRelay || orderIsCompleted(o) || orderIsDelivered(o)) return "";
    const text = o.pendingId
      ? `Ждём подтверждения от ${p?.name || "получателя"} — вы ответственны.`
      : `Передайте ${contactById(o.finalRecipientId)?.name || "конечному получателю"}.`;
    return `<p class="tt-reminder tt-reminder-compact tt-holder-next" data-tt="relay-reminder">${E(text)}</p>`;
  }

  function isConfirmedHandoffTimelineNote(note) {
    return /Подтверждено (одноразовым кодом|по QR)/.test(note || "");
  }

  function hasFirstConfirmedCustodyHandoff(o) {
    return o.timeline.some((t) => isConfirmedHandoffTimelineNote(t.note));
  }

  function orderCreatorId(o) {
    if (o?.createdById) return o.createdById;
    const created = o?.timeline?.find((t) => /Создана передача/.test(t.note || ""));
    return created?.from || null;
  }

  function orderHasRelayLeg(o) {
    return !!(o.finalRecipientId && o.pendingId && o.pendingId !== o.finalRecipientId);
  }

  function canFullEditOrder(o, actor) {
    if (!o || !actor || o.status === "completed") return false;
    if (o.holderId !== actor) return false;
    if (orderCreatorId(o) !== actor) return false;
    if (hasFirstConfirmedCustodyHandoff(o)) return false;
    return true;
  }

  function dueInputFromTs(ts) {
    if (!ts) return "";
    const d = new Date(ts);
    const pad = (n) => String(n).padStart(2, "0");
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
  }

  function orderToCreateForm(o) {
    const relay = orderHasRelayLeg(o);
    const fin = o.finalRecipientId || o.pendingId || "";
    return {
      item: o.item,
      comment: o.comment || "",
      due: dueInputFromTs(o.dueAt),
      finalRecipientId: fin,
      recipientId: fin,
      relayId: relay ? o.pendingId : "",
      pickQ: "",
      newName: "",
      newPhone: "",
      mode: "list",
      pickTarget: "final",
      recipientStep: "confirmed",
    };
  }

  function loadOrderAttachmentsToStaging(o) {
    if (!Att()) return;
    Att().revokeStaging(state.attachStaging);
    state.attachStaging = (o.attachments || []).map((a) => ({ ...a }));
  }

  function applyAttachmentsFromStaging(o, actorId) {
    if (!Att()) return;
    const next = state.attachStaging.map((s) => ({
      ...s,
      addedBy: s.addedBy || actorId,
      addedAt: s.addedAt || now(),
    }));
    const drop = (o.attachments || []).filter((a) => !next.some((n) => n.id === a.id));
    if (drop.length) Att().revokeStaging(drop);
    o.attachments = next;
  }

  function lastConfirmedHandoffEntry(o) {
    return (
      o.timeline
        .filter((t) => isConfirmedHandoffTimelineNote(t.note))
        .sort((a, b) => a.at - b.at)
        .pop() || null
    );
  }

  function actorHasConfirmedOutboundHandoff(o, actor) {
    return o.timeline.some((t) => t.from === actor && isConfirmedHandoffTimelineNote(t.note));
  }

  function isFormerHolderAfterHandoff(o, actor) {
    if (!actor || o.status === "completed" || o.holderId === actor) return false;
    return actorHasConfirmedOutboundHandoff(o, actor);
  }

  function deliveryTargetContact(o) {
    if (o.finalRecipientId) return contactById(o.finalRecipientId);
    return null;
  }

  function isDeliveryVerificationEntry(t, recipientId) {
    if (!recipientId || t.to !== recipientId) return false;
    return (
      isConfirmedHandoffTimelineNote(t.note) || /Доставлено конечному получателю/.test(t.note || "")
    );
  }

  function verifiedDeliveryConfirmationEntry(o) {
    const recipientId = o.holderId;
    if (!recipientId) return null;
    return (
      o.timeline
        .filter((t) => isDeliveryVerificationEntry(t, recipientId))
        .sort((a, b) => a.at - b.at)
        .pop() || null
    );
  }

  function hasVerifiedDeliveryConfirmation(o) {
    return !!verifiedDeliveryConfirmationEntry(o);
  }

  function completedTerminalAudience(o, actor) {
    if (!actor) return "observer";
    const finId = o.finalRecipientId || o.holderId;
    const isContributor = o.createdById === actor || actorHasConfirmedOutboundHandoff(o, actor);
    const isFinalRecipient = finId === actor || o.holderId === actor;
    if (isContributor) return "contributor";
    if (isFinalRecipient) return "recipient";
    return "observer";
  }

  function completedTaskCard(o, actor) {
    const custodian = contactById(o.holderId);
    const audience = completedTerminalAudience(o, actor);
    const verified = hasVerifiedDeliveryConfirmation(o);
    const lastConfirm = verifiedDeliveryConfirmationEntry(o);
    const confirmLine =
      verified && lastConfirm
        ? `<div class="tt-detail-monitor-row"><span class="tt-detail-monitor-label">Подтверждение получения</span><span class="tt-detail-monitor-value">${E(dt(lastConfirm.at))}</span></div>`
        : "";
    let body = "";
    if (audience === "contributor") {
      body = `<p class="tt-detail-done" data-tt="detail-completed" data-tt-terminal-audience="contributor">Вы свою часть выполнили. Передача завершена. Больше ничего делать не нужно.</p>`;
    } else if (audience === "recipient") {
      body = `<p class="tt-detail-done" data-tt="detail-completed" data-tt-terminal-audience="recipient">Вы получили предмет. Передача завершена — сохраните результат для себя.</p>`;
    } else {
      body = `<p class="tt-detail-done" data-tt="detail-completed" data-tt-terminal-audience="observer">Передача закрыта. Доступен только просмотр истории и материалов.</p>`;
    }
    return `<section class="tt-detail-task-card tt-detail-task-card--terminal" data-tt="detail-task-card">
      <div class="tt-terminal-icon tt-terminal-icon--enter" aria-hidden="true"><i data-lucide="check-circle"></i></div>
      <h3 class="tt-detail-task-heading">Передача завершена</h3>
      ${body}
      <div class="tt-detail-monitor tt-detail-monitor--terminal" data-tt="detail-terminal-monitor">
        <div class="tt-detail-monitor-row"><span class="tt-detail-monitor-label">У кого сейчас предмет</span><span class="tt-detail-monitor-value"><strong>${E(custodian?.name || "—")}</strong></span></div>
        ${confirmLine}
      </div>
      <div class="tt-detail-primary" data-tt="detail-terminal-nav">${btn("Вернуться к передачам", 'data-tt="terminal-back-list"', "tt-primary tt-btn-block")}</div>
    </section>`;
  }

  function formerHolderTaskCard(o) {
    const h = contactById(o.holderId);
    const fin = deliveryTargetContact(o);
    const last = lastConfirmedHandoffEntry(o);
    const finLine = fin
      ? `<div class="tt-detail-monitor-row"><span class="tt-detail-monitor-label">Куда доставляют</span><span class="tt-detail-monitor-value">${E(fin.name)}</span></div>`
      : "";
    const lastLine = last
      ? `<div class="tt-detail-monitor-row"><span class="tt-detail-monitor-label">Последнее подтверждение</span><span class="tt-detail-monitor-value">${E(dt(last.at))}</span></div>`
      : "";
    return `<section class="tt-detail-task-card tt-detail-task-card--former" data-tt="detail-task-former">
      <h3 class="tt-detail-task-heading">Вы передали предмет</h3>
      <p class="tt-detail-task-instructions">Ваш этап завершён. От вас больше не требуется действий.</p>
      <p class="tt-detail-task-follow">Далее за передачу отвечает <strong>${E(h?.name || "—")}</strong>.</p>
      <div class="tt-detail-monitor" data-tt="detail-monitor">
        <div class="tt-detail-monitor-row"><span class="tt-detail-monitor-label">У кого сейчас предмет</span><span class="tt-detail-monitor-value"><strong>${E(h?.name || "—")}</strong></span></div>
        <div class="tt-detail-monitor-row"><span class="tt-detail-monitor-label">Статус</span><span class="tt-detail-monitor-value tt-detail-monitor-status">${statusBadge(o)}</span></div>
        ${finLine}
        ${lastLine}
      </div>
    </section>`;
  }

  function pendingHandoffPanel(o, p, actor) {
    if (!o.pendingId || !o.activeInvitation) return "";
    const heroAttr = 'data-tt-detail-hero-primary=""';
    const fullEdit = canFullEditOrder(o, actor);
    const tab = state.handoffTab || "code";
    const inv = o.activeInvitation;
    const payload = handoffUrl(o, inv);
    const qrBlock =
      tab === "qr"
        ? `<div class="tt-handoff-qr" data-tt="handoff-qr">
        <div class="tt-qr-wrap" data-tt="qr-host" data-payload="${E(payload)}"></div>
        <p class="tt-muted tt-qr-note">Получатель может отсканировать QR в демо — откроется экран подтверждения в этом окне. Передача завершится только после успешного кода или QR.</p>
        ${btn("Сканировать QR (демо)", 'data-tt="scan-qr-demo"', "tt-detail-alt-action")} ${btn("Скрыть QR", 'data-tt="tab-code"', "tt-detail-alt-action")}
      </div>`
        : "";
    if (isExternalShell() && o.holderId === actor && !pendingIsExternal(o)) {
      // Внешний держатель передаёт сотруднику: без персональной ссылки и правки трека — только код/QR и смена получателя.
      return `<section class="tt-detail-task-card tt-detail-task-card--hero" data-tt="detail-task-card">
        <h3 class="tt-detail-task-heading">Передайте предмет</h3>
        <p class="tt-detail-task-receiver">Кому: <strong>${E(p?.name || "—")}</strong>${p?.phone ? ` · ${E(fmtPhone(p.phone))}` : ""}</p>
        <p class="tt-detail-task-instructions">${
          o.dueAt ? `Срок: до ${E(dt(o.dueAt))}. ` : ""
        }Сотрудник уже уведомлён. При встрече он назовёт 6-значный код или покажет QR — введите код здесь, и ответственность за предмет перейдёт ему.</p>
        <div class="tt-handoff" data-tt="handoff-panel">
          <div class="tt-handoff-actions">
            ${btn("Ввести код", `data-tt="enter-code" ${heroAttr}`, "tt-primary tt-btn-block")}
            ${tab === "qr" ? "" : btn("QR-код", 'data-tt="tab-qr"', "tt-detail-alt-action")}
          </div>
          ${qrBlock}
        </div>
        ${
          fullEdit
            ? `<div class="tt-handoff-recover" data-tt="handoff-recover">
          ${btn("Сменить получателя", 'data-tt="change-pending"', "tt-detail-alt-action")}
          <p class="tt-muted">Пока код не подтверждён, предмет числится за вами.</p>
        </div>`
            : ""
        }
      </section>`;
    }
    return `<section class="tt-detail-task-card tt-detail-task-card--hero" data-tt="detail-task-card">
      <h3 class="tt-detail-task-heading">Подтвердите передачу</h3>
      <p class="tt-detail-task-receiver">Получатель: <strong>${E(p?.name || "—")}</strong></p>
      <p class="tt-detail-task-instructions">${
        pendingIsExternal(o)
          ? "Отправьте персональную ссылку или QR. Получатель без ЛК выберет Telegram или MAX, подтвердит свой номер в боте и сообщит вам одноразовый код."
          : "Попросите получателя открыть передачу и получить код. Введите его здесь, затем отдайте предмет."
      }</p>
      <div class="tt-handoff" data-tt="handoff-panel">
        ${invitationLinkBlock(o)}
        <div class="tt-handoff-actions">
          ${btn("Ввести код", `data-tt="enter-code" ${heroAttr}`, "tt-primary tt-btn-block")}
          ${tab === "qr" ? "" : btn("QR-код", 'data-tt="tab-qr"', "tt-detail-alt-action")}
        </div>
        ${qrBlock}
      </div>
      ${
        fullEdit
          ? `<div class="tt-handoff-recover" data-tt="handoff-recover">
        ${btn("Изменить передачу", 'data-tt="order-full-edit"', "tt-detail-alt-action")}
        ${btn("Сменить получателя", 'data-tt="change-pending"', "tt-detail-alt-action")}
        <p class="tt-muted">Код не пришёл? Измените получателя, мессенджер или параметры до физической передачи — custody не меняется, пока код не подтверждён.</p>
      </div>`
          : ""
      }
      ${
        o.finalRecipientId && o.holderId !== o.finalRecipientId
          ? shortRelayReminder(o, p, true, true)
          : ""
      }
    </section>`;
  }

  function detailTaskSection(o) {
    const p = o.pendingId ? contactById(o.pendingId) : null;
    const h = contactById(o.holderId);
    const fin = o.finalRecipientId ? contactById(o.finalRecipientId) : null;
    const actor = state.actingContactId || employeeContact(state.employeeId)?.id;
    const isHolder = o.holderId === actor;
    const canComplete = canExplicitComplete(o, actor);
    const mustRelay =
      isHolder &&
      o.finalRecipientId &&
      o.holderId !== o.finalRecipientId &&
      orderTrackOpen(o) &&
      !orderIsDelivered(o);
    const confirmingComplete = canComplete && state.completeConfirmOrderId === o.id;

    if (orderIsCompleted(o)) return completedTaskCard(o, actor);
    if (
      !isHolder &&
      orderIsDelivered(o) &&
      !o.pendingId &&
      canExplicitComplete(o, actor) &&
      state.completeConfirmOrderId !== o.id
    ) {
      const heroAttr = 'data-tt-detail-hero-primary=""';
      return `<section class="tt-detail-task-card" data-tt="detail-task-delivered-close">
        <h3 class="tt-detail-task-heading">Доставлено конечному получателю</h3>
        <p class="tt-detail-task-instructions">Предмет у ${E(h?.name || "—")}. Если движение по треку закончено — завершите передачу.</p>
        <div class="tt-detail-primary">${btn("Завершить передачу", `data-tt="complete" ${heroAttr}`, "tt-primary tt-btn-block")}</div>
      </section>`;
    }
    if (isHolder && orderIsDelivered(o) && !o.pendingId) {
      const heroAttr = 'data-tt-detail-hero-primary=""';
      return `<section class="tt-detail-task-card" data-tt="detail-task-delivered">
        <h3 class="tt-detail-task-heading">Предмет у вас · передача дошла до вас</h3>
        <p class="tt-detail-task-instructions">Если предмет нужно передать дальше или вернуть — «Передать дальше». Если движение закончено — «Завершить передачу».</p>
        <div class="tt-detail-primary" data-tt="detail-primary-actions">
          ${btn("Передать дальше", `data-tt="transfer" ${heroAttr}`, "tt-primary tt-btn-block")}
          ${btn("Завершить передачу", 'data-tt="complete"', "tt-btn-ghost tt-btn-block")}
        </div>
      </section>`;
    }
    if (!isHolder) {
      if (o.pendingId && actor === o.pendingId && contactById(actor)?.kind === "employee") {
        const duePhrase = o.dueAt ? ` до ${dt(o.dueAt)}` : "";
        const fromClient = o.fromExternal;
        const declineConfirm =
          state.extDeclineConfirmOrderId === o.id
            ? `<div class="tt-complete-confirm" data-tt="ext-decline-confirm">
        <p class="tt-warning">Отклонить заявку «${E(o.item)}» (${E(o.id)})?</p>
        <div class="tt-actions">${btn("Отклонить", 'data-tt="ext-decline-confirm"', "tt-primary")}${btn("Отмена", 'data-tt="ext-decline-cancel"')}</div>
      </div>`
            : "";
        const decline =
          fromClient && state.extDeclineConfirmOrderId !== o.id
            ? `<div class="tt-detail-primary">${btn("Отклонить заявку", 'data-tt="ext-request-decline"', "tt-btn-ghost")}</div>`
            : "";
        return `<section class="tt-detail-task-card tt-detail-task-card--info" data-tt="detail-task-awaiting">
        <h3 class="tt-detail-task-heading">${fromClient ? "Вам передают от клиента" : "Вам передают"}</h3>
        <p class="tt-detail-task-instructions">${E(h?.name || "—")} передаст вам «${E(o.item)}»${E(duePhrase)}. При встрече подтвердите получение: назовите код из SMS или покажите QR.</p>
        ${decline}${declineConfirm}
      </section>`;
      }
      if (isFormerHolderAfterHandoff(o, actor)) return formerHolderTaskCard(o);
      const wait = p
        ? `Ожидается подтверждение от ${p.name}.`
        : fin && o.holderId !== o.finalRecipientId
          ? `Предмет должен дойти до ${fin.name}.`
          : "Следите за статусом в истории.";
      return `<section class="tt-detail-task-card tt-detail-task-card--info" data-tt="detail-task-readonly">
        <h3 class="tt-detail-task-heading">Только просмотр</h3>
        <p class="tt-detail-readonly">Сейчас ответственный: <strong>${E(h?.name || "—")}</strong>. ${E(wait)} Действия доступны держателю.</p>
      </section>`;
    }
    if (o.pendingId) return pendingHandoffPanel(o, p, actor);
    const heroAttr = 'data-tt-detail-hero-primary=""';
    if (mustRelay) {
      return `<section class="tt-detail-task-card" data-tt="detail-task-card">
        <h3 class="tt-detail-task-heading">Передайте дальше</h3>
        <p class="tt-detail-task-receiver">Конечный получатель: <strong>${E(fin?.name || "—")}</strong></p>
        <p class="tt-detail-task-instructions">Выберите, кому передать предмет сейчас — получатель подтвердит кодом или QR.</p>
        <div class="tt-detail-primary" data-tt="detail-primary-actions">
          ${btn("Передать конечному получателю", `data-tt="transfer-final" ${heroAttr}`, "tt-primary tt-btn-block")}
          ${btn("Передать другому человеку", 'data-tt="transfer"', "tt-detail-alt-action")}
        </div>
        ${shortRelayReminder(o, p, isHolder, mustRelay)}
      </section>`;
    }
    const parts = [];
    if (canComplete && !confirmingComplete) {
      parts.push(btn("Завершить передачу", `data-tt="complete" ${heroAttr}`, "tt-primary tt-btn-block"));
      parts.push(btn("Передать другому человеку", 'data-tt="transfer"', "tt-detail-alt-action"));
    } else if (!mustRelay) {
      parts.push(btn("Передать другому человеку", `data-tt="transfer" ${heroAttr}`, "tt-primary tt-btn-block"));
    }
    if (!parts.length) return "";
    return `<section class="tt-detail-task-card" data-tt="detail-task-card">
      <h3 class="tt-detail-task-heading">Следующий шаг</h3>
      <p class="tt-detail-task-instructions">Вы ответственны за предмет. Выберите действие ниже.</p>
      <div class="tt-detail-primary" data-tt="detail-primary-actions">${parts.join("")}</div>
    </section>`;
  }

  function detailView(o) {
    const p = o.pendingId ? contactById(o.pendingId) : null;
    const actor = state.actingContactId || employeeContact(state.employeeId)?.id;
    const isHolder = o.holderId === actor;
    const canComplete = canExplicitComplete(o, actor);
    const confirmingComplete = canComplete && state.completeConfirmOrderId === o.id;
    const showActHolder = o.holderId && o.holderId !== actor;
    const dueHuman = humanDueLabel(o);
    const dueLabel = detailDuePhrase(o);
    const dueCls = dueHuman.overdue ? "tt-due-overdue" : "tt-due-line";
    const desktopDetail = typeof window !== "undefined" && window.innerWidth >= 1024;
    const tl = o.timeline.slice().reverse();
    const attItems = Att()
      ? Att().listForOrder(o).map((a) => ({
          ...a,
          addedLabel: `${dt(a.addedAt)} · ${contactById(a.addedBy)?.name || "—"}`,
        }))
      : [];
    const attCount = attItems.length;

    const otherActionBtns =
      isHolder && o.status !== "completed" && o.pendingId
        ? `${overflowActionBtn("Выбрать другого получателя", "change-pending", "user-round-cog")}${overflowActionBtn("Отменить ожидание", "cancel-pending", "ban")}`
        : "";

    const demoBtns = [];
    if (showActHolder) demoBtns.push(overflowActionBtn("Смотреть как текущий держатель (демо)", "act-holder", "eye"));
    if (p && o.holderId !== p.id && !state.actingContactId)
      demoBtns.push(overflowActionBtn("Действовать как получатель", "act-recipient", "user-check"));
    if (isHolder && o.pendingId) demoBtns.push(overflowActionBtn("Открыть экран получателя (демо)", "open-recipient", "external-link"));

    const initiatorBtns = [];
    const RP = RegPersonal();
    if (actor && RP && !cleanupPreviewReadOnly()) {
      if (canPersonalArchive(o, actor) && !RP.isArchived(o.id, actor)) {
        initiatorBtns.push(overflowActionBtn("В мой архив", "registry-archive", "archive"));
      }
      if (canInitiatorRemoveFromRegistry(o, actor) && !RP.isRemoved(o.id, actor)) {
        initiatorBtns.push(overflowActionBtn("Убрать из моего реестра", "registry-remove-ask", "trash-2"));
      }
      if (RP.isArchived(o.id, actor)) {
        initiatorBtns.push(overflowActionBtn("Вернуть из моего архива", "registry-unarchive", "archive-restore"));
      }
      if (RP.isRemoved(o.id, actor)) {
        initiatorBtns.push(overflowActionBtn("Восстановить в реестре", "registry-unremove", "undo-2"));
      }
    }

    const overflowGroups = [];
    const cleanupBtns = [];
    if (canDeleteTrack(o)) cleanupBtns.push(overflowActionBtn("Удалить до первого получения", "cleanup-delete-one", "trash-2"));
    if (canManageRegistry() && cleanupEligible(o, "archive"))
      cleanupBtns.push(overflowActionBtn("В общий архив", "cleanup-archive-one", "archive"));
    if (canManageRegistry() && registryArchive.has(o.id))
      cleanupBtns.push(overflowActionBtn("Вернуть из общего архива", "cleanup-restore-one", "archive-restore"));
    if (cleanupBtns.length) overflowGroups.push(`<div class="tt-detail-overflow-group" data-tt="cleanup-actions"><p class="tt-detail-overflow-label">Управление треком</p>${cleanupBtns.join("")}</div>`);
    if (initiatorBtns.length) {
      overflowGroups.push(
        `<div class="tt-detail-overflow-group" data-tt="registry-personal-actions"><p class="tt-detail-overflow-label">Мой реестр</p>${initiatorBtns.join("")}</div>`
      );
    }
    if (otherActionBtns && !registryArchive.has(o.id)) {
      overflowGroups.push(
        `<div class="tt-detail-overflow-group" data-tt="other-actions"><p class="tt-detail-overflow-label">Другие действия</p>${otherActionBtns}</div>`
      );
    }
    if (demoBtns.length && !registryArchive.has(o.id)) {
      overflowGroups.push(
        `<div class="tt-detail-overflow-group" data-tt="detail-demo"><p class="tt-detail-overflow-label">Демо-сценарии</p><div data-tt="detail-secondary-actions">${demoBtns.join("")}</div></div>`
      );
    }
    const overflowBlock = overflowGroups.length
      ? `<details class="tt-detail-overflow" data-tt="detail-overflow"><summary aria-label="Ещё действия">⋯</summary>
        <div class="tt-detail-overflow-panel" role="menu">${overflowGroups.join('<hr class="tt-detail-overflow-sep" aria-hidden="true">')}</div></details>`
      : "";

    const mobileDock =
      !registryArchive.has(o.id) && typeof window !== "undefined" && window.innerWidth <= 767 ? detailMobilePrimaryDock(o) : "";
    const metaBlock = desktopDetail
      ? ""
      : `<div class="tt-detail-meta">${statusBadge(o, actor)}<span class="${dueCls}">${E(dueLabel)}</span></div>`;
    const extShellHolder = isExternalShell() && isHolder && !o.pendingId;
    const taskBlock = registryArchive.has(o.id) ? archivedTrackNotice(o) :
      extShellHolder ? externalHolderShellBlocks(o) : detailTaskSection(o);
    const previewRecipientBtn = recipientPreviewDemoBtn(o);
    return `<div class="tt-panel tt-detail-panel tt-view-enter${mobileDock ? " tt-detail-panel--has-dock" : ""}" data-tt="detail">
      <header class="tt-detail-head tt-detail-head-v2">
        ${
          o.status === "completed"
            ? ""
            : `<button type="button" class="tt-back-v2" data-tt="back-list"><i data-lucide="arrow-left"></i> Передачи</button>`
        }
        <span class="tt-detail-id">${E(o.id)}</span>
        ${overflowBlock}
      </header>
      <div class="tt-detail-layout">
      <div class="tt-detail-main">
      <h2 class="tt-detail-title">${E(o.item)}</h2>
      ${metaBlock}
      ${taskBlock}
      ${detailRouteDisclosure(o)}
      ${!desktopDetail ? detailNotesDisclosure(o) : ""}
      <details class="tt-disclosure tt-detail-att-wrap" data-tt="detail-attachments-disclosure"${isDetailAttDisclosureOpen(o) ? " open" : ""}>
        ${disclosureSummary("Фото и файлы", { icon: "paperclip", count: attCount ? attCount : null })}
        <div class="tt-disclosure-body">${attachmentsSection(o, {
          readonly: registryArchive.has(o.id) || !isHolder || o.status === "completed",
          showPicker: !registryArchive.has(o.id) && isHolder && o.status !== "completed",
          compact: true,
          omitTitle: true,
          inputKey: "detail",
          items: attItems,
        })}</div>
      </details>
      </div>
      <aside class="tt-detail-aside">
      ${desktopDetail ? detailFactsCard(o, actor) : ""}
      ${detailHistoryHtml(o, tl, desktopDetail)}
      ${registryArchiveHistory(o)}
      ${
        confirmingComplete
          ? `<div class="tt-complete-confirm" data-tt="complete-confirm">
        <p class="tt-warning">Завершить передачу «${E(o.item)}» (${E(o.id)})? Предмет остаётся у ${E(contactById(o.holderId)?.name || "—")}, движение по треку закончено.</p>
        <div class="tt-actions">${btn("Подтвердить завершение", 'data-tt="confirm-complete"', "tt-primary")}${btn("Отмена", 'data-tt="cancel-complete"')}</div>
      </div>`
          : ""
      }
      ${
        state.registryConfirmRemoveOrderId === o.id
          ? `<div class="tt-registry-remove-confirm" data-tt="registry-remove-confirm">
        <p class="tt-warning">Убрать «${E(o.item)}» из общего списка реестра? Передача не отменяется: история и другие участники без изменений; при активном обязательстве строка останется в фильтрах «Нужно передать» и «Жду получения» и в их счётчиках.</p>
        <div class="tt-actions">${btn("Убрать из реестра", 'data-tt="registry-remove-confirm"', "tt-primary")}${btn("Отмена", 'data-tt="registry-remove-cancel"')}</div>
      </div>`
          : ""
      }
      ${state.toast ? `<p class="tt-success" data-tt="toast">${E(state.toast)}</p>` : ""}
      ${previewRecipientBtn ? `<p class="tt-detail-preview-recipient">${previewRecipientBtn}</p>` : ""}
      ${externalDeclinedPreview(o)}
      ${state.error ? `<p class="tt-error">${E(state.error)}</p>` : ""}
      </aside>
      </div>
      ${mobileDock}
    </div>`;
  }

  function transferView(o) {
    const f = state.form || { pickQ: "", recipientId: "", mode: "list", newName: "", newPhone: "", existingMatchId: "" };
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
    let pick = allowed.filter((c) => !f.pickQ || (c.name + c.phone).toLowerCase().includes(f.pickQ.toLowerCase()));
    const creatorId = o.createdById || orderCreatorId(o);
    const creator = creatorId ? contactById(creatorId) : null;
    if (orderIsDelivered(o) && creator && creator.id !== o.holderId && !f.pickQ) {
      pick = pick.filter((c) => c.id !== creator.id);
      pick.unshift(creator);
    }
    const pickBtn = (c) => {
      const isReturn = orderIsDelivered(o) && creator && c.id === creator.id && !f.pickQ;
      const title = isReturn ? `Вернуть · ${c.name}` : c.name;
      return `<button type="button" data-tt-pick="${E(c.id)}" aria-pressed="${f.recipientId === c.id}">${E(title)}<br><small>${E(fmtPhone(c.phone))}</small></button>`;
    };
    const emps = pick.filter((c) => c.kind === "employee");
    const ext = pick.filter((c) => c.kind === "external");
    const pickHtml =
      f.mode === "list"
        ? `${emps.length ? `<p class="tt-muted">Сотрудники · справочник компании</p><div class="tt-contact-pick">${emps.map(pickBtn).join("")}</div>` : ""}${
            ext.length ? `<p class="tt-muted">Внешние контакты</p><div class="tt-contact-pick">${ext.map(pickBtn).join("")}</div>` : ""
          }`
        : "";
    const existing = f.existingMatchId ? contactById(f.existingMatchId) : null;
    const newBlock =
      f.mode === "new"
        ? `<label class="tt-wizard-field">Телефон<input inputmode="tel" data-tt-field="newPhone" value="${E(f.newPhone)}"></label>
        ${existing ? contactExistsBlock(existing) : f.newPhoneStep === "name" ? `<span class="tt-badge" data-tt="contact-new">Новый контакт</span><label>Имя<input data-tt-field="newName" value="${E(f.newName)}"></label>` : ""}`
        : "";
    const newActions =
      f.mode === "new" && !existing && f.newPhoneStep !== "name"
        ? btn("Далее", 'data-tt="transfer-phone-next"', "tt-primary")
        : f.mode === "new" && f.newPhoneStep === "name"
          ? btn("Сохранить и выбрать", 'data-tt="confirm-transfer"', "tt-primary")
          : "";
    return `<div class="tt-panel"><h2>Передать «${E(o.item)}»</h2>
      <label>Поиск<input data-tt-field="pickQ" value="${E(f.pickQ)}"></label>
      <div data-tt="contact-pick">${pickHtml}</div>
      ${btn("Новый получатель", 'data-tt="toggle-new"')}
      ${newBlock}
      ${state.error ? `<p class="tt-error">${E(state.error)}</p>` : ""}
      <div class="tt-actions">${newActions || btn("Назначить получателя", 'data-tt="confirm-transfer"', "tt-primary")}${btn("Назад", 'data-tt="detail"')}</div></div>`;
  }

  function externalOrdersForActor(contactId) {
    return orders.filter((o) => {
      const parts = [o.holderId, o.pendingId, o.createdById, ...o.timeline.flatMap((t) => [t.from, t.to])];
      return parts.includes(contactId);
    });
  }

  function externalOpenRequestCount(externalId) {
    return orders.filter(
      (o) =>
        o.fromExternal &&
        o.createdById === externalId &&
        o.status !== "completed" &&
        o.status !== "delivered"
    ).length;
  }

  function extRequestStaffOptions(externalId) {
    const seen = new Set();
    const out = [];
    const add = (c) => {
      if (!c || c.kind !== "employee" || seen.has(c.id)) return;
      seen.add(c.id);
      out.push(c);
    };
    orders.forEach((o) => {
      const touch = [o.holderId, o.pendingId, o.createdById, ...o.timeline.flatMap((t) => [t.from, t.to])];
      if (!touch.includes(externalId)) return;
      touch.forEach((id) => add(contactById(id)));
    });
    Object.values(employees).forEach((e) => {
      if (e.acceptsExternalRequests) add(employeeContact(e.id));
    });
    return out;
  }

  function extRequestBotBubble(text) {
    return `<div class="tt-bot-preview tt-bot-preview--bubble" data-tt="ext-request-bot"><p>${E(text)}</p></div>`;
  }

  function externalShellHomeHtml() {
    const actor = state.actingContactId;
    let rows = externalOrdersForActor(actor).filter((o) => orderVisible(o));
    rows = rows.filter((o) => state.registryPersonalView === "registry-archive"
      ? registryArchive.has(o.id) : !registryArchive.has(o.id));
    rows = applyRegistryPersonalView(rows, actor);
    const cutoff = now() - 30 * 86400000;
    const groups = registryGroupOrders(rows, actor)
      .map((g) =>
        g.id === "done"
          ? { ...g, title: ["archived", "registry-archive"].includes(state.registryPersonalView) ? "В архиве" : "Недавно завершённые",
            items: ["archived", "registry-archive"].includes(state.registryPersonalView) ? g.items :
              g.items.filter((o) => (o.timeline?.[o.timeline.length - 1]?.at || 0) >= cutoff) }
          : g.id === "progress"
            ? { ...g, title: "В пути" }
            : g
      )
      .filter((g) => g.items.length);
    syncRegistrySelection(groups.flatMap((g) => g.items));
    const cards = groups.length
      ? `<div class="tt-ext-groups" data-tt="external-order-list">${groups
          .map(
            (g) => `<section class="tt-ext-group" data-tt-ext-group="${g.id}">
          <h2 class="tt-ext-group-title">${E(g.title)} <span class="tt-ext-group-count">${g.items.length}</span></h2>
          <div class="tt-cards">${g.items.map((o) => registryCardHtml(o, actor)).join("")}</div>
        </section>`
          )
          .join("")}</div>`
      : `<div class="tt-empty tt-ext-empty" data-tt="external-empty"><i data-lucide="package-open"></i><p>Пока нет передач.</p><p class="tt-muted">Когда сотрудник Тандор назначит вам передачу или вы отправите предмет через бота, она появится здесь.</p></div>`;
    return `<div class="tt-external-home" data-tt="external-home">
      ${registryPersonalToolbar()}
      ${registrySelectionToolbar()}
      ${state.toast ? `<p class="tt-success" role="status">${E(state.toast)}</p>` : ""}
      ${state.registryPersonalView === "archived" ? '<p class="tt-muted">Ваш архив выполненных передач. История и файлы сохранены; списки других участников не изменены.</p>' : ""}
      ${cards}</div>`;
  }

  const EXT_REQUEST_PHASES = ["item", "photo", "comment", "recipient", "due", "summary"];

  function extRequestChatRow(label, value) {
    return `<div class="tt-ext-chat-answer"><span class="tt-ext-chat-answer-label">${E(label)}</span><strong>${E(value)}</strong></div>`;
  }

  function extRequestAnswersHtml(f, phase) {
    const idx = EXT_REQUEST_PHASES.indexOf(phase);
    const rows = [];
    if (idx > 0 && f.item) rows.push(extRequestChatRow("Предмет", f.item));
    if (idx > 1) rows.push(extRequestChatRow("Фото", state.attachStaging.length ? `${state.attachStaging.length} шт.` : "без фото"));
    if (idx > 2) rows.push(extRequestChatRow("Комментарий", f.comment?.trim() || "—"));
    if (idx > 3 && f.recipientId) rows.push(extRequestChatRow("Кому", contactById(f.recipientId)?.name || "—"));
    if (idx > 4) rows.push(extRequestChatRow("Срок", f.duePreset === "tomorrow" ? "Завтра" : "Сегодня"));
    return rows.length ? `<div class="tt-ext-chat-answers">${rows.join("")}</div>` : "";
  }

  function extRequestFrame(inner, { step, total } = {}) {
    const progress = step ? `<span class="tt-ext-chat-step">Шаг ${step} из ${total}</span>` : "";
    return `<div class="tt-panel tt-ext-request" data-tt="ext-request">
      <div class="tt-ext-chat-head">
        <span class="tt-ext-chat-avatar" aria-hidden="true"><i data-lucide="bot"></i></span>
        <div><h2>Отправить предмет</h2><p class="tt-ext-chat-sub">Бот Тан-трекера · демо диалога</p></div>
        ${progress}
      </div>
      ${
        step
          ? `<div class="tt-ext-chat-progress" aria-hidden="true"><span style="width:${Math.round((step / total) * 100)}%"></span></div>`
          : ""
      }
      ${inner}
    </div>`;
  }

  function extRequestView() {
    const extId = state.actingContactId;
    const phase = state.extRequestPhase || "item";
    const f = state.extRequestForm || { item: "", comment: "", recipientId: "", duePreset: "today" };
    state.extRequestForm = f;
    if (phase === "blocked") {
      return extRequestFrame(`${extRequestBotBubble("Открытых заявок уже 5 — дождитесь завершения хотя бы одной, затем попробуйте снова.")}
        <div class="tt-ext-chat-actions">${btn("Закрыть", 'data-tt="ext-request-close"', "tt-primary tt-btn-block")}</div>`);
    }
    if (phase === "done") {
      const staff = contactById(f.recipientId);
      const createdOrder = orders.find((x) => x.id === f.createdId);
      const dueText = createdOrder?.dueAt
        ? `${f.duePreset === "tomorrow" ? "завтра" : "сегодня"} до ${dt(createdOrder.dueAt).split(", ").pop()}`
        : f.duePreset === "tomorrow" ? "завтра" : "сегодня";
      const photos = createdOrder?.attachments?.length || 0;
      return extRequestFrame(`${extRequestBotBubble(
        `Заявка ${f.createdId} создана${photos ? `, фото приложено (${photos})` : ""}. Передайте «${f.item}» — ${staff?.name || "—"} ${dueText}. При встрече сотрудник назовёт код из SMS или покажет QR — введите код на вашей странице передачи.`
      )}
        <div class="tt-ext-chat-actions">${btn("Открыть мою передачу", 'data-tt="ext-request-open-order"', "tt-primary tt-btn-block")}${btn("К списку", 'data-tt="ext-request-close"', "tt-btn-ghost tt-btn-block")}</div>`);
    }
    const step = EXT_REQUEST_PHASES.indexOf(phase) + 1;
    let body = "";
    let nextLabel = "Далее";
    if (phase === "item") {
      body = `${extRequestBotBubble("Что передаёте?")}<label class="tt-wizard-field tt-ext-chat-field"><span class="tt-visually-hidden">Предмет</span><input data-tt-field="extItem" value="${E(f.item)}" autocomplete="off" placeholder="Например: ключи, договор, образцы"></label>`;
    } else if (phase === "photo") {
      body = `${extRequestBotBubble("Пришлите фото предмета — так сотруднику проще его узнать. Можно пропустить.")}<div class="tt-ext-chat-attach">${createAttachmentsSection({
        pickerLabel: "Прикрепить фото",
        hint: "Фото попадёт в карточку передачи, его увидит сотрудник-получатель.",
      })}</div>`;
      if (!state.attachStaging.length) nextLabel = "Пропустить";
    } else if (phase === "comment") {
      body = `${extRequestBotBubble("Добавите комментарий? Например, «срочно» или «передать до обеда». Можно пропустить.")}<label class="tt-wizard-field tt-ext-chat-field"><span class="tt-visually-hidden">Комментарий</span><input data-tt-field="extComment" value="${E(f.comment)}" placeholder="Комментарий (необязательно)"></label>`;
      if (!f.comment?.trim()) nextLabel = "Пропустить";
    } else if (phase === "recipient") {
      const opts = extRequestStaffOptions(extId);
      body = `${extRequestBotBubble("Кому передать? Это сотрудники, с которыми вы уже работали, и точки приёма Тандор.")}<div class="tt-contact-pick tt-ext-chat-pick" data-tt="ext-request-recipients">${opts
        .map(
          (c) =>
            `<button type="button" data-tt-ext-pick="${E(c.id)}" aria-pressed="${f.recipientId === c.id}"><span class="tt-ext-pick-name">${E(c.name)}</span><small>${E(
              fmtPhone(c.phone)
            )}</small></button>`
        )
        .join("")}</div>`;
    } else if (phase === "due") {
      body = `${extRequestBotBubble("До какого срока нужно передать?")}<div class="tt-ext-chat-chips">${btn("Сегодня", 'data-tt="ext-due-today"', f.duePreset === "today" ? "tt-primary" : "")}${btn(
        "Завтра",
        'data-tt="ext-due-tomorrow"',
        f.duePreset === "tomorrow" ? "tt-primary" : ""
      )}</div>`;
    } else if (phase === "summary") {
      const staff = contactById(f.recipientId);
      body = `${extRequestBotBubble("Проверьте заявку. Если всё верно — создаю передачу и сообщаю сотруднику.")}
        <dl class="tt-ext-chat-summary">
          <div><dt>Предмет</dt><dd>${E(f.item)}</dd></div>
          <div><dt>Фото</dt><dd>${state.attachStaging.length ? `${state.attachStaging.length} шт.` : "без фото"}</dd></div>
          <div><dt>Комментарий</dt><dd>${E(f.comment?.trim() || "—")}</dd></div>
          <div><dt>Кому</dt><dd>${E(staff?.name || "—")}${staff?.phone ? `<small>${E(fmtPhone(staff.phone))}</small>` : ""}</dd></div>
          <div><dt>Срок</dt><dd>${f.duePreset === "tomorrow" ? "Завтра" : "Сегодня"}</dd></div>
        </dl>`;
      nextLabel = "Создать заявку";
    }
    const nextAction = phase === "summary" ? "ext-request-create" : "ext-request-next";
    return extRequestFrame(
      `${extRequestAnswersHtml(f, phase)}
      ${body}
      ${state.error ? `<p class="tt-error">${E(state.error)}</p>` : ""}
      <div class="tt-ext-chat-actions">
        ${btn(nextLabel, `data-tt="${nextAction}"`, "tt-primary tt-btn-block")}
        <div class="tt-ext-chat-secondary">${btn(step > 1 ? "Назад" : "К списку", 'data-tt="ext-request-back"', "tt-link")}${btn("Отмена", 'data-tt="ext-request-close"', "tt-link")}</div>
      </div>`,
      { step, total: EXT_REQUEST_PHASES.length }
    );
  }

  function syncExtRequestFieldsFromDom() {
    if (!state.extRequestForm) return;
    document.querySelectorAll('[data-tt="ext-request"] [data-tt-field]').forEach((el) => {
      const key = el.getAttribute("data-tt-field");
      if (key === "extItem") state.extRequestForm.item = el.value;
      if (key === "extComment") state.extRequestForm.comment = el.value;
    });
  }

  function submitExternalRequest() {
    const extId = state.actingContactId;
    if (!extId || !isExternalShell()) return;
    syncExtRequestFieldsFromDom();
    const f = state.extRequestForm;
    if (!f.item?.trim()) {
      state.error = "Укажите, что передаёте.";
      state.extRequestPhase = "item";
      return;
    }
    if (!f.recipientId) {
      state.error = "Выберите получателя.";
      state.extRequestPhase = "recipient";
      return;
    }
    const id = `TT-2026-${String(nextTrack++).padStart(3, "0")}`;
    const dueAt =
      f.duePreset === "tomorrow"
        ? Date.now() + 86400000
        : Date.now() + 6 * 3600000;
    const order = {
      id,
      item: f.item.trim(),
      qty: "",
      holderId: extId,
      pendingId: f.recipientId,
      finalRecipientId: f.recipientId,
      createdById: extId,
      status: "active",
      dueAt,
      comment: (f.comment || "").trim(),
      holderSince: now(),
      fromExternal: true,
      timeline: [{ at: now(), from: extId, to: f.recipientId, note: "Назначен следующий получатель" }],
      code: null,
      handoffVer: 1,
      pastInvitations: [],
      attachments: [],
    };
    syncInvitation(order);
    if (Att() && state.attachStaging.length) {
      Att().mergeToOrder(order, state.attachStaging, extId);
      state.attachStaging = [];
      state.attachError = "";
    }
    orders.unshift(order);
    f.createdId = id;
    state.extRequestPhase = "done";
    state.error = "";
    state.toast = "";
  }

  function externalDeclinedPreview(o) {
    if (!o.fromExternal || !isExternalShell()) return "";
    const entry = (o.timeline || []).slice().reverse().find((t) => t.note === "Заявка отклонена");
    if (!entry || o.status !== "completed") return "";
    return botMessagePreviewBlock(o, "declined", { reason: "без причины" });
  }

  function paintCodeCells() {
    const val = state.codeInput || "";
    const active = Math.min(val.length, 5);
    document.querySelectorAll('[data-tt="code-cells"] .tt-code-cell').forEach((cell, i) => {
      const ch = val[i] || "";
      cell.textContent = ch;
      cell.classList.toggle("tt-code-cell--filled", !!ch);
      cell.classList.toggle("tt-code-cell--active", i === active && val.length < 6);
    });
  }

  function messengerChannelsUi() {
    const ch = Ms()?.channelAvailability?.() || {
      telegram: { available: true, label: "Telegram", reason: "" },
      max: { available: false, label: "MAX", reason: "MAX недоступен." },
    };
    return ch;
  }

  function recipientMessengerLabel(o) {
    const ch = state.recipientChannel || o.code?.channel;
    return messengerChannelsUi()[ch]?.label || (ch === "max" ? "MAX" : "Telegram");
  }

  function botMessagePreviewText(o, mode, ctx) {
    const item = ctx.item || o.item;
    const id = o.id;
    if (mode === "declined") {
      const reason = ctx.reason || "без причины";
      return `Заявка ${id} отклонена: ${reason}.`;
    }
    if (mode === "code") {
      const holderName = ctx.holderName || "—";
      const code = ctx.code || "------";
      return `Код получения: ${code}\nНазовите его ${holderName} — он введёт код в Тан-трекере.\nПосле этого предмет «${item}» будет числиться у вас, и мы пришлём сюда подтверждение.\nЭто не код входа и не SMS.`;
    }
    const senderName = ctx.senderName || "—";
    if (ctx.intermediate) {
      const finName = ctx.finalName || "—";
      const due = ctx.dueText || "срок не указан";
      const url = ctx.holderPageUrl || "";
      return `✅ Предмет «${item}» у вас (передача ${id}).\nПередайте дальше: ${finName}, срок до ${due}.\nВаша страница передачи: ${url} (действует 7 дней).`;
    }
    const url = ctx.holderPageUrl || "";
    return `✅ Предмет «${item}» у вас (передача ${id}).\nПередача дошла до вас — делать ничего не нужно. Если предмет нужно передать дальше или вернуть — ваша страница передачи: ${url} (действует, пока предмет у вас).`;
  }

  function botMessagePreviewBlock(o, mode, ctx) {
    const label = recipientMessengerLabel(o);
    const text = botMessagePreviewText(o, mode, ctx);
    return `<details class="tt-disclosure" data-tt="bot-message-preview">
      ${disclosureSummary(`Сообщение в ${label} (демо)`, { icon: "message-square" })}
      <div class="tt-disclosure-body"><pre class="tt-bot-preview">${E(text)}</pre><p class="tt-muted">Демо-текст. Сообщение не отправляется.</p></div>
    </details>`;
  }

  function externalHolderShellBlocks(o) {
    if (registryArchive.has(o.id)) return archivedTrackNotice(o);
    const fin = o.finalRecipientId ? contactById(o.finalRecipientId) : null;
    const mustRelay =
      o.finalRecipientId && o.holderId !== o.finalRecipientId && orderTrackOpen(o) && !orderIsDelivered(o);
    const deliveredFinal =
      orderIsDelivered(o) && o.holderId === o.finalRecipientId && !o.pendingId;
    const prevEntry =
      o.timeline
        .filter((t) => t.to === o.holderId && isConfirmedHandoffTimelineNote(t.note))
        .sort((a, b) => a.at - b.at)
        .pop() || null;
    const prevHolder = contactById(prevEntry?.from);
    const statusCard = `<article class="tt-panel tt-recipient-card" data-tt="holder-status-card">
      <h2 class="tt-recipient-hero">Предмет у вас</h2>
      <p class="tt-recipient-from">С ${E(dt(o.holderSince))} МСК · получено от <strong>${E(prevHolder?.name || "—")}</strong></p>
    </article>`;
    let nextStep;
    if (mustRelay) {
      nextStep = `<div class="tt-reminder" data-tt="holder-next-step">
        <p><strong>Передайте дальше:</strong> ${E(fin?.name || "—")}</p>
        <p class="tt-muted">Срок: ${o.dueAt ? `до ${E(dt(o.dueAt))}` : "срок не указан"}</p>
        ${btn("Передать дальше", 'data-tt="transfer"', "tt-primary tt-btn-block")}
      </div>`;
    } else if (deliveredFinal) {
      nextStep = `<div class="tt-panel" data-tt="holder-delivered">
        <p class="tt-success">Передача дошла до вас. Делать ничего не нужно.</p>
        ${btn("Передать дальше или вернуть", 'data-tt="transfer"', "tt-btn-ghost tt-btn-block")}
      </div>`;
    } else {
      nextStep = `<div class="tt-success tt-panel" data-tt="holder-next-step"><p>Передача завершена</p><p class="tt-muted">Больше ничего делать не нужно.</p></div>`;
    }
    return `${statusCard}${nextStep}`;
  }

  function recipientPreviewDemoBtn(o) {
    if (isExternalShell()) return "";
    const p = state.recipientReceivedPreview;
    if (!p || p.orderId !== o.id) return "";
    if (contactById(p.rcv)?.kind !== "external") return "";
    return btn("Что увидит получатель (демо)", 'data-tt="preview-recipient-received"', "tt-btn-ghost");
  }

  function recipientReceivedScreen(o, received) {
    const ticketRcv = state.recipientTicket?.rcv;
    const inv = received.inv;
    const item = inv?.item || o.item;
    const prevHolder = contactById(received.fromId);
    const self = contactById(ticketRcv);
    const fin = contactById(o.finalRecipientId);
    const intermediate = !!(fin && o.finalRecipientId && ticketRcv && o.finalRecipientId !== ticketRcv && !orderIsCompleted(o));
    const attItems = Att() ? Att().listForOrder(o) : [];
    const attCount = attItems.length;
    const attDisclosure = attCount
      ? `<details class="tt-disclosure tt-recipient-att" data-tt="recipient-attachments-disclosure">
        ${disclosureSummary("Фото и файлы", { icon: "paperclip", count: attCount })}
        <div class="tt-disclosure-body">${attachmentsSection(o, { readonly: true, items: attItems, compact: true, omitTitle: true })}</div>
      </details>`
      : "";
    const nextStep = intermediate
      ? `<div class="tt-reminder" data-tt="recipient-next-step">
        <p><strong>Передайте дальше:</strong> ${E(fin?.name || "—")}</p>
        <p class="tt-muted">Срок: ${o.dueAt ? `до ${E(dt(o.dueAt))}` : "срок не указан"}</p>
        ${btn("Открыть мою страницу передачи", 'data-tt="open-holder-page"', "tt-primary tt-btn-block")}
      </div>`
      : `<div class="tt-success" data-tt="recipient-next-step"><p>Передача дошла до вас — делать ничего не нужно. Если предмет нужно передать дальше или вернуть, откройте свою страницу передачи.</p></div>`;
    const botCtx = {
      item,
      senderName: prevHolder?.name || "—",
      intermediate,
      finalName: fin?.name,
      dueText: o.dueAt ? dt(o.dueAt) : "срок не указан",
      holderPageUrl: ticketRcv ? externalHolderPageDemoUrl(o, ticketRcv) : "",
    };
    return `<div class="tt-recipient-wrap"><article class="tt-recipient-card" data-tt="recipient-received">
      <p class="tt-recipient-kicker">${E(o.id)}</p>
      <h1 class="tt-recipient-hero">Предмет у вас</h1>
      <h2 class="tt-recipient-title">${E(item)}</h2>
      <p class="tt-recipient-from">От кого: <strong>${E(prevHolder?.name || "—")}</strong></p>
      <p class="tt-muted">Получено ${E(dt(received.receivedAt))} МСК · ${E(maskPhone(self?.phone || ""))}</p>
      ${nextStep}
      ${botMessagePreviewBlock(o, "received", botCtx)}
      ${attDisclosure}
      <div class="tt-recipient-foot">${btn("Вернуться к передаче", 'data-tt="exit-recipient"', "tt-btn-ghost tt-recipient-foot-quiet")}</div>
    </article></div>`;
  }

  function recipientMessengerPreamble(o) {
    if (state.recipientVia === "qr" && !pendingIsExternal(o)) return "";
    if (identityVerified(o)) return "";
    return `<p class="tt-recipient-messenger-preamble" data-tt="recipient-messenger-preamble" tabindex="-1">Бот Тандор попросит подтвердить ваш номер, чтобы выдать код получения. Сообщите код отправителю только после того, как получите предмет.</p>`;
  }

  function messengerChannelPickBlock(o, stale) {
    if (stale) return "";
    const ch = messengerChannelsUi();
    const cards = ["telegram", "max"]
      .map((key) => {
        const meta = ch[key];
        const picked = state.recipientChannel === key;
        const disabled = !meta.available;
        const cls = `tt-messenger-card${picked ? " tt-messenger-card--picked" : ""}${disabled ? " tt-messenger-card--disabled" : ""}`;
        return `<button type="button" class="${cls}" data-tt="pick-channel" data-channel="${key}" ${
          disabled ? "disabled aria-disabled=true" : ""
        }>
          <span class="tt-messenger-card-title">${E(meta.label || key)}</span>
          ${disabled ? `<span class="tt-messenger-card-reason">${E(meta.reason)}</span>` : `<span class="tt-muted">Получатель выбирает сам</span>`}
        </button>`;
      })
      .join("");
    return `<div class="tt-recipient-step tt-recipient-step--active" data-tt="recipient-step-channel">
      <p class="tt-recipient-step-label">Шаг 1 · выберите мессенджер</p>
      <p class="tt-muted tt-recipient-step-hint">Отправитель не угадывает канал — выберите Telegram или MAX (когда доступен).</p>
      <div class="tt-messenger-grid" data-tt="messenger-choose">${cards}</div>
      ${state.recipientChannel ? `<p class="tt-muted">Выбран: <strong>${E(ch[state.recipientChannel]?.label || state.recipientChannel)}</strong> ${btn("Сменить канал", 'data-tt="switch-channel"', "tt-btn-ghost tt-messenger-switch")}</p>` : ""}
    </div>`;
  }

  function recipientProgressBlock(o, ctx) {
    const { verified, stale, tokenBad, qrMode, codePath, c } = ctx;
    if (stale || tokenBad) return "";
    if (qrMode) {
      return `<p class="tt-muted tt-recipient-progress" data-tt="recipient-progress">Шаг 3 из 3 · примите предмет</p>`;
    }
    if (!verified) {
      if (!state.recipientChannel) {
        return `<p class="tt-muted tt-recipient-progress" data-tt="recipient-progress">Шаг 1 из 3 · мессенджер</p>`;
      }
      return `<p class="tt-muted tt-recipient-progress" data-tt="recipient-progress">Шаг 2 из 3 · подтвердите номер</p>`;
    }
    if (codePath) {
      const whatsNext =
        c && codeValid(o)
          ? `<p class="tt-muted" data-tt="recipient-whats-next">Что дальше: передающий вводит код — после этого здесь появится «Предмет у вас».</p>`
          : "";
      return `<p class="tt-muted tt-recipient-progress" data-tt="recipient-progress">Шаг 3 из 3 · назовите код</p>${whatsNext}`;
    }
    return "";
  }

  function messengerVerifyBlock(o, stale) {
    if (stale || !state.recipientChannel) return "";
    const ch = state.recipientChannel;
    const label = messengerChannelsUi()[ch]?.label || ch;
    if (identityVerified(o)) {
      return `<p class="tt-success tt-recipient-verified" data-tt="messenger-verified">Номер подтверждён через ${E(label)}.</p>`;
    }
    const err = state.messengerError ? `<p class="tt-error" data-tt="messenger-error">${E(state.messengerError)}</p>` : "";
    return `<div class="tt-recipient-step tt-recipient-step--active" data-tt="recipient-step-verify">
      <p class="tt-recipient-step-label">Шаг 2 · подтвердите свой номер в ${E(label)}</p>
      <p class="tt-muted tt-recipient-step-hint">Демо: имитируем кнопку «Поделиться контактом» бота. Код появится только здесь, не у отправителя.</p>
      ${btn(`Поделиться контактом (демо · ${label})`, 'data-tt="messenger-share-own"', "tt-primary tt-btn-block")}
      ${err}
    </div>`;
  }

  function invitationLinkBlock(o) {
    const inv = o.activeInvitation;
    if (!inv?.startTokenPlain) return "";
    const url = handoffUrl(o, inv);
    const abs = new URL(url, location.href).href;
    const plain = invitationMessagePlain(o, inv, url);
    const from = contactById(inv?.holderId || o.holderId);
    const item = inv?.item || o.item;
    return `<div class="tt-handoff-invite-link" data-tt="invitation-link-block">
      <p class="tt-muted">Персональная ссылка для получателя (выбор Telegram/MAX на экране):</p>
      <code class="tt-invite-url" data-tt="invite-url">${E(url)}</code>
      <div class="tt-invite-actions">${btn("Скопировать ссылку", 'data-tt="copy-invite-link"', "tt-btn-ghost")}${btn("Скопировать приглашение", 'data-tt="copy-invite-message"', "tt-btn-ghost")}</div>
      <section class="tt-invite-message-demo" aria-labelledby="tt-invite-preview-heading">
        <h4 class="tt-invite-preview-heading" id="tt-invite-preview-heading">Демо-превью сообщения для получателя</h4>
        <p class="tt-muted tt-invite-preview-note">В мессенджере вид может отличаться; rich-превью MAX/Telegram в прототипе не обещаем.</p>
        <div class="tt-invite-message-card" data-tt="invite-message-preview">
          <p class="tt-invite-message-card-title">Вам передают предмет</p>
          <p class="tt-invite-message-card-line">Отправитель: <strong>${E(from?.name || "—")}</strong></p>
          <p class="tt-invite-message-card-line">Предмет: <strong>${E(item || "—")}</strong></p>
          <p class="tt-invite-message-card-body">Здесь можно посмотреть детали и подтвердить получение. Регистрация не нужна.</p>
          <p class="tt-invite-message-card-action">Посмотреть передачу →</p>
          <p class="tt-invite-message-card-url tt-muted">${E(abs)}</p>
        </div>
        <pre class="tt-invite-message-fallback" data-tt="invite-message-text">${E(plain)}</pre>
      </section>
    </div>`;
  }

  function codeView(o) {
    const showCode = state.codeDemoRevealed && o.code && codeValid(o) && holderDemoCodeAllowed(o);
    const codeInputId = `tt-code-input-${String(o.id).replace(/[^\w-]/g, "")}`;
    const val = state.codeInput || "";
    const active = Math.min(val.length, 5);
    return `<div class="tt-panel tt-code-screen tt-view-enter" data-tt="code-screen"><h2>Ввести код получателя</h2>
      <p class="tt-code-screen-sub">Предмет: ${E(o.item)} · ожидает ${E(contactById(o.pendingId)?.name || "")}</p>
      <div class="tt-code-field">
        <label class="tt-code-field-label" for="${E(codeInputId)}">6-значный код</label>
        <div class="tt-code-cells-wrap">
          <div class="tt-code-cells" data-tt="code-cells" aria-hidden="true">${[0, 1, 2, 3, 4, 5]
            .map((i) => {
              const ch = val[i] || "";
              const cls = `${ch ? " tt-code-cell--filled" : ""}${i === active && val.length < 6 ? " tt-code-cell--active" : ""}`;
              return `<span class="tt-code-cell${cls}">${E(ch)}</span>`;
            })
            .join("")}</div>
          <input id="${E(codeInputId)}" class="tt-code-input-overlay" inputmode="numeric" maxlength="6" data-tt="code-input" value="${E(val)}" autocomplete="one-time-code" aria-describedby="tt-code-demo-help">
        </div>
        <div class="tt-code-secondary-actions">
          ${holderDemoCodeAllowed(o) ? `${btn("Получить демо-код", 'data-tt="demo-reveal-code"', "tt-btn-ghost")}${btn("Истечь срок кода (демо)", 'data-tt="demo-expire"', "tt-btn-ghost")}` : `<p class="tt-muted">Внешний получатель сообщит код из мессенджера — демо-код держателю недоступен.</p>`}
        </div>
      </div>
      ${
        showCode
          ? `<div class="tt-holder-demo-code" data-tt="holder-shown-code"><span class="tt-code tt-code-inline">${E(o.code.code)}</span></div>`
          : ""
      }
      <p id="tt-code-demo-help" class="tt-muted tt-code-help">${
        pendingIsExternal(o)
          ? "Код назовёт получатель — он получил его в Telegram или MAX. В демо код показан на экране получателя («⋯ → Открыть экран получателя (демо)»)."
          : "Демо без СМС: нажмите «Получить демо-код», затем введите цифры и «Подтвердить»."
      }</p>
      ${state.error ? `<p class="tt-error" data-tt="code-error">${E(state.error)}</p>` : ""}
      <div class="tt-code-dock tt-code-dock--inline">${btn("Подтвердить", 'data-tt="confirm-code"', "tt-primary tt-btn-block")}${btn("Назад", 'data-tt="detail"', "tt-btn-ghost tt-btn-block")}</div>
    </div>`;
  }

  function recipientScreen(o) {
    const ticketHv = state.recipientTicket?.hv;
    const ticketRcv = state.recipientTicket?.rcv;
    const received = recipientHandoffReceived(o, ticketRcv, ticketHv);
    if (received) return recipientReceivedScreen(o, received);
    const resolved =
      ticketHv != null ? resolveInvitation(o, ticketHv, ticketRcv) : { inv: o.activeInvitation, stale: false };
    const inv = resolved.inv || o.activeInvitation;
    const from = contactById(inv?.holderId || o.holderId);
    const item = inv?.item || o.item;
    const blocked = recipientInvitationBlocked(o, resolved);
    if (!state.recipientWelcomeAck || blocked.blocked) {
      return recipientWelcomeScreen(o, { inv, from, item, blocked });
    }
    const to = contactById(inv?.pendingId || o.pendingId);
    const fin = contactById(o.finalRecipientId);
    const intermediate =
      fin && o.finalRecipientId && to?.id && o.finalRecipientId !== to.id && o.status !== "completed";
    const c = o.code;
    const verified = identityVerified(o);
    const qrMode = state.recipientVia === "qr";
    const stale = resolved.stale;
    const attItems = Att() ? Att().listForOrder(o) : [];
    const attCount = attItems.length;
    const codeBlock =
      !stale && !qrMode && verified && c && codeValid(o)
        ? `<div class="tt-recipient-code-block">
        <span class="tt-recipient-code-display" data-tt="shown-code">${E(c.code)}</span>
        ${btn("Скопировать", 'data-tt="copy-recipient-code"', "tt-btn-ghost")}
        <p class="tt-muted">Код действует 5 мин · до ${dt(c.expiresAt)}</p>
      </div>`
        : "";
    const token = state.recipientTicket?.st;
    const tokenBad =
      !stale &&
      token &&
      inv &&
      !invitationTokenValid(o, inv, token) &&
      !(resolved.stale && Ms()?.tokenMatches?.(inv, token));
    const messengerPreamble =
      !stale && !tokenBad && !verified ? recipientMessengerPreamble(o) : "";
    const channelStep = !verified && !tokenBad ? messengerChannelPickBlock(o, stale) : "";
    const verifyStep = !verified && !tokenBad ? messengerVerifyBlock(o, stale) : verified ? messengerVerifyBlock(o, stale) : "";
    const qrAllowed = verified && !stale && qrMode && !pendingIsExternal(o);
    const codePath = verified && !stale && (!qrMode || pendingIsExternal(o));
    const receiveStep = qrAllowed
      ? `<div class="tt-recipient-step tt-recipient-step--active" data-tt="recipient-step-receive">
        <p class="tt-recipient-step-label">Шаг 3 · примите предмет</p>
        ${btn("Подтвердить получение", 'data-tt="confirm-qr-receive"', "tt-primary tt-btn-block")}
        <p class="tt-muted tt-recipient-step-hint">Нажмите, когда предмет у вас на руках.</p>
      </div>`
      : codePath && !c
        ? `<div class="tt-recipient-step tt-recipient-step--active" data-tt="recipient-step-code">
        <p class="tt-recipient-step-label">Шаг 3 · получите код в ${E(messengerChannelsUi()[state.recipientChannel]?.label || "мессенджере")}</p>
        ${btn("Получить код", 'data-tt="gen-code"', "tt-primary tt-btn-block")}
        <p class="tt-muted tt-recipient-step-hint">Код показывается только на этом экране — сообщите его держателю устно или по телефону.</p>
      </div>`
        : codePath && c && !codeValid(o)
          ? `<div class="tt-recipient-step"><p class="tt-error">Код недоступен.</p>${btn("Получить новый код", 'data-tt="gen-code-reissue"', "tt-primary tt-btn-block")}</div>`
          : "";
    const attDisclosure =
      verified && !stale && attCount
        ? `<details class="tt-disclosure tt-recipient-att" data-tt="recipient-attachments-disclosure">
        ${disclosureSummary("Фото и файлы", { icon: "paperclip", count: attCount })}
        <div class="tt-disclosure-body">${attachmentsSection(o, { readonly: true, items: attItems, compact: true, omitTitle: true })}</div>
      </details>`
        : stale
          ? `<p class="tt-muted">Вложения недоступны для устаревшего приглашения.</p>`
          : "";
    return `<div class="tt-recipient-wrap"><article class="tt-recipient-card" data-tt="recipient-screen">
      ${stale ? `<p class="tt-warning">Это приглашение устарело (версия ${E(String(inv?.hv ?? ticketHv))}). Актуальный получатель мог измениться.</p>` : ""}
      <p class="tt-recipient-kicker">${E(o.id)}</p>
      <h1 class="tt-recipient-hero">Вам передают</h1>
      <h2 class="tt-recipient-title">${E(inv?.item || o.item)}</h2>
      <p class="tt-recipient-from">От кого: <strong>${E(from?.name || "—")}</strong></p>
      <p class="tt-recipient-to">Вам · ${E(maskPhone(to?.phone || ""))}</p>
      ${fin && intermediate ? `<p class="tt-recipient-fin">Конечный получатель: <strong>${E(fin.name)}</strong></p>` : ""}
      ${intermediate ? `<div class="tt-reminder tt-recipient-relay" data-tt="recipient-relay-reminder"><strong>После получения передайте дальше</strong><p>Доставить до ${o.dueAt ? dt(o.dueAt) : "срока не указан"}.</p></div>` : ""}
      ${tokenBad ? `<p class="tt-error" data-tt="invite-token-error">Ссылка приглашения недействительна, истекла или уже заменена новой версией.</p>` : ""}
      ${recipientProgressBlock(o, { verified, stale, tokenBad, qrMode, codePath, c })}
      ${messengerPreamble}
      ${channelStep}
      ${verifyStep}
      ${receiveStep}
      ${codeBlock}
      ${
        !stale && codePath && c && codeValid(o)
          ? botMessagePreviewBlock(o, "code", {
              item: inv?.item || o.item,
              holderName: from?.name || "—",
              code: c.code,
            })
          : ""
      }
      ${attDisclosure}
      ${stale && qrMode ? `<p class="tt-error">Подтверждение по этому QR недоступно.</p>` : ""}
      <div class="tt-recipient-foot">${!qrMode && verified ? btn("Истечь срок кода (демо)", 'data-tt="demo-expire"', "tt-btn-ghost tt-recipient-foot-quiet") : ""}${btn("Вернуться к передаче", 'data-tt="exit-recipient"', "tt-btn-ghost tt-recipient-foot-quiet")}</div>
    </article></div>`;
  }

  function bodyHtml() {
    if (state.ttRoleUnsupported) return unsupportedRoleView();
    const o = state.orderId ? orders.find((x) => x.id === state.orderId) : null;
    if (!o && state.orderId && deletedTrackIds.has(state.orderId))
      return `<div class="tt-panel" data-tt="deleted-track"><h2>Передача недоступна</h2><p>Она удалена до первого получения. Прежние ссылка, код и QR больше не действуют.</p>${btn("К реестру", 'data-tt="back-list"')}</div>`;
    if (o && registryArchive.has(o.id) && orderVisible(o) && state.view !== "list")
      return detailView(o);
    if (state.view === "handoff-receipt") {
      if (!o || !handoffReceiptValid(o)) return deniedView();
      return handoffReceiptView(o);
    }
    if (isExternalShell() && state.view === "ext-request") return extRequestView();
    if (state.view === "detail" && o && !orderVisible(o)) return deniedView();
    if (state.view === "create") return createView();
    if (state.view === "transfer" && o) return transferView(o);
    if (state.view === "code" && o) return codeView(o);
    if (state.view === "detail" && o) return detailView(o);
    if (isExternalShell() && o) return detailView(o);
    if (isExternalShell()) return externalShellHomeHtml();
    if (state.view === "list" && !registryPersonalFlagsReady()) return registryPersonalLoadingView();
    return registryView();
  }

  function renderTracker(opts = {}) {
    if (current !== ROUTE) return;
    applyBodyClasses();
    const main = document.querySelector(".main");
    if (!main) return;
    syncTrackerShellMountFlag(main);

    const viewKey = `${state.view}|${state.orderId}|${state.recipientMode}|${state.recipientWelcomeAck}|${state.handoffTab}|${state.createPhase}`;
    if (viewKey !== lastViewKey && !opts.soft) {
      window.scrollTo(0, 0);
      lastViewKey = viewKey;
    }

    if (state.recipientMode) {
      ttShellMounted = false;
      const o = orders.find((x) => x.id === state.orderId);
      const rcv = state.recipientTicket?.rcv;
      const receivedHandoff =
        o && rcv && state.recipientTicket?.hv != null
          ? recipientHandoffReceived(o, rcv, state.recipientTicket.hv)
          : null;
      const resolvedInv =
        o && state.recipientTicket?.hv != null
          ? resolveInvitation(o, state.recipientTicket.hv, rcv)
          : { inv: o?.activeInvitation, stale: false };
      const staleInvite = !!(resolvedInv?.stale && resolvedInv?.inv && !receivedHandoff);
      const rcvOk = o && (
        receivedHandoff ||
        staleInvite ||
        !rcv ||
        o.pendingId === rcv ||
        o.activeInvitation?.pendingId === rcv);
      const scopeOk =
        staleInvite ||
        !Sc() ||
        Sc().canViewOrder(o, { ...scopeCtx(), externalActing: true, actorContactId: rcv || o.pendingId });
      const allowed = o && rcvOk && scopeOk;
      const recipDemo = demoHeadPopoverHtml(
        `<p class="tt-demo tt-demo-inline">Демо-данные · изменения до обновления страницы</p>${demoMaxSimulationToggleHtml()}`
      );
      main.innerHTML =
        o && allowed
          ? `<div class="tt-work tt-work-recipient"><div class="tt-head tt-head-compact tt-head-compact-demo"><span class="tt-head-compact-label">Тан-трекер</span>${recipDemo}</div>${recipientScreen(o)}${Att() ? Att().lightboxHtml() : ""}</div>`
          : `<div class="tt-work tt-recipient"><p class="tt-error" data-tt="recipient-unavailable">${deletedTrackIds.has(state.orderId) ? "Передача недоступна. Прежние ссылка, код и QR больше не действуют." : o ? "Нет доступа к этой передаче." : "Передача не найдена в демо-памяти. Откройте ссылку из того же окна прототипа."}</p></div>`;
      document.title = "Tandoor RF · Приглашение к передаче";
      let metaDesc = document.querySelector('meta[name="description"]');
      if (!metaDesc) {
        metaDesc = document.createElement("meta");
        metaDesc.setAttribute("name", "description");
        document.head.appendChild(metaDesc);
      }
      metaDesc.setAttribute(
        "content",
        "Тандор · демо-приглашение к передаче документа или предмета. Персональные данные в превью ссылки не публикуются."
      );
      let ogTitle = document.querySelector('meta[property="og:title"]');
      if (!ogTitle) {
        ogTitle = document.createElement("meta");
        ogTitle.setAttribute("property", "og:title");
        document.head.appendChild(ogTitle);
      }
      ogTitle.setAttribute("content", "Tandoor RF · Передача предмета");
      let ogDesc = document.querySelector('meta[property="og:description"]');
      if (!ogDesc) {
        ogDesc = document.createElement("meta");
        ogDesc.setAttribute("property", "og:description");
        document.head.appendChild(ogDesc);
      }
      ogDesc.setAttribute("content", "Демо-приглашение Тандор: посмотреть передачу и подтвердить получение.");
      lucide.createIcons();
      setupDetailOverflowMenu();
      if (opts.recipientFocus) {
        const selectors = String(opts.recipientFocus).split(",").map((s) => s.trim());
        requestAnimationFrame(() => {
          for (const sel of selectors) {
            const el = main.querySelector(sel);
            if (el) {
              if (!el.hasAttribute("tabindex")) el.setAttribute("tabindex", "-1");
              el.focus({ preventScroll: false });
              break;
            }
          }
        });
      }
      return;
    }

    const snap =
      opts.soft || document.activeElement?.matches?.('[data-tt="search"]') ? captureFocus() : null;
    if (opts.soft && state.view === "list" && registryPersonalFlagsReady() && patchRegistry()) {
      restoreFocus(snap);
      return;
    }
    if (opts.soft && (state.view === "create" || state.view === "transfer") && document.activeElement?.dataset?.ttField === "pickQ" && patchContactPick()) {
      restoreFocus(snap);
      return;
    }

    const ext = isExternalShell();
    const onListRegistry = !state.recipientMode && !ext && state.view === "list";
    const inCreateWizard = state.view === "create" && !ext;
    const inCreateReview = inCreateWizard && state.createPhase === "review";
    const inDetailFocus = !state.recipientMode && !ext && state.view === "detail" && !!state.orderId;
    const inCompactHead =
      inDetailFocus || inCreateWizard || state.view === "code" || state.view === "transfer" || isExternalShell();
    const chrome = inCreateWizard
      ? ""
      : ext
        ? `<p class="tt-muted">Внешний профиль: ${E(contactById(state.actingContactId)?.name || "—")}</p>`
        : `<label>Текущий сотрудник (демо)<select data-tt="employee">${Object.keys(employees)
            .map((id) => {
              const label = Sc()?.employeeDemoOptionLabel?.(id, employees) || employees[id].name;
              return `<option value="${id}" ${state.employeeId === id ? "selected" : ""}>${E(label)}</option>`;
            })
            .join("")}</select></label>`;

    const demoBody = `<p class="tt-demo tt-demo-inline">Демо-данные · изменения до обновления страницы</p>${demoMaxSimulationToggleHtml()}<div data-tt="chrome">${chrome}</div>`;
    const demoShell = "";

    const demoHeadPopover = demoHeadPopoverHtml(demoBody);

    const headBlock = inCompactHead
      ? `<div class="tt-head tt-head-compact tt-head-compact-demo"><span class="tt-head-compact-label">Тан-трекер</span>${demoHeadPopover}</div>`
      : onListRegistry
        ? `<div class="tt-head tt-registry-head"><div class="tt-registry-head-row">
        <div class="tt-registry-head-main"><h1>Тан-трекер</h1>
        <div class="tt-registry-sub-row"><p class="tt-registry-sub">Передача документов и предметов</p>${demoHeadPopover}</div></div>
        <span class="tt-head-cta-desktop" data-tt="head-cta">${btn("Создать передачу", 'data-tt="create" data-tt-main-cta', "tt-primary")}</span>
      </div></div>`
        : `<div class="tt-head"><div><h1>Тан-трекер</h1><p>Передача документов и предметов</p></div>
        <span data-tt="head-cta">${state.view === "list" && !ext ? btn("Создать передачу", 'data-tt="create" data-tt-main-cta', "tt-primary") : ""}</span>
      </div>`;

    if (!ttShellMounted) {
      main.innerHTML = `<div class="tt-work${inDetailFocus ? " tt-work-detail" : ""}${inCreateWizard ? " tt-work-wizard" : ""}" data-testid="tan-tracker" id="tt-root">
      ${headBlock}
      <div class="tt-shell-meta${inDetailFocus ? " tt-shell-meta-compact" : ""}">${demoShell}</div>
      <div id="tt-content"></div>${Att() ? Att().lightboxHtml() : ""}</div>`;
      ttShellMounted = true;
    } else {
      const root = document.getElementById("tt-root");
      if (root) {
        root.classList.toggle("tt-work-detail", inDetailFocus);
        root.classList.toggle("tt-work-wizard", inCreateWizard);
      }
      const head = document.querySelector(".tt-head");
      const headNeedsSwap =
        (inCompactHead && !head?.classList.contains("tt-head-compact-demo")) ||
        (!inCompactHead && head?.classList.contains("tt-head-compact-demo")) ||
        (onListRegistry && !head?.classList.contains("tt-registry-head")) ||
        (!onListRegistry && !inCompactHead && head?.classList.contains("tt-registry-head"));
      if (head && headNeedsSwap) {
        head.outerHTML = headBlock;
      } else {
        const cta = document.querySelector('[data-tt="head-cta"]');
        if (cta) cta.innerHTML = state.view === "list" && !ext ? btn("Создать передачу", 'data-tt="create" data-tt-main-cta', "tt-primary") : "";
        const popBody = document.querySelector(".tt-demo-head-popover .tt-demo-popover-body");
        if (popBody && (onListRegistry || inCompactHead)) popBody.innerHTML = demoBody;
      }
      const meta = document.querySelector(".tt-shell-meta");
      if (meta) {
        meta.classList.toggle("tt-shell-meta-compact", inDetailFocus);
        meta.classList.toggle("tt-shell-meta--empty", onListRegistry || inCompactHead);
        meta.innerHTML = demoShell;
      }
    }

    const content = document.getElementById("tt-content");
    if (state.archiveDialog && (cleanupPreviewReadOnly() ||
      state.archiveActorKey !== `${registryActorId()}|${state.ttPrototypeRole}`)) state.archiveDialog = null;
    if (content) content.innerHTML = `${externalActionBarHtml()}${bodyHtml()}${cleanupDialogHtml()}`;
    const cleanupDialog = document.querySelector('[data-tt="cleanup-dialog"]');
    if (cleanupDialog && !cleanupDialog.open) cleanupDialog.showModal();
    paintQrHosts();
    paintCodeCells();
    document.title = "Tandoor RF · Тан-трекер";
    applyBodyClasses();
    if (Sc() && !state.recipientMode) {
      Sc().syncReminders(orders, contacts, dt);
      document.dispatchEvent(new Event("assistant:paint"));
    }
    lucide.createIcons();
    setupDetailMobileDock();
    setupDetailOverflowMenu();
    restoreFocus(snap);
  }

  function submitOrderUpdate(o, f) {
    const actor = registryActorId();
    if (!canFullEditOrder(o, actor)) {
      state.error = "Полное редактирование доступно только инициатору-держателю до первого подтверждённого получения.";
      return;
    }
    const finalId = f.finalRecipientId || f.recipientId;
    if (!finalId) {
      state.error = "Выберите конечного получателя.";
      return;
    }
    const newPending = f.relayId || finalId;
    const oldRelay = orderHasRelayLeg(o) ? o.pendingId : "";
    const recipientChanged =
      newPending !== o.pendingId || finalId !== (o.finalRecipientId || o.pendingId) || (f.relayId || "") !== oldRelay;
    if (recipientChanged) {
      const prevPending = o.pendingId;
      if (prevPending && prevPending !== newPending) {
        o.revokedParticipants = o.revokedParticipants || [];
        if (!o.revokedParticipants.includes(prevPending)) o.revokedParticipants.push(prevPending);
      }
      o.pendingId = newPending;
    }
    o.item = f.item.trim();
    o.comment = (f.comment || "").trim();
    o.dueAt = f.due ? new Date(f.due).getTime() : null;
    o.finalRecipientId = finalId;
    archiveInvitation(o);
    o.handoffVer = (o.handoffVer ?? 0) + 1;
    o.code = null;
    syncInvitation(o);
    o.status = "waiting";
    o.timeline.push({
      at: now(),
      from: actor,
      to: o.pendingId,
      note: recipientChanged
        ? "Изменён получатель — код, QR и приглашение аннулированы"
        : "Параметры передачи изменены — код, QR и приглашение аннулированы",
    });
    applyAttachmentsFromStaging(o, actor);
    state.editOrderId = null;
    state.orderId = o.id;
    state.view = "detail";
    state.form = null;
    state.createPhase = "item";
    state.createReturnPhase = null;
    state.attachStaging = [];
    state.attachError = "";
    state.toast =
      "Передача обновлена (тот же номер). Старый код, ссылка и QR недействительны — получателю нужен новый код.";
    writeUrl();
  }

  function submitCreate() {
    syncWizardFieldsFromDom();
    const f = state.form;
    state.error = "";
    if (state.attachBusy) {
      state.error = "Дождитесь обработки файлов.";
      return;
    }
    if (state.editOrderId) {
      const existing = orders.find((x) => x.id === state.editOrderId);
      if (!existing) {
        state.error = "Передача для редактирования не найдена.";
        state.editOrderId = null;
        return;
      }
      submitOrderUpdate(existing, f);
      return;
    }
    if (!f.item.trim()) {
      state.error = "Укажите, что передаёте.";
      return;
    }
    const finalId = f.finalRecipientId || f.recipientId;
    if (!finalId) {
      state.error = "Выберите конечного получателя.";
      return;
    }
    const pendingId = f.relayId || finalId;
    const holder = employeeContact(state.employeeId);
    if (finalId === holder?.id || pendingId === holder?.id) {
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
      pendingId,
      finalRecipientId: finalId,
      createdById: holder.id,
      status: "waiting",
      dueAt,
      comment: f.comment.trim(),
      holderSince: now(),
      timeline: [
        {
          at: now(),
          from: holder.id,
          to: pendingId,
          note: f.relayId ? "Создана передача · сначала промежуточному звену" : "Создана передача · конечному получателю",
        },
      ],
      code: null,
      handoffVer: 1,
      pastInvitations: [],
    };
    if (Att() && state.attachStaging.length) {
      Att().mergeToOrder(order, state.attachStaging, holder.id);
    } else order.attachments = [];
    syncInvitation(order);
    orders.unshift(order);
    state.orderId = id;
    state.view = "detail";
    clearDetailAttDisclosure();
    state.form = null;
    state.createPhase = "item";
    state.createReturnPhase = null;
    state.attachStaging = [];
    state.attachError = "";
    state.toast = "Передача создана. Держатель — создатель; получатель ожидает код.";
    writeUrl();
  }

  document.addEventListener("click", (e) => {
    if (current === ROUTE && e.target.closest('[data-tt="registry-check-label"]')) return;
    const b = e.target.closest("[data-tt], [data-tt-open], [data-tt-pick], [data-tt-ext-pick]");
    if (!b || current !== ROUTE) return;

    const extPick = b.getAttribute("data-tt-ext-pick");
    if (extPick) {
      if (!state.extRequestForm) state.extRequestForm = {};
      state.extRequestForm.recipientId = extPick;
      state.error = "";
      renderTracker();
      return;
    }
    const o = state.orderId ? orders.find((x) => x.id === state.orderId) : null;

    if (b.hasAttribute("data-tt-open")) {
      bumpAttachOpGen();
      if (Att() && state.attachStaging.length) Att().revokeStaging(state.attachStaging);
      state.attachStaging = [];
      state.attachError = "";
      state.attachBusy = false;
      state.attachBusyGen = null;
      const nextOrderId = b.getAttribute("data-tt-open");
      if (nextOrderId !== state.orderId) clearDetailAttDisclosure();
      state.orderId = nextOrderId;
      state.view = "detail";
      state.error = state.toast = "";
      clearCompleteConfirm();
      writeUrl();
      renderTracker();
      return;
    }
    if (b.hasAttribute("data-tt-pick")) {
      if (!state.form) state.form = {};
      const pid = b.getAttribute("data-tt-pick");
      if (state.view === "transfer") {
        state.form.recipientId = pid;
        renderTracker();
        return;
      }
      if (state.createPhase === "relay-pick") state.form.relayId = pid;
      else {
        state.form.finalRecipientId = pid;
        state.form.recipientId = pid;
        state.form.recipientStep = "confirmed";
      }
      renderTracker();
      return;
    }
    const action = b.getAttribute("data-tt");
    if (action === "registry-select-all" || action === "registry-select") return;
    if (action === "registry-selection-clear") {
      state.registrySelection = [];
      paintRegistrySelection();
      document.querySelector('[data-tt="registry-select-all"]')?.focus();
      return;
    }
    if (action === "registry-batch") {
      const mode = b.getAttribute("data-mode");
      if (!cleanupPreviewReadOnly() && ["personal", "personal-restore", "archive", "restore", "delete"].includes(mode))
        openCleanup(mode, null, [...state.registrySelection]);
      return;
    }
    if (cleanupPreviewReadOnly() && [
      "registry-archive", "registry-unarchive", "registry-remove-ask",
      "registry-remove-confirm", "registry-restore-removed", "registry-unremove",
    ].includes(action)) return;
    if (action?.startsWith("cleanup-")) {
      if (action === "cleanup-cancel") closeCleanup();
      else if (action === "cleanup-confirm") confirmCleanup();
      else if (action === "cleanup-mode") openCleanup(b.getAttribute("data-mode") === "delete" ? "delete" : "archive");
      else if (action === "cleanup-open") openCleanup("archive");
      else if (action === "cleanup-personal-open") openCleanup("personal");
      else if (action === "cleanup-personal-restore") openCleanup("personal-restore");
      else if (action === "cleanup-restore-open") openCleanup("restore");
      else if (action === "cleanup-delete-one" && o) openCleanup("delete", o);
      else if (action === "cleanup-archive-one" && o) openCleanup("archive", o);
      else if (action === "cleanup-restore-one" && o) openCleanup("restore", o);
      return;
    }
    if (o && registryArchive.has(o.id) && [
      "transfer", "confirm-transfer", "transfer-final", "change-pending", "cancel-pending",
      "edit-draft", "complete", "complete-confirm", "confirm-complete", "enter-code", "confirm-code",
      "confirm-qr-receive", "gen-code", "gen-code-reissue", "attach-delete", "attach-remove", "demo-expire",
    ].includes(action)) {
      state.error = "Трек в общем архиве. Сначала администратор должен восстановить его.";
      renderTracker();
      return;
    }
    if (action === "item-suggest") {
      if (!state.form) state.form = defaultCreateForm();
      const s = b.getAttribute("data-suggest") || "";
      state.form.item = state.form.item.trim() ? `${state.form.item.trim()} · ${s}` : s;
      state.error = "";
      renderTracker();
      return;
    }
    if (action === "create" || action === "create-fab") {
      state.editOrderId = null;
      state.view = "create";
      state.createPhase = "item";
      state.createReturnPhase = null;
      state.form = defaultCreateForm();
      state.error = "";
      clearCompleteConfirm();
      clearAttachStaging();
      writeUrl();
      renderTracker();
      return;
    }
    if (action === "create-wizard-next") {
      if (state.attachBusy) {
        renderTracker();
        return;
      }
      if (wizardAdvance()) {
        writeUrl();
      }
      renderTracker();
      return;
    }
    if (action === "order-edit-cancel") {
      const oid = state.editOrderId || state.orderId;
      state.editOrderId = null;
      state.view = oid ? "detail" : "list";
      state.orderId = oid || null;
      state.form = null;
      state.createPhase = "item";
      state.createReturnPhase = null;
      clearAttachStaging();
      writeUrl();
      renderTracker();
      return;
    }
    if (action === "order-full-edit" && o) {
      const actor = registryActorId();
      if (!canFullEditOrder(o, actor)) {
        state.error = "Редактирование недоступно: нужны роль инициатора и отсутствие подтверждённой передачи.";
        renderTracker();
        return;
      }
      state.editOrderId = o.id;
      state.orderId = o.id;
      state.form = orderToCreateForm(o);
      state.createPhase = "review";
      state.createReturnPhase = null;
      loadOrderAttachmentsToStaging(o);
      state.view = "create";
      state.error = "";
      writeUrl();
      renderTracker();
      return;
    }
    if (action === "create-wizard-back") {
      if (state.editOrderId && state.createPhase === "review") {
        state.editOrderId = null;
        state.view = state.orderId ? "detail" : "list";
        state.form = null;
        state.createPhase = "item";
        clearAttachStaging();
        writeUrl();
        renderTracker();
        return;
      }
      if (state.attachBusy) {
        bumpAttachOpGen();
        state.attachBusy = false;
        state.attachBusyGen = null;
      }
      const r = wizardBack();
      if (r === "cancel") {
        state.view = "list";
        state.orderId = null;
        state.form = null;
        state.createPhase = "item";
        state.createReturnPhase = null;
        state.error = state.toast = "";
        clearCompleteConfirm();
        clearAttachStaging();
      }
      writeUrl();
      renderTracker();
      return;
    }
    if (action === "create-skip-files") {
      if (state.attachBusy) {
        renderTracker();
        return;
      }
      if (state.createPhase === "files") {
        state.error = "";
        state.createPhase = "recipient";
        writeUrl();
      }
      renderTracker();
      return;
    }
    if (action === "create-new-recipient") {
      if (!state.form) state.form = defaultCreateForm();
      state.form.mode = "new";
      state.form.pickTarget = state.createPhase === "relay-pick" ? "relay" : "final";
      state.error = "";
      state.createPhase = "recipient-new-phone";
      state.form.newPhoneStep = "phone";
      state.form.existingMatchId = "";
      state.form.recipientStep = "choose";
      writeUrl();
      renderTracker();
      return;
    }
    if (action === "create-edit-item") {
      state.createReturnPhase = "review";
      state.createPhase = "item";
      state.error = "";
      writeUrl();
      renderTracker();
      return;
    }
    if (action === "create-edit-files") {
      state.createReturnPhase = "review";
      state.createPhase = "files";
      state.error = "";
      writeUrl();
      renderTracker();
      return;
    }
    if (action === "create-recipient-browse") {
      if (!state.form) state.form = defaultCreateForm();
      state.form.recipientStep = "pick-list";
      state.error = "";
      writeUrl();
      renderTracker();
      return;
    }
    if (action === "create-recipient-back-choose" || action === "create-recipient-change") {
      if (!state.form) state.form = defaultCreateForm();
      state.form.recipientStep = action === "create-recipient-change" ? "pick-list" : "choose";
      state.error = "";
      writeUrl();
      renderTracker();
      return;
    }
    if (action === "create-edit-recipient") {
      state.createReturnPhase = "review";
      state.createPhase = "recipient";
      if (!state.form) state.form = defaultCreateForm();
      state.form.recipientStep =
        state.form.finalRecipientId || state.form.recipientId ? "confirmed" : "choose";
      state.error = "";
      writeUrl();
      renderTracker();
      return;
    }
    if (action === "create-edit-relay") {
      state.createReturnPhase = "review";
      state.createPhase = "relay-pick";
      state.error = "";
      writeUrl();
      renderTracker();
      return;
    }
    if (action === "transfer-final" && o) {
      startPending(o, o.finalRecipientId);
      state.view = "detail";
      writeUrl();
      renderTracker();
      return;
    }
    if (action === "mine-all") {
      state.mineFilter = "all";
      state.statusFilter = "all";
      renderTracker();
      return;
    }
    if (action === "mine-handoff") {
      state.mineFilter = state.mineFilter === "handoff" ? "all" : "handoff";
      if (state.mineFilter === "handoff") state.statusFilter = "all";
      renderTracker();
      return;
    }
    if (action === "mine-receive") {
      state.mineFilter = state.mineFilter === "receive" ? "all" : "receive";
      if (state.mineFilter === "receive") state.statusFilter = "all";
      renderTracker();
      return;
    }
    if (action === "mine-overdue") {
      state.statusFilter = state.statusFilter === "overdue" ? "all" : "overdue";
      if (state.statusFilter === "overdue") state.mineFilter = "all";
      renderTracker();
      return;
    }
    if (action === "registry-filter-open") {
      state.registryFilterSheet = true;
      renderTracker();
      return;
    }
    if (action === "registry-filter-close") {
      state.registryFilterSheet = false;
      renderTracker();
      return;
    }
    if (action === "filter-chip") {
      state.statusFilter = b.getAttribute("data-filter-value") || "all";
      state.registryFilterSheet = false;
      renderTracker();
      return;
    }
    if (action === "registry-preset") {
      const preset = b.getAttribute("data-preset") || "all";
      const map = {
        all: ["all", "all"],
        waiting: ["all", "waiting"],
        handoff: ["handoff", "all"],
        receive: ["receive", "all"],
        route: ["all", "route"],
        overdue: ["all", "overdue"],
        completed: ["all", "completed"],
      };
      const [mine, status] = map[preset] || ["all", "all"];
      state.mineFilter = mine;
      state.statusFilter = status;
      state.registryFilterSheet = false;
      renderTracker();
      return;
    }
    if (action === "copy-recipient-code") {
      const o = orders.find((x) => x.id === state.orderId);
      const code = o?.code?.code;
      if (code && navigator.clipboard?.writeText) {
        navigator.clipboard.writeText(code).catch(() => {});
        state.toast = "Код скопирован";
      }
      renderTracker();
      return;
    }
    if (action === "create-edit-comment") {
      state.createReturnPhase = "review";
      state.createPhase = "edit-comment";
      state.error = "";
      writeUrl();
      renderTracker();
      return;
    }
    if (action === "create-edit-due") {
      state.createReturnPhase = "review";
      state.createPhase = "edit-due";
      state.error = "";
      writeUrl();
      renderTracker();
      return;
    }
    if (action === "create-wizard-submit") {
      if (state.attachBusy) {
        renderTracker();
        return;
      }
      submitCreate();
      renderTracker();
      return;
    }
    if (action === "back-list" || action === "terminal-back-list") {
      state.view = "list";
      state.orderId = null;
      state.form = null;
      state.createPhase = "item";
      state.createReturnPhase = null;
      state.error = state.toast = "";
      state.handoffReceipt = null;
      clearCompleteConfirm();
      clearDetailAttDisclosure();
      clearAttachStaging();
      writeUrl();
      renderTracker();
      return;
    }
    if (action === "detail" && o) {
      state.view = "detail";
      state.codeDemoRevealed = false;
      clearCompleteConfirm();
      writeUrl();
      renderTracker();
      return;
    }
    if (action === "transfer" && o) {
      bumpAttachOpGen();
      state.attachBusy = false;
      state.attachBusyGen = null;
      state.view = "transfer";
      state.form = { pickQ: "", mode: "list" };
      state.error = "";
      clearCompleteConfirm();
      writeUrl();
      renderTracker();
      return;
    }
    if ((action === "enter-code" || action === "enter-code-dock") && o) {
      state.view = "code";
      state.codeInput = "";
      state.error = "";
      state.toast = "";
      state.codeDemoRevealed = false;
      writeUrl();
      renderTracker();
      return;
    }
    if (action === "demo-reveal-code" && o) {
      ensureDemoCodeForHolder(o);
      writeUrl();
      renderTracker();
      return;
    }
    if (action === "toggle-new") {
      if (!state.form) state.form = {};
      state.form.mode = state.form.mode === "new" ? "list" : "new";
      if (state.form.mode === "new") {
        state.form.newPhoneStep = "phone";
        state.form.existingMatchId = "";
        state.form.newName = "";
        state.form.newPhone = "";
      }
      renderTracker();
      return;
    }
    if (action === "transfer-phone-next" && o && state.form?.mode === "new") {
      document.querySelectorAll('[data-tt-field="newPhone"], [data-tt-field="newName"]').forEach((el) => {
        state.form[el.getAttribute("data-tt-field")] = el.value;
      });
      const existing = contactByPhone(state.form.newPhone);
      if (existing) {
        state.form.existingMatchId = existing.id;
        state.error = "";
      } else if (!normPhone(state.form.newPhone)) {
        state.error = "Введите телефон: 10 цифр после +7 (демо).";
      } else {
        state.form.existingMatchId = "";
        state.form.newPhoneStep = "name";
        state.error = "";
      }
      renderTracker();
      return;
    }
    if (action === "pick-existing" || action === "pick-existing-wizard") {
      const cid = state.form?.existingMatchId || contactByPhone(state.form?.newPhone)?.id;
      if (!cid) return;
      if (state.view === "transfer") {
        state.form.recipientId = cid;
        state.form.mode = "list";
        state.form.existingMatchId = "";
      } else {
        state.form.finalRecipientId = cid;
        state.form.recipientId = cid;
        state.form.recipientStep = "confirmed";
        state.createPhase = state.form.pickTarget === "relay" ? "review" : "recipient";
      }
      state.error = "";
      renderTracker();
      return;
    }
    if (action === "confirm-transfer" && o && state.form) {
      let rid = state.form.recipientId;
      if (state.form.mode === "new") {
        document.querySelectorAll('[data-tt-field="newPhone"], [data-tt-field="newName"]').forEach((el) => {
          state.form[el.getAttribute("data-tt-field")] = el.value;
        });
        if (state.form.existingMatchId) {
          rid = state.form.existingMatchId;
        } else if (state.form.newPhoneStep !== "name") {
          const existing = contactByPhone(state.form.newPhone);
          if (existing) {
            state.form.existingMatchId = existing.id;
            state.error = "";
            renderTracker();
            return;
          }
          if (!normPhone(state.form.newPhone)) {
            state.error = "Введите телефон: 10 цифр после +7 (демо).";
            renderTracker();
            return;
          }
          state.form.newPhoneStep = "name";
          state.error = "";
          renderTracker();
          return;
        }
        if (!state.form.newName?.trim() && !state.form.existingMatchId) {
          state.error = "Введите имя нового контакта.";
          renderTracker();
          return;
        }
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
      const senderBefore = state.actingContactId || employeeContact(state.employeeId)?.id;
      const previewTicket = o.activeInvitation
        ? {
            orderId: o.id,
            hv: String(o.activeInvitation.hv),
            rcv: o.pendingId,
            st: o.activeInvitation.startTokenPlain || "",
          }
        : null;
      if (tryConfirmCode(o, state.codeInput)) {
        if (previewTicket && contactById(o.holderId)?.kind === "external") {
          state.recipientReceivedPreview = previewTicket;
        }
        afterCodeSend(o, senderBefore);
      }
      writeUrl();
      renderTracker();
      return;
    }
    if (action === "complete" && o) {
      state.error = "";
      const actor = state.actingContactId || employeeContact(state.employeeId)?.id;
      if (orderIsCompleted(o)) state.error = "Передача уже завершена.";
      else if (o.pendingId) state.error = "Сначала отмените ожидание или подтвердите передачу.";
      else if (!canExplicitComplete(o, actor)) state.error = "Завершить передачу сейчас нельзя.";
      else state.completeConfirmOrderId = o.id;
      writeUrl();
      renderTracker();
      return;
    }
    if (action === "cancel-complete") {
      clearCompleteConfirm();
      renderTracker();
      return;
    }
    if (action === "confirm-complete" && o) {
      if (state.completeConfirmOrderId !== o.id) {
        renderTracker();
        return;
      }
      clearCompleteConfirm();
      completeOrder(o);
      writeUrl();
      renderTracker();
      return;
    }
    if (action === "change-pending" && o) {
      const actor = state.actingContactId || employeeContact(state.employeeId)?.id;
      if (o.holderId !== actor) {
        state.error = "Изменить получателя может только текущий держатель.";
        renderTracker();
        return;
      }
      if (!o.pendingId) {
        state.error = "Нет ожидающего получателя.";
        renderTracker();
        return;
      }
      state.view = "transfer";
      state.form = {
        pickQ: "",
        recipientId: o.pendingId,
        mode: "list",
        newName: "",
        newPhone: "",
      };
      state.error = "";
      writeUrl();
      renderTracker();
      return;
    }
    if (action === "cancel-pending" && o) {
      cancelPending(o);
      clearCompleteConfirm();
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
      if (window.innerWidth < 768) scrollQrIntoView();
      return;
    }
    if (action === "recipient-welcome-continue" && o) {
      const ticketHv = state.recipientTicket?.hv;
      const ticketRcv = state.recipientTicket?.rcv;
      const resolved =
        ticketHv != null ? resolveInvitation(o, ticketHv, ticketRcv) : { inv: o.activeInvitation, stale: false };
      if (recipientInvitationBlocked(o, resolved).blocked) {
        resetRecipientWelcome();
        renderTracker();
        return;
      }
      state.recipientWelcomeAck = true;
      renderTracker({ recipientFocus: '[data-tt="recipient-messenger-preamble"], [data-tt="recipient-step-channel"], [data-tt="recipient-screen"] h2' });
      return;
    }
    if (action === "scan-qr-demo" && o) {
      state.recipientMode = true;
      state.recipientVia = "qr";
      resetRecipientIdentity();
      resetRecipientWelcome();
      if (o.activeInvitation) {
        state.recipientTicket = {
          hv: String(o.activeInvitation.hv),
          rcv: o.activeInvitation.pendingId,
          order: o.id,
          st: o.activeInvitation.startTokenPlain || "",
        };
      }
      writeUrl();
      renderTracker();
      return;
    }
    if (action === "open-recipient" && o) {
      state.recipientMode = true;
      state.recipientVia = state.handoffTab === "qr" ? "qr" : "code";
      resetRecipientIdentity();
      resetRecipientWelcome();
      if (o.activeInvitation) {
        state.recipientTicket = {
          hv: String(o.activeInvitation.hv),
          rcv: o.activeInvitation.pendingId,
          order: o.id,
          st: o.activeInvitation.startTokenPlain || "",
        };
      }
      writeUrl();
      renderTracker();
      return;
    }
    if (action === "confirm-qr-receive" && o) {
      const ticket = resolveInvitation(o, state.recipientTicket?.hv ?? o.activeInvitation?.hv);
      if (tryConfirmQr(o, ticket)) afterQrReceive(o);
      writeUrl();
      renderTracker();
      return;
    }
    if (action === "exit-recipient") {
      state.recipientMode = false;
      state.view = "detail";
      ttShellMounted = false;
      writeUrl();
      renderTracker();
      return;
    }
    if (action === "open-holder-page" && o) {
      const rcv = state.recipientTicket?.rcv || o.holderId;
      state.recipientMode = false;
      state.recipientTicket = null;
      state.actingContactId = rcv;
      state.view = "detail";
      state.orderId = o.id;
      ttShellMounted = false;
      lastViewKey = "";
      writeUrl();
      renderTracker();
      return;
    }
    if (action === "preview-recipient-received" && o) {
      const p = state.recipientReceivedPreview;
      if (!p || p.orderId !== o.id) return;
      state.recipientMode = true;
      state.recipientVia = "code";
      state.recipientTicket = { hv: p.hv, rcv: p.rcv, order: o.id, st: p.st || "" };
      resetRecipientIdentity();
      resetRecipientWelcome();
      writeUrl();
      renderTracker();
      return;
    }
    if (action === "act-recipient" && o && o.pendingId) {
      bumpAttachOpGen();
      state.attachBusy = false;
      state.attachBusyGen = null;
      state.actingContactId = o.pendingId;
      state.recipientMode = false;
      state.view = "detail";
      clearCompleteConfirm();
      writeUrl();
      renderTracker();
      return;
    }
    if (action === "act-holder" && o) {
      bumpAttachOpGen();
      state.attachBusy = false;
      state.attachBusyGen = null;
      state.actingContactId = o.holderId;
      state.view = "detail";
      clearCompleteConfirm();
      ttShellMounted = false;
      lastViewKey = "";
      writeUrl();
      renderTracker();
      return;
    }
    if (action === "ext-request-open") {
      const extId = state.actingContactId;
      if (!extId || !isExternalShell()) return;
      if (externalOpenRequestCount(extId) >= 5) {
        state.extRequestPhase = "blocked";
        state.extRequestForm = {};
        state.view = "ext-request";
        state.error = "";
      } else {
        state.extRequestPhase = "item";
        state.extRequestForm = { item: "", comment: "", recipientId: "", duePreset: "today" };
        state.view = "ext-request";
        state.error = "";
        clearAttachStaging();
      }
      writeUrl();
      renderTracker();
      return;
    }
    if (action === "ext-request-close") {
      state.extRequestPhase = null;
      state.extRequestForm = null;
      state.view = "list";
      state.error = "";
      if (state.attachStaging.length) clearAttachStaging();
      writeUrl();
      renderTracker();
      return;
    }
    if (action === "ext-request-back") {
      const order = EXT_REQUEST_PHASES;
      const idx = order.indexOf(state.extRequestPhase || "item");
      if (idx <= 0) {
        state.view = "list";
        state.extRequestPhase = null;
        state.extRequestForm = null;
        if (state.attachStaging.length) clearAttachStaging();
      } else state.extRequestPhase = order[idx - 1];
      state.error = "";
      writeUrl();
      renderTracker();
      return;
    }
    if (action === "ext-request-next") {
      syncExtRequestFieldsFromDom();
      const f = state.extRequestForm || {};
      const phase = state.extRequestPhase || "item";
      state.error = "";
      if (phase === "item" && !f.item?.trim()) {
        state.error = "Укажите, что передаёте.";
        renderTracker();
        return;
      }
      if (phase === "recipient" && !f.recipientId) {
        state.error = "Выберите получателя.";
        renderTracker();
        return;
      }
      const idx = EXT_REQUEST_PHASES.indexOf(phase);
      state.extRequestPhase = EXT_REQUEST_PHASES[Math.min(idx + 1, EXT_REQUEST_PHASES.length - 1)];
      writeUrl();
      renderTracker();
      return;
    }
    if (action === "ext-due-today") {
      if (!state.extRequestForm) state.extRequestForm = {};
      state.extRequestForm.duePreset = "today";
      renderTracker();
      return;
    }
    if (action === "ext-due-tomorrow") {
      if (!state.extRequestForm) state.extRequestForm = {};
      state.extRequestForm.duePreset = "tomorrow";
      renderTracker();
      return;
    }
    if (action === "ext-request-create") {
      submitExternalRequest();
      writeUrl();
      renderTracker();
      return;
    }
    if (action === "ext-request-open-order") {
      const id = state.extRequestForm?.createdId;
      if (!id) return;
      state.orderId = id;
      state.view = "detail";
      state.extRequestPhase = null;
      state.extRequestForm = null;
      writeUrl();
      renderTracker();
      return;
    }
    if (action === "ext-request-decline" && o) {
      const actor = state.actingContactId || employeeContact(state.employeeId)?.id;
      if (o.pendingId !== actor || !o.fromExternal) {
        state.error = "Отклонить может только назначенный сотрудник.";
        renderTracker();
        return;
      }
      state.extDeclineConfirmOrderId = o.id;
      renderTracker();
      return;
    }
    if (action === "ext-decline-cancel") {
      state.extDeclineConfirmOrderId = null;
      renderTracker();
      return;
    }
    if (action === "ext-decline-confirm" && o) {
      if (state.extDeclineConfirmOrderId !== o.id) return;
      const actor = state.actingContactId || employeeContact(state.employeeId)?.id;
      const extId = o.createdById;
      o.timeline.push({ at: now(), from: actor, to: extId, note: "Заявка отклонена" });
      o.pendingId = null;
      o.status = "completed";
      archiveInvitation(o);
      o.activeInvitation = null;
      state.extDeclineConfirmOrderId = null;
      state.toast = "Заявка отклонена.";
      writeUrl();
      renderTracker();
      return;
    }
    if (action === "clear-act") {
      bumpAttachOpGen();
      state.attachBusy = false;
      state.attachBusyGen = null;
      state.actingContactId = null;
      state.extRequestPhase = null;
      state.extRequestForm = null;
      clearCompleteConfirm();
      ttShellMounted = false;
      lastViewKey = "";
      renderTracker();
      return;
    }
    if (action === "reset-filters") {
      state.query = "";
      state.statusFilter = "all";
      state.mineFilter = "all";
      renderTracker();
      return;
    }
    if (action === "registry-view-main" || action === "registry-empty-main") {
      state.registryPersonalView = "main";
      renderTracker();
      return;
    }
    if (action === "registry-view-general-archive") {
      state.registryPersonalView = "registry-archive";
      state.statusFilter = state.mineFilter = "all";
      state.query = "";
      renderTracker();
      return;
    }
    if (action === "registry-view-archived") {
      state.registryPersonalView = "archived";
      state.statusFilter = "all";
      state.mineFilter = "all";
      renderTracker();
      return;
    }
    if (action === "registry-view-removed") {
      state.registryPersonalView = "removed";
      state.statusFilter = "all";
      state.mineFilter = "all";
      renderTracker();
      return;
    }
    if (action === "registry-remove-ask" && o) {
      const actor = registryActorId();
      if (!canInitiatorRemoveFromRegistry(o, actor)) {
        state.error = "Убрать из общего реестра может только инициатор передачи.";
        renderTracker();
        return;
      }
      state.registryConfirmRemoveOrderId = o.id;
      state.error = "";
      renderTracker();
      return;
    }
    if (action === "registry-remove-cancel") {
      state.registryConfirmRemoveOrderId = null;
      renderTracker();
      return;
    }
    if (action === "registry-remove-confirm" && o) {
      const actor = registryActorId();
      const RP = RegPersonal();
      if (!RP || !canInitiatorRemoveFromRegistry(o, actor)) {
        state.error = "Нельзя убрать эту передачу из реестра.";
        state.registryConfirmRemoveOrderId = null;
        renderTracker();
        return;
      }
      RP.addRemoved(o.id, actor);
      state.registryConfirmRemoveOrderId = null;
      const dsRem = window.NotificationDemoStore;
      if (dsRem?.isApiEnabled?.() && dsRem.getSaveStatus() === "failed") {
        state.error = "Не удалось сохранить настройку реестра в демо-хранилище.";
        state.toast = "";
      } else {
        state.toast =
          "Передача убрана из общего списка. Другие участники видят её как прежде; при вашем обязательстве она остаётся в фильтрах передачи и получения.";
        state.error = "";
      }
      if (state.view === "detail") state.view = "list";
      writeUrl();
      renderTracker();
      return;
    }
    if (action === "registry-archive" && o) {
      const actor = registryActorId();
      const RP = RegPersonal();
      if (!RP || !canPersonalArchive(o, actor)) {
        state.error = "В мой архив можно убрать только выполненную передачу без ожидаемого получения, из вашей области видимости.";
        renderTracker();
        return;
      }
      RP.addArchived(o.id, actor);
      const ds = window.NotificationDemoStore;
      if (ds?.isApiEnabled?.() && ds.getSaveStatus() === "failed") {
        state.error = "Не удалось сохранить архив в демо-хранилище.";
        state.toast = "";
      } else {
        state.toast = "Передача в вашем архиве.";
        state.error = "";
      }
      renderTracker();
      return;
    }
    if (action === "registry-unarchive" && o) {
      const actor = registryActorId();
      if (cleanupPreviewReadOnly() || !actorRegistrySeesOrder(o, actor)) return;
      RegPersonal()?.removeArchived(o.id, actor);
      state.toast = "Передача снова в основном реестре.";
      renderTracker();
      return;
    }
    if (action === "registry-unremove" && o) {
      const actor = registryActorId();
      if (!isRegistryInitiator(o, actor)) {
        state.error = "Восстановить может только инициатор.";
        renderTracker();
        return;
      }
      RegPersonal()?.removeRemoved(o.id, actor);
      state.toast = "Передача восстановлена в реестре.";
      state.registryPersonalView = "main";
      renderTracker();
      return;
    }
    if (action === "demo-expire" && o?.code) {
      o.code.expiresAt = now() - 1000;
      renderTracker();
      return;
    }
    if (action === "gen-code" || action === "gen-code-reissue") {
      const order = o || orders.find((x) => x.id === state.orderId);
      if (!order) return;
      state.messengerError = "";
      if (!identityVerified(order)) {
        state.messengerError = "Сначала подтвердите номер через выбранный мессенджер.";
      } else {
        generateCode(order, { forceReissue: action === "gen-code-reissue" });
      }
      renderTracker();
      return;
    }
    if (action === "pick-channel") {
      const order = o || orders.find((x) => x.id === state.orderId);
      const ch = b.getAttribute("data-channel");
      if (!order || !ch) return;
      const avail = Ms()?.channelAvailability?.()?.[ch];
      if (!avail?.available) {
        state.messengerError = avail?.reason || "Канал недоступен.";
        renderTracker();
        return;
      }
      if (state.recipientChannel && state.recipientChannel !== ch) {
        order.code = null;
        state.messengerError = "Канал изменён — прежний код аннулирован. Подтвердите номер снова.";
        resetPhoneIdentity();
        state.messengerVerified = false;
        state.messengerVerifiedKey = "";
      }
      state.recipientChannel = ch;
      renderTracker();
      return;
    }
    if (action === "switch-channel") {
      const order = o || orders.find((x) => x.id === state.orderId);
      if (order) {
        order.code = null;
        resetRecipientIdentity();
      }
      renderTracker();
      return;
    }
    if (action === "messenger-share-own") {
      const order = o || orders.find((x) => x.id === state.orderId);
      if (!order || !state.recipientChannel) return;
      const pending = contactById(order.pendingId);
      (async () => {
        let payload;
        if (state.recipientChannel === "telegram") {
          payload = Ms()?.buildTelegramOwnContactPayload?.(pending?.phone);
        } else {
          payload = await Ms()?.buildMaxOwnContactPayload?.(pending?.phone);
        }
        const result = await Ms()?.verifyContactProof?.({
          channel: state.recipientChannel,
          pendingPhone: pending?.phone,
          scenario: "own",
          payload,
        });
        if (!result?.ok) {
          state.messengerError = result?.error || "Подтверждение отклонено.";
          state.messengerVerified = false;
        } else {
          state.messengerError = "";
          state.messengerVerified = true;
          state.messengerVerifiedKey = recipientKey(order);
          state.phoneVerified = true;
          state.phoneVerifiedKey = recipientKey(order);
        }
        renderTracker();
      })();
      return;
    }
    if (action === "copy-invite-link" && o) {
      const inv = o.activeInvitation;
      const url = inv ? handoffUrl(o, inv) : "";
      if (url && navigator.clipboard?.writeText) {
        navigator.clipboard.writeText(new URL(url, location.href).href).then(() => {
          state.toast = "Ссылка скопирована";
          renderTracker();
        }).catch(() => {
          state.toast = "Копирование недоступно. Выделите и скопируйте ссылку ниже.";
          renderTracker();
        });
      } else if (url) {
        state.toast = "Копирование недоступно. Выделите и скопируйте ссылку ниже.";
        renderTracker();
      }
      return;
    }
    if (action === "copy-invite-message" && o) {
      const inv = o.activeInvitation;
      const url = inv ? handoffUrl(o, inv) : "";
      const text = inv ? invitationMessagePlain(o, inv, url) : "";
      if (text && navigator.clipboard?.writeText) {
        navigator.clipboard.writeText(text).then(() => {
          state.toast = "Текст приглашения скопирован";
          renderTracker();
        }).catch(() => {
          state.toast = "Копирование недоступно. Выделите и скопируйте текст приглашения ниже.";
          renderTracker();
        });
      } else if (text) {
        state.toast = "Копирование недоступно. Выделите и скопируйте текст приглашения ниже.";
        renderTracker();
      }
      return;
    }
    if (action === "attach-remove") {
      const sid = b.getAttribute("data-staging-id");
      const i = state.attachStaging.findIndex((x) => x.id === sid);
      if (i >= 0 && Att()) {
        Att().untrackUrl(state.attachStaging[i].url);
        state.attachStaging.splice(i, 1);
      }
      renderTracker();
      return;
    }
    if (action === "attach-preview") {
      const attId = b.getAttribute("data-att-id");
      const oid = b.getAttribute("data-order") || state.orderId;
      const a = resolveAttachment(oid, attId) || state.attachStaging.find((x) => x.id === attId);
      if (a) openAttachLightbox(a, b);
      return;
    }
    if (action === "attach-lightbox-close") {
      closeAttachLightbox();
      return;
    }
    if (action === "demo-verify-phone") {
      const order = o || orders.find((x) => x.id === state.orderId);
      if (!order) return;
      state.recipientChannel = "telegram";
      const pending = contactById(order.pendingId);
      const payload = Ms()?.buildTelegramOwnContactPayload?.(pending?.phone);
      Ms()?.verifyContactProof?.({
        channel: "telegram",
        pendingPhone: pending?.phone,
        scenario: "own",
        payload,
      }).then((result) => {
        if (result?.ok) {
          state.messengerVerified = true;
          state.messengerVerifiedKey = recipientKey(order);
          state.phoneVerified = true;
          state.phoneVerifiedKey = recipientKey(order);
          state.messengerError = "";
        } else state.messengerError = result?.error || "Подтверждение отклонено.";
        renderTracker();
      });
      return;
    }
  });

  document.addEventListener("input", (e) => {
    if (current !== ROUTE) return;
    if (e.target.matches('[data-tt="cleanup-reason"]')) {
      state.archiveReason = e.target.value;
      return;
    }
    if (e.target.matches('[data-tt="cleanup-delete-ack"]')) {
      state.archiveTypedAck = e.target.value;
      updateCleanupSummary();
      return;
    }
    if (e.target.matches("[data-tt-field]")) {
      if (!state.form) state.form = {};
      state.form[e.target.getAttribute("data-tt-field")] = e.target.value;
      if (e.target.getAttribute("data-tt-field") === "pickQ") renderTracker({ soft: true });
      if (
        e.target.getAttribute("data-tt-field") === "newPhone" &&
        (state.form.existingMatchId || state.form.newPhoneStep === "name")
      ) {
        // Номер изменился после проверки — сбрасываем результат поиска, чтобы «Далее» проверил его заново.
        state.form.existingMatchId = "";
        state.form.newPhoneStep = "phone";
        state.error = "";
        renderTracker({ soft: true });
      }
      if (e.target.getAttribute("data-tt-field") === "extComment" && state.extRequestForm) {
        state.extRequestForm.comment = e.target.value;
        const next = document.querySelector('[data-tt="ext-request"] [data-tt="ext-request-next"]');
        if (next) next.textContent = e.target.value.trim() ? "Далее" : "Пропустить";
      }
    }
    if (e.target.matches('[data-tt="search"]')) {
      state.query = e.target.value;
      renderTracker({ soft: true });
    }
    if (e.target.matches('[data-tt="code-input"]')) {
      state.codeInput = e.target.value.replace(/\D/g, "").slice(0, 6);
      e.target.value = state.codeInput;
      paintCodeCells();
    }
  });

  function syncDetailAttDisclosureFromToggle(det) {
    if (!det?.matches?.('[data-tt="detail-attachments-disclosure"]')) return;
    const o = state.orderId ? orders.find((x) => x.id === state.orderId) : null;
    if (!o || state.view !== "detail") return;
    if (det.open) state.detailAttDisclosureOpen = { orderId: o.id, actorId: detailActorKey() };
    else if (isDetailAttDisclosureOpen(o)) clearDetailAttDisclosure();
  }

  document.addEventListener(
    "toggle",
    (e) => {
      if (current !== ROUTE) return;
      syncDetailAttDisclosureFromToggle(e.target);
    },
    true
  );

  document.addEventListener(
    "click",
    (e) => {
      if (current !== ROUTE) return;
      if (!e.target.closest('[data-tt="detail-attachments-disclosure"] summary')) return;
      const det = e.target.closest('[data-tt="detail-attachments-disclosure"]');
      if (!det) return;
      queueMicrotask(() => syncDetailAttDisclosureFromToggle(det));
    },
    true
  );

  document.addEventListener("change", (e) => {
    if (current !== ROUTE) return;
    if (e.target.matches('[data-tt="registry-select"], [data-tt="registry-select-all"]')) {
      if (cleanupPreviewReadOnly()) return;
      if (e.target.matches('[data-tt="registry-select-all"]')) {
        state.registrySelection = e.target.checked ? [...state.registryVisibleIds] : [];
      } else if (state.registryVisibleIds.includes(e.target.value)) {
        state.registrySelection = e.target.checked ? [...new Set([...state.registrySelection, e.target.value])] :
          state.registrySelection.filter((id) => id !== e.target.value);
      }
      paintRegistrySelection();
      return;
    }
    if (e.target.matches('[data-tt="cleanup-select"]')) {
      const id = e.target.value;
      if (e.target.checked) state.archiveSelection = [...new Set([...state.archiveSelection, id])];
      else state.archiveSelection = state.archiveSelection.filter((x) => x !== id);
      updateCleanupSummary();
      return;
    }
    if (e.target.matches('[data-tt="cleanup-scope"]')) {
      state.archiveScope = e.target.value === "all" ? "all" : "selected";
      state.archiveAllAck = false;
      renderTracker();
      return;
    }
    if (e.target.matches('[data-tt="cleanup-ack"]')) {
      state.archiveAllAck = e.target.checked;
      updateCleanupSummary();
      return;
    }
    if (e.target.matches('[data-tt="filter"]')) {
      state.statusFilter = e.target.value;
      renderTracker();
    }
    if (e.target.matches('[data-tt="employee"]')) {
      bumpAttachOpGen();
      state.attachBusy = false;
      state.attachBusyGen = null;
      state.employeeId = e.target.value;
      if (!state.ttRoleUnsupported && Sc()?.effectiveRoleForEmployee) {
        state.ttPrototypeRole = Sc().effectiveRoleForEmployee(state.employeeId);
        lastPrototypeRoleSynced = state.ttPrototypeRole;
      }
      state.actingContactId = null;
      clearCompleteConfirm();
      clearDetailAttDisclosure();
      writeUrl();
      renderTracker();
    }
    if (e.target.matches('[data-tt="attach-input"]')) {
      const key = e.target.getAttribute("data-input-key") || "create";
      const files = [...e.target.files];
      e.target.value = "";
      ingestFiles(files, key === "create" ? "create" : "detail");
    }
  });

  document.addEventListener("change", (e) => {
    if (current !== ROUTE) return;
    if (!e.target.matches?.('[data-tt="demo-max-enabled"]')) return;
    const cfg = ensureMessengerDemoConfig();
    cfg.maxEnabled = e.target.checked === true;
    if (!cfg.maxEnabled && state.recipientChannel === "max") {
      state.recipientChannel = null;
      resetRecipientIdentity();
    }
    renderTracker();
  });

  document.addEventListener("keydown", (e) => {
    if (current !== ROUTE) return;
    if (e.key === "Escape") closeAttachLightbox();
    if (e.key !== "Enter" || e.isComposing || state.view !== "create" || state.attachBusy) return;
    const field = e.target.closest?.("[data-tt-field]");
    if (!field || !field.closest('[data-tt="create-wizard"]')) return;
    if (field.matches("textarea")) return;
    e.preventDefault();
    syncWizardFieldsFromDom();
    if (state.createPhase === "review") return;
    if (wizardAdvance()) writeUrl();
    renderTracker();
  });

  document.addEventListener("cancel", (e) => {
    if (e.target.matches?.('[data-tt="cleanup-dialog"]')) {
      e.preventDefault();
      closeCleanup();
    }
  }, true);

  add("tan-tracker", "Тан-трекер", "Передача документов и предметов", "Менеджер", "tan-tracker", "", "");
  const priorNav = roleNav;
  roleNav = function (items) {
    const rows = priorNav(items);
    if (rows.some((r) => r[0] === ROUTE)) return rows;
    const assistantOnly = rows.length > 0 && rows.every((r) => String(r[0]).startsWith("assistant"));
    if (assistantOnly) return rows;
    const at = rows.findIndex((r) => r[0] === "handover");
    const insert = [ROUTE, "Тан-трекер", "package-check", ROUTE];
    if (at >= 0) rows.splice(at + 1, 0, insert);
    else rows.push(insert);
    return rows;
  };

  function syncShellNav() {
    const route = location.hash.slice(1).split("?")[0] || "";
    if (route === ROUTE) current = ROUTE;
    if (current === ROUTE) render();
    else priorRender();
  }

  const priorRender = render;
  render = function () {
    const onRoute = current === ROUTE;
    if (!onRoute) {
      leaveRouteCleanup();
      priorRender();
      return;
    }
    readUrl();
    ttShellMounted = false;
    priorRender();
    const s = screens.find((x) => x.id === ROUTE);
    if (s) document.querySelector('.sidebar .nav button[data-go="tan-tracker"]')?.classList.add("active");
    renderTracker();
  };
  window.addEventListener("hashchange", () => {
    const route = location.hash.slice(1).split("?")[0] || "clients";
    if (route !== ROUTE) leaveRouteCleanup();
    else {
      current = ROUTE;
      render();
    }
  });

  function effectiveProfile() {
    if (state.ttRoleUnsupported) return { role: "manager", person: state.employeeId || "m1", label: "Менеджер" };
    const role = state.ttPrototypeRole || "manager";
    const person = state.employeeId || Sc()?.ROLE_EMPLOYEE?.[role] || "m1";
    const label = Sc()?.DEMO_ROLE_LABEL?.[role] || role;
    return { role, person, label };
  }

  window.TanTrackerPrototype = {
    orders: () => orders,
    contacts: () => contacts,
    state,
    employeeId: () => state.employeeId,
    effectiveProfile,
    canViewOrder: (orderId) => {
      const o = orders.find((x) => x.id === orderId);
      return o && orderVisible(o);
    },
    seed: () => {
      seedContacts();
      seedOrders();
      registryArchive.clear();
      registryArchiveAudit.clear();
      deletedTrackIds.clear();
    },
    routeActive: () => current === ROUTE,
    async simulateMessengerContact(scenario, payloadExtra) {
      const order = orders.find((x) => x.id === state.orderId);
      if (!order || !state.recipientChannel) return { ok: false, error: "no channel" };
      const pending = contactById(order.pendingId);
      let payload = payloadExtra;
      if (!payload) {
        if (state.recipientChannel === "telegram") {
          payload = Ms()?.buildTelegramOwnContactPayload?.(pending?.phone);
        } else {
          payload = await Ms()?.buildMaxOwnContactPayload?.(pending?.phone);
        }
      }
      const result = await Ms()?.verifyContactProof?.({
        channel: state.recipientChannel,
        pendingPhone: pending?.phone,
        scenario: scenario || "own",
        payload,
      });
      if (result?.ok) {
        state.messengerVerified = true;
        state.messengerVerifiedKey = recipientKey(order);
        state.phoneVerified = true;
        state.phoneVerifiedKey = recipientKey(order);
        state.messengerError = "";
      } else state.messengerError = result?.error || "fail";
      return result;
    },
    pickMessengerChannel(ch) {
      state.recipientChannel = ch;
    },
    canFullEditOrder: (orderId) => {
      const o = orders.find((x) => x.id === orderId);
      return o && canFullEditOrder(o, registryActorId());
    },
    orderCreatorId,
    hasFirstConfirmedCustodyHandoff,
  };

  const paintAfterRegPersonalReady = () => {
    if (current !== ROUTE) return;
    renderTracker();
  };
  RegPersonal()?.init?.()?.then?.(paintAfterRegPersonalReady)?.catch?.(() => {});
  syncShellNav();
})();
