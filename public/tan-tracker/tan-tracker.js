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
    d1: { id: "d1", name: "Андрей Власов", phone: "79001234090", team: null },
    r1: { id: "r1", name: "Елена Волкова", phone: "79001234040", team: "volkova" },
    r2: { id: "r2", name: "Дмитрий Орлов", phone: "79001234041", team: "orlov" },
    m1: { id: "m1", name: "Алексей Морозов", phone: "79001234001", team: "volkova" },
    m2: { id: "m2", name: "Дмитрий Петров", phone: "79001234002", team: "orlov" },
    m3: { id: "m3", name: "Иван Орлов", phone: "79001234003", team: "orlov" },
    a1: { id: "a1", name: "Анна Белова", phone: "79001234011", team: "volkova" },
    c1: { id: "c1", name: "Наталья Савельева", phone: "79001234021", team: "volkova" },
  };
  const Sc = () => window.TanTrackerScope;
  const fmtPhone = (digits) => {
    const core = fmtPhoneCore(digits);
    const lkRuntime = (typeof TT_LK !== "undefined" && TT_LK) || window.__TT_PUBLIC_RECIPIENT__;
    if (lkRuntime) return core;
    return `${core} · демо`;
  };
  const fmtPhoneCore = (digits) => {
    const d = String(digits).replace(/\D/g, "");
    if (d.length < 11) return "+7 (900) 000-00-XX";
    return `+7 (${d.slice(1, 4)}) ${d.slice(4, 7)}-${d.slice(7, 9)}-${d.slice(9, 11)}`;
  };
  const maskPhone = (digits) => {
    const d = String(digits).replace(/\D/g, "");
    const lkRuntime = (typeof TT_LK !== "undefined" && TT_LK) || window.__TT_PUBLIC_RECIPIENT__;
    if (d.length < 4) return lkRuntime ? "+7 ··· ···-··-XX" : "··· · демо";
    const core = `+7 ··· ···-··-${d.slice(-2)}`;
    return lkRuntime ? core : `${core} · демо`;
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

  function actorContactId() {
    if (TT_LK) return state.actingContactId || state.lkActorPartyId || null;
    return state.actingContactId || employeeContact(state.employeeId)?.id;
  }

  function scopeCtx() {
    const actor = actorContactId();
    const role = state.ttRoleUnsupported ? null : state.ttPrototypeRole || "manager";
    return {
      prototypeRole: role,
      employeeId: TT_LK ? state.lkLinkedEmployeeId || null : state.employeeId,
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
      state.actingContactId = null;
      bumpAttachOpGen();
      lastPrototypeRoleSynced = role;
    }
  }

  function orderVisible(o) {
    if (!o) return false;
    if (isPublicGuestPage()) return orders.some((x) => x.id === o.id);
    if (TT_LK) return orders.some((x) => x.id === o.id);
    if (!Sc()) return true;
    return Sc().canViewOrder(o, scopeCtx());
  }

  function deniedView() {
    return `<div class="tt-panel tt-denied" data-tt="access-denied"><h2>Нет доступа к этой передаче</h2><p>По правам прототипа эта передача недоступна. Содержимое и файлы не показываются.</p>${btn("← К реестру", 'data-tt="back-list"')}</div>`;
  }

  function unsupportedRoleView() {
    const label = state.ttRequestedRole ? `«${state.ttRequestedRole}»` : "не указана";
    return `<div class="tt-panel tt-denied" data-tt="unsupported-role"><h2>Роль не поддерживается в Тан-трекере</h2><p>Запрошена роль ${E(label)}. Здесь доступны только демо-роли участника передач: менеджер, РОП, директор, ассистент, координатор.</p><p class="tt-muted">Область не расширяется до директора и не подменяется другой ролью автоматически.</p>${btn("← К реестру", 'data-tt="back-list"')}</div>`;
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
    orders.forEach((o) => Sc()?.migrateOrderFields(o));
  }

  const TT_PUBLIC_RECIPIENT = /\/tan-tracker\/recipient(?:\/|$)/.test(location.pathname);
  const TT_LK = TT_PUBLIC_RECIPIENT || /\/tan-tracker(?:\/|$)/.test(location.pathname);
  if (!TT_LK) {
    seedContacts();
    seedOrders();
  }
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
    contactSearch: "",
    newRecipient: false,
    completeConfirmOrderId: null,
    extDeclineConfirmOrderId: null,
    createPhase: "item",
    createReturnPhase: null,
    attachStaging: [],
    attachOrderStaging: [],
    attachError: "",
    attachBusy: false,
    attachOpGen: 0,
    attachBusyGen: null,
    lightboxReturn: null,
    lightboxLoadId: 0,
    ttPrototypeRole: "manager",
    ttRoleUnsupported: false,
    ttRequestedRole: "",
    handoffReceipt: null,
    codeDemoRevealed: false,
    detailAttDisclosureOpen: null,
    registryFilterSheet: false,
    lkActorPartyId: null,
    lkLinkedEmployeeId: null,
    lkPhoneSessionToken: "",
    lkPhoneSessionKey: "",
    recipientPhoneCodeInput: "",
    lkCanWrite: true,
    lkPreviewReadOnly: false,
    createSubmitting: false,
    editDraftOrderId: null,
    editDraftRowVersion: null,
    editDraftRemovedAttachmentIds: [],
    createSavedReceipt: null,
    publicReceipt: null,
    publicInvitationToken: "",
    publicHolderAccessToken: "",
    holderAccessTokensByOrderId: {},
    externalMessengerEnabled: false,
    messengerInviteBusy: false,
    messengerInviteOrderId: null,
    messengerInviteError: "",
  };

  function isPublicGuestPage() {
    return !!window.__TT_PUBLIC_RECIPIENT__;
  }

  function isPublicHolderSession() {
    return !!(window.__TT_PUBLIC_HOLDER__ && state.publicHolderAccessToken);
  }

  function rebuildHolderAccessTokenMap(data) {
    const map = { ...(data?.holderAccessTokensByOrderId || {}) };
    for (const o of data?.orders || []) {
      if (o.holderAccessToken) map[o.id] = o.holderAccessToken;
    }
    state.holderAccessTokensByOrderId = map;
  }

  function holderAccessTokenForOrderId(orderId) {
    if (!orderId) return state.publicHolderAccessToken || "";
    return state.holderAccessTokensByOrderId[orderId] || state.publicHolderAccessToken || "";
  }

  function syncPublicHolderAccessTokenForOrder(orderId) {
    if (!window.__TT_EXTERNAL_PERSON__) return;
    const tok = holderAccessTokenForOrderId(orderId);
    if (tok) {
      state.publicHolderAccessToken = tok;
      window.__TT_PUBLIC_HOLDER__ = true;
    } else if (orderId) {
      state.publicHolderAccessToken = "";
      window.__TT_PUBLIC_HOLDER__ = false;
    }
  }

  function lkAuthenticatedCabinet() {
    return TT_LK && !isPublicGuestPage() && !isPublicHolderSession();
  }

  function applyLkCapabilitiesFromBootstrap(data) {
    if (!data || !data.lkMode) {
      state.lkCanWrite = true;
      state.lkPreviewReadOnly = false;
      return;
    }
    state.lkCanWrite = data.capabilities?.canWrite === true;
    state.lkPreviewReadOnly = !!data.previewReadOnly;
    state.externalMessengerEnabled = !!data.externalMessengerEnabled;
  }

  function externalMessengerUiEnabled() {
    return !!(TT_LK && state.externalMessengerEnabled && lkMutationAllowed());
  }

  function pendingContactIsExternal(pendingId) {
    const c = pendingId && contactById(pendingId);
    return !!(c && c.kind === "external");
  }

  function shouldUseExternalMessengerHandoff(o) {
    return !!(TT_LK && state.externalMessengerEnabled && o?.pendingId && pendingContactIsExternal(o.pendingId));
  }

  function messengerPortalCacheKey(o) {
    return recipientKey(o);
  }

  function clearMessengerPortalCache(o) {
    if (!o) return;
    delete o.messengerPortalUrl;
    delete o.messengerStartToken;
    delete o.messengerPortalCacheKey;
  }

  function messengerPortalUrlValid(o) {
    return !!(o?.messengerPortalUrl && o.messengerPortalCacheKey === messengerPortalCacheKey(o));
  }

  function applyMessengerInviteData(o, data) {
    o.messengerPortalUrl = data.portalUrl || data.portalPath || "";
    o.messengerStartToken = data.startToken || "";
    o.messengerPortalCacheKey = messengerPortalCacheKey(o);
  }

  function absoluteHandoffUrl(url) {
    if (!url) return "";
    if (/^https?:\/\//i.test(url)) return url;
    const origin = trustedAppOrigin();
    return origin ? `${origin}${url.startsWith("/") ? url : `/${url}`}` : url;
  }

  function ensureMessengerPortalUrl(o) {
    if (!shouldUseExternalMessengerHandoff(o)) return Promise.resolve(null);
    if (messengerPortalUrlValid(o)) return Promise.resolve(o.messengerPortalUrl);
    if (!window.TanTrackerLk?.createExternalMessengerInvite) return Promise.resolve(null);
    if (o._messengerPortalFetch) return o._messengerPortalFetch;
    o._messengerPortalFetch = window.TanTrackerLk.createExternalMessengerInvite(o.id)
      .then((data) => {
        applyMessengerInviteData(o, data);
        state.messengerInviteError = "";
        return o.messengerPortalUrl;
      })
      .catch((err) => {
        state.messengerInviteError = (err && err.message) || "Не удалось создать ссылку.";
        return null;
      })
      .finally(() => {
        delete o._messengerPortalFetch;
      });
    return o._messengerPortalFetch;
  }

  function openExternalMessengerPortalTab(o) {
    void ensureMessengerPortalUrl(o).then((url) => {
      if (!url) {
        state.error = state.messengerInviteError || "Не удалось подготовить ссылку для получателя.";
      } else {
        window.open(absoluteHandoffUrl(url), "_blank", "noopener,noreferrer");
      }
      renderTracker();
    });
  }

  function copyInviteUrlWithFeedback(url, inputSelector) {
    if (!url) {
      renderTracker();
      return;
    }
    const manual = () => {
      const el = document.querySelector(inputSelector);
      if (el) {
        el.focus();
        el.select();
      }
      state.toast = "Не удалось скопировать автоматически. Выделите ссылку и скопируйте вручную.";
      renderTracker();
    };
    if (navigator.clipboard?.writeText) {
      void navigator.clipboard.writeText(url).then(
        () => {
          state.toast = "Ссылка скопирована";
          renderTracker();
        },
        () => manual(),
      );
      return;
    }
    manual();
  }

  function messengerInviteBlockHtml(o) {
    if (!externalMessengerUiEnabled() || !pendingContactIsExternal(o.pendingId)) return "";
    const err =
      state.messengerInviteError && state.messengerInviteOrderId === o.id
        ? `<p class="tt-error" data-tt="messenger-invite-error">${E(state.messengerInviteError)}</p>`
        : "";
    const busy = state.messengerInviteBusy && state.messengerInviteOrderId === o.id;
    if (o.messengerPortalUrl) {
      return `<div class="tt-messenger-invite" data-tt="messenger-invite-block">
        <p class="tt-muted">Ссылка для получателя (Telegram / MAX):</p>
        <input class="tt-messenger-invite-url" type="text" readonly data-tt="messenger-invite-url" value="${E(o.messengerPortalUrl)}" />
        <div class="tt-messenger-invite-actions">
          ${btn("Копировать ссылку", 'data-tt="messenger-invite-copy"', "tt-detail-alt-action")}
          ${typeof navigator !== "undefined" && navigator.share ? btn("Поделиться", 'data-tt="messenger-invite-share"', "tt-detail-alt-action") : ""}
          ${btn("Обновить ссылку", busy ? 'data-tt="messenger-invite-create" disabled' : 'data-tt="messenger-invite-create"', "tt-btn-ghost")}
        </div>
        ${err}
      </div>`;
    }
    return `<div class="tt-messenger-invite" data-tt="messenger-invite-block">
      <p class="tt-muted">Отправьте внешнему получателю ссылку для подтверждения номера в мессенджере.</p>
      ${btn(busy ? "Создание ссылки…" : "Ссылка для мессенджера", busy ? 'data-tt="messenger-invite-create" disabled' : 'data-tt="messenger-invite-create"', "tt-detail-alt-action")}
      ${err}
    </div>`;
  }

  function lkMutationAllowed() {
    if (!lkAuthenticatedCabinet()) return true;
    return state.lkCanWrite === true;
  }

  function lkMutationBlockedMessage() {
    if (state.lkPreviewReadOnly) {
      return "Изменения недоступны в режиме просмотра «Войти как». Для операций нужен вход под своей учётной записью; этот режим не даёт права записи.";
    }
    return "У этой учётной записи нет права изменять передачи в Тан-трекере.";
  }

  function lkReadOnlyBannerHtml() {
    if (!lkAuthenticatedCabinet() || lkMutationAllowed()) return "";
    return `<div class="tt-readonly-banner" role="status" data-tt="lk-readonly-banner">${E(lkMutationBlockedMessage())}</div>`;
  }

  function showCreateEntryPoints() {
    if (state.recipientMode || isExternalShell()) return false;
    if (lkAuthenticatedCabinet() && !lkMutationAllowed()) return false;
    return true;
  }

  const CABINET_WRITE_ACTIONS = new Set([
    "create",
    "create-fab",
    "create-wizard-next",
    "create-wizard-submit",
    "create-skip-files",
    "create-new-recipient",
    "create-recipient-browse",
    "create-edit-item",
    "create-edit-files",
    "create-edit-recipient",
    "create-edit-relay",
    "create-edit-comment",
    "create-edit-due",
    "transfer",
    "transfer-final",
    "confirm-transfer",
    "complete",
    "confirm-complete",
    "change-pending",
    "cancel-pending",
    "edit-draft",
    "gen-code",
    "confirm-code",
    "confirm-qr-receive",
    "scan-qr-demo",
    "attach-delete",
    "toggle-new",
    "demo-expire",
  ]);

  function denyCabinetWriteMutation() {
    if (!lkAuthenticatedCabinet() || lkMutationAllowed()) return false;
    state.error = lkMutationBlockedMessage();
    return true;
  }

  function enforceReadOnlyRouteGuards() {
    if (!lkAuthenticatedCabinet() || lkMutationAllowed()) return;
    if (state.view === "create" || state.view === "transfer") {
      state.view = "list";
      state.form = null;
      state.createPhase = "item";
      state.createReturnPhase = null;
      clearAttachStaging();
    }
  }

  function applyPublicHolderPayload(data) {
    if (!data) return;
    window.__TT_PUBLIC_HOLDER__ = true;
    state.publicHolderAccessToken = data.holderAccessToken || state.publicHolderAccessToken || "";
    if (data.orders?.[0]) {
      state.orderId = data.orders[0].id;
      const inv = data.orders[0].activeInvitation;
      if (inv?.invitationToken) state.publicInvitationToken = inv.invitationToken;
    }
    const completed = data.orders?.[0]?.status === "completed";
    const delivered = data.orders?.[0]?.status === "delivered";
    const nextView = completed ? "public-receipt" : "detail";
    if (window.TanTrackerPrototype?.hydrateFromServer) {
      window.TanTrackerPrototype.hydrateFromServer(data, { skipUrlRead: true, skipRender: true });
    }
    if (completed) {
      state.publicReceipt = {
        publicCode: data.orders[0].id,
        item: data.orders[0].item,
        routeComplete: true,
        transferStatus: "completed",
        completedAt: Date.now(),
      };
    } else if (delivered) {
      state.publicReceipt = null;
    }
    state.recipientMode = false;
    state.view = nextView;
    writeUrl();
    renderTracker();
  }

  const Att = () => window.TanTrackerAttachments;

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

  let attachInFlightAbort = null;
  let attachInFlightAbortGen = null;

  function abortAttachInFlight() {
    if (!attachInFlightAbort) return;
    try {
      attachInFlightAbort.abort();
    } catch (_) {}
    attachInFlightAbort = null;
    attachInFlightAbortGen = null;
  }

  function releaseAttachInFlightAbort(opGen, controller) {
    if (attachInFlightAbort === controller && attachInFlightAbortGen === opGen) {
      attachInFlightAbort = null;
      attachInFlightAbortGen = null;
    }
  }

  function bumpAttachOpGen() {
    if (state.attachBusy) abortAttachInFlight();
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
      return state.view === "create";
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
    abortAttachInFlight();
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
    if (isPublicGuestPage()) {
      if (state.lkPhoneSessionToken && state.lkPhoneSessionKey === recipientKey(o)) return true;
      return state.phoneVerified && state.phoneVerifiedKey === recipientKey(o);
    }
    if (TT_LK) {
      const actor = actorContactId();
      if (o.pendingId && actor && o.pendingId === actor) {
        const c = contactById(actor);
        if (c && (c.employeeId || c.kind === "user")) return true;
      }
      if (state.lkPhoneSessionToken && state.lkPhoneSessionKey === recipientKey(o)) return true;
    }
    return state.phoneVerified && state.phoneVerifiedKey === recipientKey(o);
  }

  function isDraftPartyId(id) {
    return !id || id.startsWith("ext_") || id.startsWith("draft-");
  }

  function isExternalShell() {
    if (state.recipientMode || isPublicGuestPage()) return false;
    const actor = state.actingContactId || (TT_LK ? state.lkActorPartyId : null);
    const c = actor && contactById(actor);
    return !!(c && c.kind === "external");
  }

  function trustedAppOrigin() {
    const raw = window.__TT_LK_BOOTSTRAP__ && window.__TT_LK_BOOTSTRAP__.appOrigin;
    if (typeof raw !== "string" || !raw.trim()) return "";
    return raw.trim().replace(/\/$/, "");
  }

  function publicInvitationTokenForOrder(o) {
    return state.recipientTicket?.tok || o?.activeInvitation?.invitationToken || "";
  }

  function buildPublicAttachmentDownloadUrl(attId, o) {
    if (isPublicHolderSession() && state.publicHolderAccessToken) {
      return (
        "/api/tan-tracker/public/holder/attachments/" +
        encodeURIComponent(attId) +
        "?holderAccessToken=" +
        encodeURIComponent(state.publicHolderAccessToken)
      );
    }
    const invTok = publicInvitationTokenForOrder(o);
    const session = state.lkPhoneSessionToken;
    if (!attId || !invTok || !session) return "";
    const q =
      "invitationToken=" +
      encodeURIComponent(invTok) +
      "&phoneSessionToken=" +
      encodeURIComponent(session);
    return "/api/tan-tracker/public/recipient/attachments/" + encodeURIComponent(attId) + "?" + q;
  }

  function applyPublicAttachmentUrls(o) {
    if (!window.__TT_PUBLIC_RECIPIENT__ || !o?.attachments?.length) return;
    const verified = isPublicHolderSession() || identityVerified(o);
    for (const a of o.attachments) {
      const base = verified ? buildPublicAttachmentDownloadUrl(a.id, o) : "";
      a.url = base && Att()?.attachmentThumbUrl ? Att().attachmentThumbUrl(base) : base;
      a.downloadUrl = base && Att()?.attachmentDownloadUrl ? Att().attachmentDownloadUrl(base) : base;
    }
  }

  function handoffUrl(o, inv) {
    if (shouldUseExternalMessengerHandoff(o) && messengerPortalUrlValid(o)) {
      return absoluteHandoffUrl(o.messengerPortalUrl);
    }
    const t = inv || o.activeInvitation;
    const role = state.ttPrototypeRole || "manager";
    const basePath = TT_LK ? "/tan-tracker/recipient" : location.pathname;
    const origin = trustedAppOrigin();
    const base = origin ? `${origin}${basePath}` : basePath;
    if (!t) return `${base}#tan-tracker?role=${role}`;
    const p = new URLSearchParams({
      role,
      tt_view: "recipient",
      tt_order: t.id,
      tt_hv: String(t.hv),
      tt_rcv: t.pendingId,
      tt_via: "qr",
    });
    if (t.invitationToken) p.set("tt_tok", t.invitationToken);
    return `${base}#tan-tracker?${p}`;
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
      !state.recipientMode && state.view === "detail" && !!state.orderId
    );
    document.body.classList.toggle(
      "tt-registry-list",
      !state.recipientMode && !ext && state.view === "list"
    );
    document.body.classList.toggle(
      "tt-code-view",
      !state.recipientMode && state.view === "code" && (!ext || !!state.orderId),
    );
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
    if (o.status === "completed") return { key: "done", label: "Завершена", icon: "check-circle" };
    if (o.status === "delivered" && o.holderId === actor && !o.pendingId)
      return { key: "delivered", label: "Доставлено", icon: "package-check" };
    if (!actor) return { key: "route", label: "В пути", icon: "route" };
    if (o.pendingId === actor) return { key: "inbox", label: "Жду получения", icon: "download" };
    if (o.holderId === actor && o.pendingId) {
      const p = contactById(o.pendingId);
      return { key: "wait", label: "Ожидает код", icon: "key-round", hint: p?.name };
    }
    if (o.holderId === actor && !o.pendingId && o.status !== "completed" && o.status !== "delivered")
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
    const done = o.status === "completed";
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
      o.fromExternal && o.pendingId === actor
        ? '<span class="tt-badge" data-tt="from-external">от клиента</span> '
        : "";
    return `<button type="button" class="tt-card-v2${overdue ? " tt-card-v2--overdue" : ""}${done ? " tt-card-v2--completed" : ""}" data-tt-open="${E(o.id)}" style="--tt-card-accent:${accent}">
      <span class="tt-card-v2-accent" aria-hidden="true"></span>
      <div class="tt-card-v2-top"><h3 class="tt-card-v2-title">${extBadge}${E(o.item)}</h3><i data-lucide="chevron-right"></i></div>
      ${registryRouteLine(o)}
      <div class="tt-card-v2-foot">${statusBadge(o, actor, { compact: true })}<span class="tt-card-v2-due-inline ${due.overdue ? "tt-due-human--over" : ""}">${E(registryCardDuePrimary(o))}</span></div>
      <p class="tt-card-v2-meta">${registryCardMeta(o)}</p>
    </button>`;
  }

  function registryCounts() {
    const actor = state.actingContactId || employeeContact(state.employeeId)?.id;
    const base = orders.filter((o) => orderVisible(o));
    const handoff = base.filter(
      (o) => o.holderId === actor && o.status !== "completed" && o.finalRecipientId && o.holderId !== o.finalRecipientId
    ).length;
    const receive = base.filter((o) => o.pendingId === actor).length;
    const overdue = base.filter((o) => isOverdue(o)).length;
    const active = base.filter((o) => o.status !== "completed").length;
    return { handoff, receive, overdue, active, total: base.length };
  }

  function registryGroupOrders(rows, actor) {
    const action = [];
    const progress = [];
    const done = [];
    rows.forEach((o) => {
      const ctx = registryActorContext(o, actor);
      if (o.status === "completed") done.push(o);
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
        return `<tr data-tt-open="${E(o.id)}" class="${overdue ? "tt-row--overdue" : ""}">
          <td><strong>${E(o.item)}</strong><small>${E(o.id)}${o.qty ? ` · ${E(o.qty)}` : ""}</small></td>
          <td>${registryRouteLine(o)}</td>
          <td>${statusBadge(o, actor)}</td>
          <td class="tt-table-due">${humanDueTableCell(o)}</td>
        </tr>`;
      })
      .join("");
  }

  function registryEmptyHtml() {
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
    return true;
  }

  function transferPickAllowed(o, f) {
    const internalActor = TT_LK ? state.lkActorPartyId : null;
    const externalActing =
      state.actingContactId &&
      state.actingContactId !== internalActor &&
      contactById(state.actingContactId)?.kind === "external";
    return contacts.filter((c) => {
      if (c.id === o.holderId) return false;
      if (externalActing) {
        const inOrder = [o.holderId, o.pendingId, ...o.timeline.flatMap((t) => [t.from, t.to])].includes(c.id);
        const addedByActor = c.addedBy === state.actingContactId;
        return inOrder || addedByActor || c.id === f.recipientId;
      }
      return true;
    });
  }

  function patchContactPick() {
    const host = document.querySelector('[data-tt="contact-pick"]');
    if (!host || !state.form) return false;
    const f = state.form;
    const relay = state.createPhase === "relay-pick";
    const holder = employeeContact(state.employeeId);
    const q = (f.pickQ || "").toLowerCase().trim();
    const o = state.view === "transfer" && state.orderId ? orders.find((x) => x.id === state.orderId) : null;
    const base = o ? transferPickAllowed(o, f) : contacts.filter((c) => c.id !== holder?.id);
    const pick = base.filter((c) => {
      if (!o && c.id === holder?.id) return false;
      if (!q) return true;
      return (c.name + c.phone + fmtPhone(c.phone)).toLowerCase().includes(q);
    });
    const sel = relay ? f.relayId : f.finalRecipientId || f.recipientId;
    host.innerHTML = pick.length
      ? pick
          .slice(0, 40)
          .map(
            (c) =>
              wizardContactButton(c, sel === c.id)
          )
          .join("")
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
      allowServerDelete: !!opts.allowServerDelete,
    });
  }

  function formFromOrderForDraftEdit(o) {
    const relayIsPending =
      o.finalRecipientId && o.pendingId && o.pendingId !== o.finalRecipientId;
    const due =
      o.dueAt != null && !Number.isNaN(Number(o.dueAt))
        ? new Date(o.dueAt).toISOString().slice(0, 10)
        : "";
    return {
      item: o.item || "",
      qty: o.qty || "",
      finalRecipientId: o.finalRecipientId || o.pendingId || "",
      relayId: relayIsPending ? o.pendingId : "",
      recipientId: o.finalRecipientId || o.pendingId || "",
      comment: o.comment || "",
      due,
      pickQ: "",
      newName: "",
      newPhone: "",
      mode: "list",
      pickTarget: "final",
      recipientStep: "confirmed",
    };
  }

  function beginEditDraft(o) {
    if (!o?.canEditDraft) return;
    state.editDraftOrderId = o.id;
    state.editDraftRowVersion = o.rowVersion ?? null;
    state.editDraftRemovedAttachmentIds = [];
    state.form = formFromOrderForDraftEdit(o);
    state.createPhase = "review";
    state.createReturnPhase = null;
    state.attachStaging = (o.attachments || []).map((a) => ({
      id: a.id,
      name: a.name,
      mime: a.mimeType || a.mime || "application/octet-stream",
      size: a.byteSize ?? a.size ?? 0,
      addedAt: a.addedAt ?? Date.now(),
      serverAttachmentId: a.id,
    }));
    state.attachError = "";
    state.error = state.toast = "";
    state.view = "create";
    clearCompleteConfirm();
    writeUrl();
  }

  function createAttachmentsSection() {
    if (!Att()) return "";
    const staged = [...state.attachStaging];
    return Att().blockHtml({
      items: staged,
      stagedIds: new Set(staged.map((s) => s.id)),
      showPicker: !state.attachBusy,
      inputKey: "create",
      omitTitle: true,
      pickerMode: "button",
      pickerLabel: "Выбрать файл на устройстве",
      error: state.attachError,
      hint: "Можно пропустить этот шаг, если фото не нужны.",
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
      qty: "",
      finalRecipientId: "",
      relayId: "",
      recipientId: "",
      comment: "",
      due: "",
      pickQ: "",
      newName: "",
      newPhone: "",
      existingMatchId: "",
      newPhoneStep: "phone",
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
    const listInner = pick.length
      ? pick
          .slice(0, 40)
          .map(
            (c) =>
              wizardContactButton(c, sel === c.id)
          )
          .join("")
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
        <span class="tt-wizard-choice-hint">${TT_LK ? "Контакты из вашего рабочего списка" : "Контакты компании и клиенты демо-каталога"}</span>
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
      ${state.createSubmitting ? `<p class="tt-muted" data-tt="create-pending">Создаём передачу…</p>` : ""}
      ${state.error ? `<p class="tt-error" data-tt="form-error">${E(state.error)}</p>` : ""}
      <div class="tt-wizard-actions tt-wizard-actions--dock">${actionsHtml}</div>
    </div></div>`;
  }

  function wizardBtn(label, action, primary = false, extraClass = "") {
    const freeze =
      (state.attachBusy &&
        (action === "create-wizard-next" || action === "create-wizard-submit" || action === "create-skip-files")) ||
      (state.createSubmitting && action === "create-wizard-submit");
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
      if (!normPhone(f.newPhone)) {
        return TT_LK || window.__TT_PUBLIC_RECIPIENT__
          ? "Введите телефон: 10 цифр после +7."
          : "Введите телефон: 10 цифр после +7 (демо).";
      }
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
      state.createPhase = "recipient-new-phone";
      if (state.form) state.form.newPhoneStep = "phone";
    } else if (p === "recipient-new-phone") {
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
    state.lightboxLoadId += 1;
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
    state.lightboxAtt = null;
  }

  function setLightboxPreviewState(lb, mode, message) {
    const img = lb.querySelector('[data-tt="attach-lightbox-img"]');
    const fallback = lb.querySelector('[data-tt="attach-lightbox-fallback"]');
    const err = lb.querySelector('[data-tt="attach-lightbox-err"]');
    const loading = lb.querySelector('[data-tt="attach-lightbox-loading"]');
    if (mode === "loading") {
      if (fallback) fallback.hidden = true;
      if (loading) loading.hidden = false;
      if (img) img.hidden = true;
      return;
    }
    if (mode === "ok") {
      if (fallback) fallback.hidden = true;
      if (loading) loading.hidden = true;
      if (img) img.hidden = false;
      return;
    }
    if (loading) loading.hidden = true;
    if (img) img.hidden = true;
    if (fallback) fallback.hidden = false;
    if (err && message) err.textContent = message;
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
    state.lightboxAtt = a;
    const img = lb.querySelector('[data-tt="attach-lightbox-img"]');
    const cap = lb.querySelector('[data-tt="attach-lightbox-cap"]');
    const dl = lb.querySelector('[data-tt="attach-lightbox-download"]');
    const previewUrl = Att().attachmentLightboxUrl(a.url);
    const downloadUrl = a.downloadUrl || Att().attachmentDownloadUrl(a.url);
    if (dl) {
      dl.href = downloadUrl;
      dl.setAttribute("download", a.name || "file");
    }
    if (img) {
      const loadId = ++state.lightboxLoadId;
      const lightboxLoadTimeoutMs = 30000;
      let loadTimer = setTimeout(() => {
        if (state.lightboxLoadId !== loadId) return;
        setLightboxPreviewState(
          lb,
          "error",
          "Превышено время загрузки изображения. Попробуйте повторить или скачайте файл.",
        );
      }, lightboxLoadTimeoutMs);
      const finishLoad = (mode, message) => {
        if (state.lightboxLoadId !== loadId) return;
        clearTimeout(loadTimer);
        setLightboxPreviewState(lb, mode, message);
      };
      const awaitPaintReady = () =>
        new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
      setLightboxPreviewState(lb, "loading");
      img.alt = a.name;
      img.onload = null;
      img.onerror = null;
      img.removeAttribute("src");
      img.src = previewUrl;
      void (async () => {
        try {
          await Promise.race([
            img.decode(),
            new Promise((_, reject) =>
              setTimeout(() => reject(new Error("decode timeout")), lightboxLoadTimeoutMs),
            ),
          ]);
          if (state.lightboxLoadId !== loadId) return;
          await awaitPaintReady();
          if (state.lightboxLoadId !== loadId) return;
          finishLoad("ok");
        } catch {
          if (state.lightboxLoadId !== loadId) return;
          finishLoad(
            "error",
            "Не удалось показать изображение. Попробуйте повторить или скачайте файл.",
          );
        }
      })();
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
    if (lkAuthenticatedCabinet() && !lkMutationAllowed()) {
      state.attachError = lkMutationBlockedMessage();
      renderTracker();
      return;
    }
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
    abortAttachInFlight();
    const opAbortController = new AbortController();
    attachInFlightAbort = opAbortController;
    attachInFlightAbortGen = opGen;
    const uploadSignal = opAbortController.signal;
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
        else {
          if (
            isPublicHolderSession() &&
            window.TanTrackerLk?.publicHolderUploadStagingFile
          ) {
            try {
              const uploaded = await window.TanTrackerLk.publicHolderUploadStagingFile(
                state.publicHolderAccessToken,
                file,
                { signal: uploadSignal },
              );
              if (!attachSnapValid(snap)) {
                Att().revokeStagingItem(r.item);
                break;
              }
              r.item.serverStagingId = uploaded.id;
            } catch (upErr) {
              Att().revokeStagingItem(r.item);
              if (!attachSnapValid(snap)) break;
              if (upErr?.message === "Загрузка отменена.") continue;
              errors.push(upErr?.message || "Не удалось загрузить файл.");
              continue;
            }
          } else if (TT_LK && window.TanTrackerLk && window.TanTrackerLk.uploadStagingFile) {
            try {
              const uploaded = await window.TanTrackerLk.uploadStagingFile(file, { signal: uploadSignal });
              if (!attachSnapValid(snap)) {
                Att().revokeStagingItem(r.item);
                break;
              }
              r.item.serverStagingId = uploaded.id;
            } catch (upErr) {
              Att().revokeStagingItem(r.item);
              if (!attachSnapValid(snap)) break;
              if (upErr?.message === "Загрузка отменена.") continue;
              errors.push(upErr?.message || "Не удалось загрузить файл.");
              continue;
            }
          }
          if (!attachSnapValid(snap)) {
            Att().revokeStagingItem(r.item);
            break;
          }
          accepted.push(r.item);
        }
      }
      if (attachSnapValid(snap)) {
        if (target === "create") state.attachStaging = [...staging, ...accepted];
        else if (order && accepted.length) {
          if (
            isPublicHolderSession() &&
            window.TanTrackerLk?.publicHolderAddAttachments &&
            accepted.every((x) => x.serverStagingId)
          ) {
            try {
              const data = await window.TanTrackerLk.publicHolderAddAttachments(
                state.publicHolderAccessToken,
                accepted.map((x) => x.serverStagingId),
              );
              accepted.forEach((x) => Att().revokeStagingItem(x));
              applyPublicHolderPayload(data);
              state.toast = `Добавлено файлов: ${accepted.length}.`;
            } catch (upErr) {
              Att().revokeStagingItems(accepted);
              errors.push(upErr?.message || "Не удалось сохранить файлы на сервере.");
            }
          } else if (
            TT_LK &&
            window.TanTrackerLk &&
            window.TanTrackerLk.addTransferAttachments &&
            accepted.every((x) => x.serverStagingId)
          ) {
            try {
              await window.TanTrackerLk.addTransferAttachments(
                order.id,
                accepted.map((x) => x.serverStagingId),
              );
              accepted.forEach((x) => Att().revokeStagingItem(x));
              state.toast = `Добавлено файлов: ${accepted.length}.`;
            } catch (upErr) {
              Att().revokeStagingItems(accepted);
              errors.push(upErr?.message || "Не удалось сохранить файлы на сервере.");
            }
          } else {
            Att().mergeToOrder(order, accepted, addedBy);
            state.toast = `Добавлено файлов: ${accepted.length}.`;
          }
        }
        if (errors.length) state.attachError = errors.slice(0, 3).join(" ");
      } else Att().revokeStagingItems(accepted);
    } finally {
      releaseAttachInFlightAbort(opGen, opAbortController);
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
    return o.status !== "completed" && o.status !== "delivered" && o.dueAt && o.dueAt < now();
  }
  function dueCell(o) {
    if (!o.dueAt) return "—";
    return humanDueHtml(o);
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
    if (o.holderId === o.finalRecipientId) {
      o.status = "delivered";
      o.timeline.push({
        at: now(),
        from: o.holderId,
        to: o.finalRecipientId,
        note: "Доставлено конечному получателю",
      });
      state.toast = "Доставлено конечному получателю.";
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
    state.publicReceipt = null;
    state.view = "detail";
    applyContactProfile(o.holderId);
    ttShellMounted = false;
  }

  function afterPublicQrReceive(receipt) {
    state.recipientMode = false;
    state.recipientTicket = null;
    state.codeInput = "";
    state.lkPhoneSessionKey = "";
    state.handoffReceipt = null;
    state.publicReceipt = receipt?.routeComplete ? receipt : null;
    state.orderId = receipt?.publicCode || state.orderId;
    ttShellMounted = false;
    if (receipt?.routeComplete) {
      state.view = "public-receipt";
      state.lkPhoneSessionToken = "";
      return;
    }
    const hat = receipt?.holderAccessToken || "";
    if (hat && window.TanTrackerLk?.loadPublicHolderContext) {
      state.publicHolderAccessToken = hat;
      window.__TT_PUBLIC_HOLDER__ = true;
      void window.TanTrackerLk.loadPublicHolderContext(hat)
        .then((data) => applyPublicHolderPayload(data))
        .catch((err) => {
          state.error = err?.message || "Не удалось открыть передачу.";
          state.view = "detail";
          renderTracker();
        });
      return;
    }
    state.view = "detail";
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

  function publicReceiptView() {
    const r = state.publicReceipt;
    if (!r) return deniedView();
    const title =
      r.transferStatus === "completed" || r.status === "completed"
        ? "Передача завершена"
        : r.transferStatus === "delivered" || r.deliveredAt
          ? "Доставлено"
          : "Получение подтверждено";
    return `${userTestBannerBlock()}<div class="tt-panel tt-handoff-receipt" data-tt="public-receipt">
      <h2>${E(title)}</h2>
      <p class="tt-success">${E(r.item || "Передача")}</p>
      <p><strong>Номер передачи:</strong> ${E(r.publicCode)}</p>
      ${r.completedAt ? `<p class="tt-muted">${E(dt(r.completedAt))} МСК</p>` : ""}
      <p class="tt-muted">Сохранено на сервере. Эту страницу можно обновить или открыть повторно по сохранённой ссылке.</p>
    </div>`;
  }

  function publicHolderView() {
    const o = orders.find((x) => x.id === state.orderId);
    if (!o) return deniedView();
    const fin = contactById(o.finalRecipientId);
    const canSend = !o.pendingId && o.finalRecipientId && o.holderId !== o.finalRecipientId;
    const handoff =
      o.pendingId && o.activeInvitation
        ? `<div class="tt-reminder"><strong>Передайте конечному получателю</strong><p>${E(fin?.name || "—")}</p>${btn("Открыть QR для получателя", 'data-tt="public-open-recipient-qr"', "tt-primary tt-btn-block")}</div>`
        : "";
    return `${userTestBannerBlock()}<div class="tt-panel" data-tt="public-holder">
      <h2>Вы приняли передачу</h2>
      <p class="tt-success">${E(o.item)} · ${E(o.id)}</p>
      <p>Конечный получатель: <strong>${E(fin?.name || "—")}</strong></p>
      ${o.dueAt ? `<p class="tt-muted">Срок: ${E(dt(o.dueAt))}</p>` : ""}
      ${canSend ? btn("Передать конечному получателю", 'data-tt="public-send-to-final"', "tt-primary tt-btn-block") : ""}
      ${handoff}
    </div>`;
  }

  function createSavedReceiptVisible() {
    const r = state.createSavedReceipt;
    if (state.view !== "detail" || !r || !state.orderId) return false;
    if (r.publicCode !== state.orderId) return false;
    return !orders.some((x) => x.id === state.orderId);
  }

  function createSavedReceiptView() {
    const r = state.createSavedReceipt;
    if (!r) return deniedView();
    const retryBtn = r.refreshFailed
      ? btn("Повторить обновление", 'data-tt="create-retry-refresh"', "tt-primary")
      : "";
    return `<div class="tt-panel" data-tt="create-saved-receipt">
      <h2>Передача сохранена</h2>
      <p class="tt-success">Номер: <strong>${E(r.publicCode)}</strong></p>
      ${
        r.refreshFailed
          ? `<p class="tt-warning">${E(r.refreshError || "Не удалось обновить реестр после создания.")}</p>${retryBtn}`
          : `<p class="tt-muted">Данные реестра обновляются…</p>`
      }
      ${btn("← К реестру", 'data-tt="back-list"', "tt-btn-ghost")}
    </div>`;
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

  function generateCode(o) {
    if (o.status === "completed" || !o.pendingId) return null;
    if (TT_LK && window.TanTrackerLk && window.TanTrackerLk.generateHandoffCode) {
      const publicOpts =
        window.__TT_PUBLIC_RECIPIENT__ && state.lkPhoneSessionToken
          ? {
              invitationToken: publicInvitationTokenForOrder(o),
              phoneSessionToken: state.lkPhoneSessionToken,
            }
          : null;
      window.TanTrackerLk.generateHandoffCode(o.id, publicOpts)
        .then(() => {
          state.toast = "";
          state.error = "";
          renderTracker();
        })
        .catch((err) => {
          state.error = err?.message || "Не удалось выпустить код.";
          renderTracker();
        });
      return null;
    }
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
    if (window.__TT_EXTERNAL_PERSON__) {
      syncPublicHolderAccessTokenForOrder(o.id);
    }
    const usePublicHolderVerify =
      window.TanTrackerLk?.publicHolderVerifyCode &&
      (isPublicHolderSession() ||
        (window.__TT_EXTERNAL_PERSON__ && !!holderAccessTokenForOrderId(o.id)));
    if (window.__TT_EXTERNAL_PERSON__ && !holderAccessTokenForOrderId(o.id)) {
      state.error = "Нет доступа к подтверждению этой передачи.";
      return false;
    }
    if (usePublicHolderVerify) {
      if (o._codeBusy) return false;
      o._codeBusy = true;
      window.TanTrackerLk.publicHolderVerifyCode(holderAccessTokenForOrderId(o.id), input)
        .then((data) => {
          o._codeBusy = false;
          state.codeInput = "";
          if (window.__TT_EXTERNAL_PERSON__ && window.TanTrackerExternal?.refreshBootstrap) {
            return window.TanTrackerExternal.refreshBootstrap().then(() => {
              syncPublicHolderAccessTokenForOrder(o.id);
              state.toast = "Передача подтверждена.";
              renderTracker();
            });
          }
          applyPublicHolderPayload(data);
          state.toast = "Передача подтверждена.";
          renderTracker();
        })
        .catch((err) => {
          o._codeBusy = false;
          state.error = err?.message || "Неверный код.";
          renderTracker();
        });
      return false;
    }
    if (window.__TT_EXTERNAL_PERSON__) {
      state.error = state.error || "Нет доступа к подтверждению этой передачи.";
      return false;
    }
    if (TT_LK && window.TanTrackerLk && window.TanTrackerLk.verifyHandoffCode) {
      if (o._codeBusy) return false;
      o._codeBusy = true;
      window.TanTrackerLk.verifyHandoffCode(o.id, input)
        .then(() => {
          o._codeBusy = false;
          state.recipientMode = false;
          state.recipientTicket = null;
          state.codeInput = "";
          state.toast = "Держатель обновлён.";
          state.view = "detail";
          writeUrl();
          renderTracker();
        })
        .catch((err) => {
          o._codeBusy = false;
          state.error = err?.message || "Неверный код.";
          renderTracker();
        });
      return false;
    }
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
    if (ticket?.stale) {
      state.error = "Это приглашение больше не действует. Запросите новый QR у передающего.";
      return false;
    }
    if (TT_LK && window.TanTrackerLk && window.TanTrackerLk.confirmQrHandoff) {
      if (!identityVerified(o) || !state.lkPhoneSessionToken) {
        state.error = "Сначала подтвердите номер телефона кодом из SMS.";
        return false;
      }
      if (o._qrBusy) return false;
      o._qrBusy = true;
      window.TanTrackerLk.confirmQrHandoff(o, state.recipientTicket, state.lkPhoneSessionToken)
        .then((receipt) => {
          o._qrBusy = false;
          state.lkPhoneSessionToken = "";
          state.lkPhoneSessionKey = "";
          if (window.__TT_PUBLIC_RECIPIENT__ && receipt) afterPublicQrReceive(receipt);
          else afterQrReceive(o);
          writeUrl();
          renderTracker();
        })
        .catch((err) => {
          o._qrBusy = false;
          state.error = err?.message || "Не удалось подтвердить получение.";
          renderTracker();
        });
      return false;
    }
    if (!identityVerified(o)) {
      state.error = "Сначала подтвердите номер (демо).";
      return false;
    }
    return completeHandoff(o, "qr", ticket?.inv);
  }

  function cancelPending(o) {
    if (TT_LK && window.TanTrackerLk && window.TanTrackerLk.cancelPending) {
      void window.TanTrackerLk.cancelPending(o.id)
        .then(() => {
          state.toast = "Ожидание отменено.";
          renderTracker();
        })
        .catch((err) => {
          state.error = err?.message || "Не удалось отменить ожидание.";
          renderTracker();
        });
      return;
    }
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
    clearMessengerPortalCache(o);
    resetPhoneIdentity();
    o.status = "active";
    state.toast = "Ожидание отменено.";
  }

  function canActorCloseDeliveredTransfer(o, actor) {
    const actorContact = actor && contactById(actor);
    if (actorContact?.kind === "external" && o.createdById === actor) return false;
    return (
      !!actor &&
      o.status === "delivered" &&
      !o.pendingId &&
      o.createdById === actor &&
      o.holderId !== actor &&
      (!o.finalRecipientId || o.holderId === o.finalRecipientId)
    );
  }

  function canActorCompleteTransfer(o, actor) {
    if (!actor || o.pendingId || o.status === "completed") return false;
    if (canActorCloseDeliveredTransfer(o, actor)) return true;
    if (o.holderId !== actor) return false;
    if (o.finalRecipientId && o.holderId !== o.finalRecipientId && !o.allowLegacyComplete) return false;
    return true;
  }

  function completeOrder(o) {
    if (o.status === "completed") return;
    if (o.pendingId) {
      state.error = "Сначала отмените ожидание или подтвердите передачу.";
      return;
    }
    const actor = actorContactId();
    if (!canActorCompleteTransfer(o, actor)) {
      state.error = "Завершить может текущий держатель или создатель после доставки.";
      return;
    }
    if (TT_LK && window.TanTrackerLk && window.TanTrackerLk.legacyCompleteTransfer) {
      void window.TanTrackerLk.legacyCompleteTransfer(o.id)
        .then(() => {
          state.toast = "Передача завершена.";
          renderTracker();
        })
        .catch((err) => {
          state.error = err?.message || "Не удалось завершить передачу.";
          renderTracker();
        });
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

  function startPending(o, recipientId, externalMeta) {
    if (isPublicHolderSession() && window.TanTrackerLk?.publicHolderChangePending) {
      void window.TanTrackerLk.publicHolderChangePending(
        state.publicHolderAccessToken,
        recipientId,
        externalMeta,
      )
        .then((data) => {
          applyPublicHolderPayload(data);
          state.form = null;
          state.toast = "Получатель выбран.";
        })
        .catch((err) => {
          state.error = err?.message || "Не удалось назначить получателя.";
          renderTracker();
        });
      return;
    }
    if (TT_LK && window.TanTrackerLk && window.TanTrackerLk.changePending) {
      void window.TanTrackerLk.changePending(o.id, recipientId)
        .then(() => {
          state.view = "detail";
          state.form = null;
          state.toast = "Получатель выбран.";
          writeUrl();
          renderTracker();
        })
        .catch((err) => {
          state.error = err?.message || "Не удалось назначить получателя.";
          renderTracker();
        });
      return;
    }
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
    const prevPending = o.pendingId;
    archiveInvitation(o);
    if (prevPending && prevPending !== recipientId) {
      o.revokedParticipants = o.revokedParticipants || [];
      if (!o.revokedParticipants.includes(prevPending)) o.revokedParticipants.push(prevPending);
    }
    o.revokedParticipants = (o.revokedParticipants || []).filter((id) => id !== recipientId);
    o.pendingId = recipientId;
    o.status = "waiting";
    o.handoffVer = (o.handoffVer ?? 0) + 1;
    o.code = null;
    clearMessengerPortalCache(o);
    resetPhoneIdentity();
    syncInvitation(o);
    state.handoffTab = "code";
    o.timeline.push({
      at: now(),
      from: o.holderId,
      to: recipientId,
      note: "Назначен следующий получатель",
    });
    state.toast = "Получатель выбран. Прежний код и QR аннулированы.";
  }

  function contactByPhone(phoneRaw) {
    const phone = normPhone(phoneRaw);
    if (!phone) return null;
    return (
      contacts.find((c) => {
        const p = normPhone(c.phone || "");
        return p && p === phone;
      }) || null
    );
  }

  function contactKindLabel(c) {
    if (!c) return "контакт";
    if (c.kind === "user" || c.kind === "employee") return "сотрудник";
    return "внешний";
  }

  function contactAddedByLabel(c) {
    if (!c || c.kind === "user" || c.kind === "employee") return "справочник компании";
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
    const emps = list.filter((c) => c.kind === "user" || c.kind === "employee");
    const ext = list.filter((c) => c.kind === "external");
    const btnHtml = (c) =>
      `<button type="button" data-tt-pick="${E(c.id)}" aria-pressed="${selectedId === c.id}">${E(c.name)}<br><small>${E(fmtPhone(c.phone))}</small></button>`;
    return `${emps.length ? `<p class="tt-muted">Сотрудники · справочник компании</p><div class="tt-contact-pick">${emps.map(btnHtml).join("")}</div>` : ""}${
      ext.length ? `<p class="tt-muted">Внешние контакты</p><div class="tt-contact-pick">${ext.map(btnHtml).join("")}</div>` : ""
    }`;
  }

  function addExternalContact(name, phoneRaw) {
    const phone = normPhone(phoneRaw);
    if (!phone) {
      return {
        error: TT_LK ? "Введите телефон: 10 цифр после +7." : "Укажите демонстрационный телефон: 10 цифр после +7.",
      };
    }
    const dup = contactByPhone(phoneRaw);
    if (dup) return { error: `Контакт с этим номером уже есть: ${dup.name}.`, existing: dup };
    const id = TT_LK ? `draft-${phone}` : "ext_" + String(contacts.length + 1).padStart(2, "0");
    const c = {
      id,
      kind: "external",
      name: name.trim() || "Внешний получатель",
      phone: TT_LK ? `+${phone}` : phone,
      draft: TT_LK,
    };
    contacts.push(c);
    return { contact: c };
  }

  function visibleOrders() {
    const actor = actorContactId();
    let list = orders.filter((o) => orderVisible(o));
    const narrowByActing =
      state.actingContactId &&
      (!TT_LK ||
        (state.actingContactId !== state.lkActorPartyId && contactById(state.actingContactId)?.kind === "external"));
    if (narrowByActing) {
      list = list.filter((o) => {
        const parts = [o.holderId, o.pendingId, ...o.timeline.flatMap((t) => [t.from, t.to])];
        return parts.includes(state.actingContactId);
      });
    }
    if (state.mineFilter === "handoff") {
      list = list.filter((o) => o.holderId === actor && o.status !== "completed" && o.finalRecipientId && o.holderId !== o.finalRecipientId);
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
      if (state.statusFilter === "completed" && st !== "completed") return false;
      if (state.statusFilter === "overdue" && !isOverdue(o)) return false;
      if (state.statusFilter === "route") {
        const ctx = registryActorContext(o, actor);
        if (ctx.key !== "route" || o.status === "completed") return false;
      }
      return true;
    });
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
      } else if (state.recipientTicket) {
        if (state.recipientTicket.hv != null) p.set("tt_hv", String(state.recipientTicket.hv));
        if (state.recipientTicket.rcv) p.set("tt_rcv", state.recipientTicket.rcv);
      }
      if (state.recipientVia === "qr") p.set("tt_via", "qr");
      else p.delete("tt_via");
      const tok =
        o?.activeInvitation?.invitationToken ||
        state.recipientTicket?.tok ||
        state.publicInvitationToken;
      if (tok) p.set("tt_tok", tok);
      else p.delete("tt_tok");
      if (state.lkPhoneSessionToken) p.set("tt_pts", state.lkPhoneSessionToken);
      else p.delete("tt_pts");
    } else if (isPublicGuestPage() && (state.view === "public-receipt" || state.view === "public-holder")) {
      p.delete("tt_view");
      p.delete("tt_hv");
      p.delete("tt_rcv");
      p.delete("tt_via");
      if (state.orderId) p.set("tt_order", state.orderId);
      else p.delete("tt_order");
      const tok = state.publicInvitationToken || state.recipientTicket?.tok;
      if (tok) p.set("tt_tok", tok);
      else p.delete("tt_tok");
      if (state.publicHolderAccessToken) p.set("tt_hat", state.publicHolderAccessToken);
      else p.delete("tt_hat");
    } else if (isPublicGuestPage() && state.view === "public-receipt") {
      p.delete("tt_view");
      p.delete("tt_hv");
      p.delete("tt_rcv");
      p.delete("tt_via");
      if (state.orderId) p.set("tt_order", state.orderId);
      else p.delete("tt_order");
      const tok = state.publicInvitationToken || state.recipientTicket?.tok;
      if (tok) p.set("tt_tok", tok);
      else p.delete("tt_tok");
    } else if (isPublicGuestPage() && state.orderId && !state.recipientMode) {
      p.delete("tt_view");
      p.delete("tt_hv");
      p.delete("tt_rcv");
      p.delete("tt_via");
      p.set("tt_order", state.orderId);
      if (state.publicHolderAccessToken) p.set("tt_hat", state.publicHolderAccessToken);
      else p.delete("tt_hat");
      const tok = state.publicInvitationToken || state.recipientTicket?.tok;
      if (tok) p.set("tt_tok", tok);
      else p.delete("tt_tok");
      if (state.lkPhoneSessionToken) p.set("tt_pts", state.lkPhoneSessionToken);
      else p.delete("tt_pts");
    } else {
      p.delete("tt_view");
      p.delete("tt_order");
      p.delete("tt_hv");
      p.delete("tt_rcv");
      p.delete("tt_via");
      p.delete("tt_tok");
      p.delete("tt_hat");
      p.delete("tt_pts");
    }
    if (state.actingContactId) p.set("tt_act", state.actingContactId);
    else p.delete("tt_act");
    const urlExtActing = state.actingContactId && contactById(state.actingContactId)?.kind === "external";
    if (state.employeeId && employees[state.employeeId] && !state.ttRoleUnsupported && !urlExtActing)
      p.set("tt_emp", state.employeeId);
    else p.delete("tt_emp");
    if (state.view !== "list") p.set("tt_screen", state.view);
    else p.delete("tt_screen");
    if (state.orderId && !state.recipientMode) p.set("tt_id", state.orderId);
    else if (!state.recipientMode) p.delete("tt_id");
    if (state.view === "create" && state.createPhase) p.set("tt_cphase", state.createPhase);
    else p.delete("tt_cphase");
    if (state.view === "public-receipt" && isPublicGuestPage()) {
      p.set("tt_screen", "public-receipt");
      p.delete("tt_receipt");
    } else if (state.view === "handoff-receipt" && state.handoffReceipt) {
      p.set("tt_screen", "handoff-receipt");
      p.set(
        "tt_receipt",
        `${state.handoffReceipt.senderId}|${state.handoffReceipt.orderId}|${state.handoffReceipt.ver}`
      );
    } else if (state.view !== "handoff-receipt") {
      p.delete("tt_receipt");
    }
    history.replaceState(null, "", `#${ROUTE}?${p}`);
  }

  function lkBootstrapAuthoritativeExternalActor(boot) {
    return !!(boot && (boot.externalPerson || boot.publicHolder || boot.publicRecipient));
  }

  function authoritativeExternalActorFromBootstrap(boot) {
    if (!lkBootstrapAuthoritativeExternalActor(boot)) return null;
    return boot.actorContact?.id || boot.actorPartyId || null;
  }

  function readUrl() {
    const p = new URLSearchParams(location.hash.split("?")[1] || "");
    const lkBoot = TT_LK && window.__TT_LK_BOOTSTRAP__ ? window.__TT_LK_BOOTSTRAP__ : null;
    if (lkBoot) {
      state.ttRoleUnsupported = false;
      state.ttRequestedRole = "";
      state.ttPrototypeRole = lkBoot.prototypeRole || "manager";
      state.lkActorPartyId = lkBoot.actorPartyId || null;
      state.lkLinkedEmployeeId = lkBoot.linkedEmployeeId || null;
      const authExt = authoritativeExternalActorFromBootstrap(lkBoot);
      state.actingContactId = authExt || null;
      applyLkCapabilitiesFromBootstrap(lkBoot);
      enforceReadOnlyRouteGuards();
    }
    const resolved = TT_LK && window.__TT_LK_BOOTSTRAP__
      ? { unsupported: false, role: state.ttPrototypeRole, person: null, explicit: false, requested: "" }
      : Sc()?.resolveTanTrackerRole?.(p) || {
      unsupported: false,
      role: "manager",
      person: null,
      explicit: false,
      requested: "",
    };
    state.ttRoleUnsupported = resolved.unsupported;
    state.ttRequestedRole = resolved.requested || "";
    if (TT_LK) {
      if (!lkBootstrapAuthoritativeExternalActor(lkBoot)) {
        const act = p.get("tt_act");
        state.actingContactId = act && contactById(act)?.kind === "external" ? act : null;
      }
    } else state.actingContactId = p.get("tt_act") || null;
    const hat = p.get("tt_hat");
    if (hat && isPublicGuestPage()) {
      state.publicHolderAccessToken = hat;
      window.__TT_PUBLIC_HOLDER__ = true;
    }
    const ptsEarly = p.get("tt_pts");
    const screenEarly = p.get("tt_screen");
    const urlExternalActing = state.actingContactId && contactById(state.actingContactId)?.kind === "external";
    const ttEmp = p.get("tt_emp");
    if (!resolved.unsupported && ttEmp && employees[ttEmp] && !urlExternalActing) {
      state.employeeId = ttEmp;
      state.ttPrototypeRole = Sc().effectiveRoleForEmployee(ttEmp);
      lastPrototypeRoleSynced = state.ttPrototypeRole;
    } else {
      state.ttPrototypeRole = resolved.unsupported ? "manager" : resolved.role || "manager";
    }
    const ttTok = p.get("tt_tok");
    if (ttTok && isPublicGuestPage()) state.publicInvitationToken = ttTok;
    let recipientFromUrl = p.get("tt_view") === "recipient";
    if (
      isPublicGuestPage() &&
      !recipientFromUrl &&
      ttTok &&
      (p.get("tt_order") || p.get("tt_id")) &&
      p.get("tt_via") === "qr" &&
      screenEarly !== "detail" &&
      screenEarly !== "code"
    ) {
      recipientFromUrl = true;
      p.set("tt_view", "recipient");
    }
    if (
      isPublicGuestPage() &&
      (screenEarly === "detail" || screenEarly === "code" || screenEarly === "public-receipt")
    ) {
      recipientFromUrl = false;
    }
    state.recipientMode = recipientFromUrl;
    const oid = p.get("tt_order") || p.get("tt_id");
    if (oid) state.orderId = oid;
    syncPublicHolderAccessTokenForOrder(state.orderId);
    state.recipientVia = p.get("tt_via") === "qr" ? "qr" : "code";
    if (state.recipientMode && oid) {
      state.recipientTicket = {
        hv: p.get("tt_hv"),
        rcv: p.get("tt_rcv"),
        order: oid,
        tok: ttTok,
      };
      if (ptsEarly) {
        state.lkPhoneSessionToken = ptsEarly;
        const ordPts = orders.find((x) => x.id === oid);
        if (ordPts) state.lkPhoneSessionKey = recipientKey(ordPts);
      } else {
        resetPhoneIdentity();
        state.lkPhoneSessionToken = "";
        state.lkPhoneSessionKey = "";
      }
    } else {
      if (!isPublicGuestPage() || p.get("tt_screen") !== "public-receipt") {
        state.recipientTicket = null;
      }
      if (ptsEarly && isPublicGuestPage() && oid) {
        state.lkPhoneSessionToken = ptsEarly;
        const ordPts = orders.find((x) => x.id === oid);
        if (ordPts) state.lkPhoneSessionKey = recipientKey(ordPts);
      }
    }
    const ordForRoute = oid ? orders.find((x) => x.id === oid) : null;
    if (ordForRoute?.status === "completed" && (state.recipientMode || state.view === "code")) {
      state.recipientMode = false;
      state.view = "detail";
      state.recipientTicket = null;
      state.codeInput = "";
    }
    const scr = p.get("tt_screen");
    if (scr === "public-receipt" && isPublicGuestPage()) {
      state.view = "public-receipt";
      state.recipientMode = false;
    } else if (scr === "public-holder" && isPublicGuestPage()) {
      state.view = "public-holder";
      state.recipientMode = false;
    } else if (scr) state.view = scr;
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
    enforceReadOnlyRouteGuards();
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

  function registryView() {
    const rows = visibleOrders();
    return `<div class="tt-registry tt-view-enter" data-tt="registry-shell">
      ${registryStatTiles()}
      ${
        rows.length
          ? `<div class="tt-table-scroll" tabindex="0" aria-label="Реестр передач"><table class="tt-table tt-table-v2" data-tt="registry"><thead><tr>
      <th>Передача</th><th>Маршрут</th><th>Статус</th><th>Срок</th>
    </tr></thead><tbody id="tt-registry-body">${registryRowsHtml(rows)}</tbody></table></div>
    <div class="tt-cards" data-tt="cards"><div data-tt="registry-sections">${registryCardsHtml(rows)}</div></div>`
          : registryEmptyHtml()
      }
      ${
        showCreateEntryPoints()
          ? `<button type="button" class="tt-primary tt-fab" data-tt="create-fab"><i data-lucide="plus"></i><span class="tt-fab-label">Создать передачу</span></button>`
          : ""
      }
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
        `<label class="tt-wizard-field">Поиск<input data-tt-field="pickQ" value="${E(f.pickQ || "")}" placeholder="Имя или телефон"></label>
        <div class="tt-wizard-contact-list" data-tt="contact-pick">${pick
          .slice(0, 20)
          .map(
            (c) =>
              wizardContactButton(c, f.relayId === c.id)
          )
          .join("")}</div>
        ${wizardBtn("Добавить нового получателя", "create-new-recipient")}`,
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
    const editing = !!state.editDraftOrderId;
    return wizardShell(
      "review",
      editing ? "Проверить и сохранить" : "Проверить и создать",
      editing
        ? "Исправьте данные до физической передачи. Сохранится та же передача."
        : "Убедитесь, что всё верно, затем нажмите «Создать передачу».",
      reviewBody,
      `${wizardBtn(editing ? "Сохранить изменения" : "Создать передачу", "create-wizard-submit", true)}${wizardBtn("Назад", "create-wizard-back", false, "tt-wizard-btn-quiet")}`
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
    const lkRuntime = (typeof TT_LK !== "undefined" && TT_LK) || window.__TT_PUBLIC_RECIPIENT__;
    const phoneHtml =
      telDigits && c?.phone
        ? lkRuntime
          ? `<span class="tt-route-phone-line"><a class="tt-route-phone" href="tel:+${E(telDigits)}" data-tt="route-phone">${E(phoneCore)}</a></span>`
          : `<span class="tt-route-phone-line"><a class="tt-route-phone" href="tel:+${E(telDigits)}" data-tt="route-phone">${E(phoneCore)}</a><span class="tt-route-phone-suffix"> · демо</span></span>`
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

    if (o.status === "completed") {
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
    const actor = actorContactId();
    const isHolder = o.holderId === actor;
    const heroAttr = 'data-tt-detail-hero-primary=""';
    if (o.status === "completed") return "";
    if (!isHolder && canActorCloseDeliveredTransfer(o, actor)) {
      return `<div class="tt-detail-dock" data-tt="detail-mobile-dock" hidden>${btn("Завершить передачу", `data-tt="complete" ${heroAttr}`, "tt-primary")}</div>`;
    }
    if (o.pendingId && isHolder) {
      return `<div class="tt-detail-dock" data-tt="detail-mobile-dock" hidden>${btn("Ввести код", `data-tt="enter-code-dock" ${heroAttr}`, "tt-primary")}</div>`;
    }
    const canComplete = canActorCompleteTransfer(o, actor);
    const mustRelay = isHolder && o.finalRecipientId && o.holderId !== o.finalRecipientId && o.status !== "delivered";
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
    const rows = [
      `<div class="tt-detail-fact-row"><span class="tt-detail-fact-label">Статус</span><span class="tt-detail-fact-value">${statusBadge(o, actor)}</span></div>`,
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
    if (!isHolder || !mustRelay || o.status === "completed") return "";
    const text = o.pendingId
      ? `Ждём подтверждения от ${p?.name || "получателя"} — вы ответственны.`
      : `Передайте ${contactById(o.finalRecipientId)?.name || "конечному получателю"}.`;
    return `<p class="tt-reminder tt-reminder-compact tt-holder-next" data-tt="relay-reminder">${E(text)}</p>`;
  }

  function isConfirmedHandoffTimelineNote(note) {
    return /Подтверждено (одноразовым кодом|по QR)/.test(note || "");
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

  function pendingHandoffPanel(o, p) {
    if (!o.pendingId) return "";
    if (!o.activeInvitation) syncInvitation(o);
    if (!o.activeInvitation) return "";
    const heroAttr = 'data-tt-detail-hero-primary=""';
    const tab = state.handoffTab || "code";
    const inv = o.activeInvitation;
    const extHandoff = shouldUseExternalMessengerHandoff(o);
    if (extHandoff && tab === "qr" && !messengerPortalUrlValid(o) && !o._messengerPortalFetch) {
      void ensureMessengerPortalUrl(o).then(() => renderTracker({ soft: true }));
    }
    const payload = handoffUrl(o, inv);
    const qrLoading = extHandoff && tab === "qr" && !payload;
    const qrNote = extHandoff
      ? "QR ведёт на страницу подтверждения номера в мессенджере (Telegram / MAX)."
      : "QR ведёт на экран получателя с подтверждением телефона и приёмом передачи на сервере.";
    const openRecipientLabel = extHandoff
      ? "Открыть страницу получателя"
      : TT_LK
        ? "Открыть экран получателя (QR)"
        : "Сканировать QR (демо)";
    const qrBlock =
      tab === "qr"
        ? `<div class="tt-handoff-qr" data-tt="handoff-qr">
        ${
          qrLoading
            ? `<p class="tt-muted" data-tt="handoff-qr-loading">Подготовка QR…</p>`
            : `<div class="tt-qr-wrap" data-tt="qr-host" data-payload="${E(payload)}"></div>`
        }
        <p class="tt-muted tt-qr-note">${E(qrNote)}</p>
        ${btn(openRecipientLabel, 'data-tt="scan-qr-demo"', "tt-detail-alt-action")} ${btn("Скрыть QR", 'data-tt="tab-code"', "tt-detail-alt-action")}
      </div>`
        : "";
    const handoffHeading = o.fromExternal ? "Передайте предмет" : "Подтвердите передачу";
    return `<section class="tt-detail-task-card tt-detail-task-card--hero" data-tt="detail-task-card">
      <h3 class="tt-detail-task-heading">${E(handoffHeading)}</h3>
      <p class="tt-detail-task-receiver">Получатель: <strong>${E(p?.name || "—")}</strong></p>
      <p class="tt-detail-task-instructions">Попросите получателя открыть передачу и получить код. Введите его здесь, затем отдайте предмет.</p>
      <div class="tt-handoff" data-tt="handoff-panel">
        <div class="tt-handoff-actions">
          ${btn("Ввести код", `data-tt="enter-code" ${heroAttr}`, "tt-primary tt-btn-block")}
          ${tab === "qr" ? "" : btn("QR-код", 'data-tt="tab-qr"', "tt-detail-alt-action")}
          ${o.canEditDraft ? btn("Изменить передачу", 'data-tt="edit-draft"', "tt-detail-alt-action") : ""}
        </div>
        ${qrBlock}
      </div>
      ${messengerInviteBlockHtml(o)}
      ${
        o.finalRecipientId && o.holderId !== o.finalRecipientId
          ? shortRelayReminder(o, p, true, true)
          : ""
      }
    </section>`;
  }

  function pendingRecipientCodeBlock(o) {
    const c = o.code;
    if (!c || !codeValid(o)) {
      return `<div class="tt-recipient-step" data-tt="recipient-step-code">${btn("Получить код", 'data-tt="gen-code"', "tt-primary tt-btn-block")}</div>`;
    }
    return `<div class="tt-recipient-code-block">
        <span class="tt-recipient-code-display" data-tt="shown-code">${E(c.code)}</span>
        ${btn("Скопировать", 'data-tt="copy-recipient-code"', "tt-btn-ghost")}
        <p class="tt-muted">Код действует 5 мин · до ${dt(c.expiresAt)}</p>
      </div>`;
  }

  function pendingRecipientDetailCard(o, holder) {
    const fromExt = o.fromExternal && lkAuthenticatedCabinet() && lkMutationAllowed();
    const heading = fromExt ? "Вам передают от клиента" : "Примите передачу";
    const intro = fromExt
      ? `Клиент <strong>${E(holder?.name || "—")}</strong> отправил заявку. Примите передачу или отклоните заявку.`
      : `От <strong>${E(holder?.name || "—")}</strong>. Получите одноразовый код и сообщите его держателю.`;
    const decline =
      fromExt && !state.extDeclineConfirmOrderId
        ? `<div class="tt-detail-primary">${btn("Отклонить заявку", 'data-tt="ext-request-decline"', "tt-btn-ghost")}</div>`
        : "";
    const declineConfirm =
      fromExt && state.extDeclineConfirmOrderId === o.id
        ? `<div class="tt-detail-primary"><p class="tt-muted">Отклонить заявку ${E(o.id)}?</p>
          ${btn("Подтвердить отклонение", 'data-tt="ext-decline-confirm"', "tt-primary tt-btn-block")}
          ${btn("Отмена", 'data-tt="ext-decline-cancel"', "tt-btn-ghost tt-btn-block")}</div>`
        : "";
    return `<section class="tt-detail-task-card tt-detail-task-card--hero" data-tt="detail-task-pending-recipient">
      <h3 class="tt-detail-task-heading">${E(heading)}${fromExt ? ' <span class="tt-badge" data-tt="from-external">от клиента</span>' : ""}</h3>
      <p class="tt-detail-task-instructions">${intro}</p>
      ${fromExt ? "" : pendingRecipientCodeBlock(o)}
      ${declineConfirm || decline}
      ${state.error ? `<p class="tt-error">${E(state.error)}</p>` : ""}
    </section>`;
  }

  function detailTaskSection(o) {
    const p = o.pendingId ? contactById(o.pendingId) : null;
    const h = contactById(o.holderId);
    const fin = o.finalRecipientId ? contactById(o.finalRecipientId) : null;
    const actor = actorContactId();
    const isHolder = o.holderId === actor;
    const heroAttr = 'data-tt-detail-hero-primary=""';
    const canComplete = canActorCompleteTransfer(o, actor);
    const mustRelay =
      isHolder &&
      o.finalRecipientId &&
      o.holderId !== o.finalRecipientId &&
      o.status !== "completed" &&
      o.status !== "delivered";
    const confirmingComplete = canComplete && state.completeConfirmOrderId === o.id;
    const canContinueDelivered =
      isHolder && o.status === "delivered" && !o.pendingId && mustRelay === false && o.holderId === o.finalRecipientId;

    if (isExternalShell() && isHolder && !o.pendingId && window.TtExternalUi?.externalHolderDetailBlocks) {
      const extBlocks = window.TtExternalUi.externalHolderDetailBlocks(o, actor);
      if (extBlocks) return extBlocks;
    }

    if (o.status === "completed") return completedTaskCard(o, actor);
    if (o.pendingId === actor && o.status !== "completed") return pendingRecipientDetailCard(o, h);
    if (!isHolder && canActorCloseDeliveredTransfer(o, actor)) {
      return `<section class="tt-detail-task-card" data-tt="detail-task-card">
        <h3 class="tt-detail-task-heading">Доставлено</h3>
        <p class="tt-detail-task-instructions">Предмет у <strong>${E(fin?.name || contactById(o.holderId)?.name || "получателя")}</strong>. Создатель может явно завершить передачу.</p>
        <div class="tt-detail-primary" data-tt="detail-primary-actions">
          ${btn("Завершить передачу", `data-tt="complete" ${heroAttr}`, "tt-primary tt-btn-block")}
        </div>
      </section>`;
    }
    if (!isHolder) {
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
    if (o.pendingId) return pendingHandoffPanel(o, p);
    if (canContinueDelivered) {
      return `<section class="tt-detail-task-card" data-tt="detail-task-card">
        <h3 class="tt-detail-task-heading">Доставлено</h3>
        <p class="tt-detail-task-instructions">Предмет у конечного получателя. Можно явно завершить передачу или передать дальше по цепочке.</p>
        <div class="tt-detail-primary" data-tt="detail-primary-actions">
          ${btn("Завершить передачу", `data-tt="complete" ${heroAttr}`, "tt-primary tt-btn-block")}
          ${btn("Передать другому человеку", 'data-tt="transfer"', "tt-detail-alt-action")}
        </div>
      </section>`;
    }
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
    const actor = actorContactId();
    const isHolder = o.holderId === actor;
    const canComplete = canActorCompleteTransfer(o, actor);
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
        ? `${o.canEditDraft ? overflowActionBtn("Изменить передачу", "edit-draft", "pencil") : ""}${overflowActionBtn("Выбрать другого получателя", "change-pending", "user-round-cog")}${overflowActionBtn("Отменить ожидание", "cancel-pending", "ban")}`
        : isHolder && o.canEditDraft
          ? overflowActionBtn("Изменить передачу", "edit-draft", "pencil")
          : "";

    const demoBtns = [];
    if (showActHolder) demoBtns.push(overflowActionBtn("Смотреть как текущий держатель (демо)", "act-holder", "eye"));
    if (p && o.holderId !== p.id && !state.actingContactId)
      demoBtns.push(overflowActionBtn("Действовать как получатель", "act-recipient", "user-check"));
    if (isHolder && o.pendingId) demoBtns.push(overflowActionBtn("Открыть экран получателя (демо)", "open-recipient", "external-link"));

    const overflowGroups = [];
    if (otherActionBtns) {
      overflowGroups.push(
        `<div class="tt-detail-overflow-group" data-tt="other-actions"><p class="tt-detail-overflow-label">Другие действия</p>${otherActionBtns}</div>`
      );
    }
    if (demoBtns.length) {
      overflowGroups.push(
        `<div class="tt-detail-overflow-group" data-tt="detail-demo"><p class="tt-detail-overflow-label">Демо-сценарии</p><div data-tt="detail-secondary-actions">${demoBtns.join("")}</div></div>`
      );
    }
    const overflowBlock = overflowGroups.length
      ? `<details class="tt-detail-overflow" data-tt="detail-overflow"><summary aria-label="Ещё действия">⋯</summary>
        <div class="tt-detail-overflow-panel" role="menu">${overflowGroups.join('<hr class="tt-detail-overflow-sep" aria-hidden="true">')}</div></details>`
      : "";

    const mobileDock =
      typeof window !== "undefined" && window.innerWidth <= 767 ? detailMobilePrimaryDock(o) : "";
    const metaBlock = desktopDetail
      ? ""
      : `<div class="tt-detail-meta">${statusBadge(o, actor)}<span class="${dueCls}">${E(dueLabel)}</span></div>`;
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
      ${detailTaskSection(o)}
      ${detailRouteDisclosure(o)}
      ${!desktopDetail ? detailNotesDisclosure(o) : ""}
      <details class="tt-disclosure tt-detail-att-wrap" data-tt="detail-attachments-disclosure"${isDetailAttDisclosureOpen(o) ? " open" : ""}>
        ${disclosureSummary("Фото и файлы", { icon: "paperclip", count: attCount ? attCount : null })}
        <div class="tt-disclosure-body">${attachmentsSection(o, {
          readonly: !isHolder || o.status === "completed",
          showPicker: isHolder && o.status !== "completed",
          compact: true,
          omitTitle: true,
          inputKey: "detail",
          items: attItems,
          allowServerDelete: TT_LK && isHolder && o.status !== "completed",
        })}</div>
      </details>
      </div>
      <aside class="tt-detail-aside">
      ${desktopDetail || isExternalShell() ? detailFactsCard(o, actor) : ""}
      ${detailHistoryHtml(o, tl, desktopDetail)}
      ${
        confirmingComplete
          ? `<div class="tt-complete-confirm" data-tt="complete-confirm">
        <p class="tt-warning">Завершить передачу «${E(o.item)}» (${E(o.id)})? Это необратимо: дальнейшие передачи по этому треку будут недоступны.</p>
        <div class="tt-actions">${btn("Подтвердить завершение", 'data-tt="confirm-complete"', "tt-primary")}${btn("Отмена", 'data-tt="cancel-complete"')}</div>
      </div>`
          : ""
      }
      ${state.toast ? `<p class="tt-success" data-tt="toast">${E(state.toast)}</p>` : ""}
      ${state.error ? `<p class="tt-error">${E(state.error)}</p>` : ""}
      </aside>
      </div>
      ${mobileDock}
    </div>`;
  }

  function transferView(o) {
    const f = state.form || {
      pickQ: "",
      recipientId: "",
      mode: "list",
      newName: "",
      newPhone: "",
      existingMatchId: "",
      newPhoneStep: "phone",
    };
    state.form = f;
    const allowed = transferPickAllowed(o, f);
    const pick = allowed.filter((c) => !f.pickQ || (c.name + c.phone).toLowerCase().includes(f.pickQ.toLowerCase()));
    const pickHtml = f.mode === "list" ? renderContactPickGrouped(pick, f.recipientId) : "";
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

  function codeView(o) {
    const showCode = state.codeDemoRevealed && o.code && codeValid(o);
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
          ${btn("Получить демо-код", 'data-tt="demo-reveal-code"', "tt-btn-ghost")}
          ${btn("Истечь срок кода (демо)", 'data-tt="demo-expire"', "tt-btn-ghost")}
        </div>
      </div>
      ${
        showCode
          ? `<div class="tt-holder-demo-code" data-tt="holder-shown-code"><span class="tt-code tt-code-inline">${E(o.code.code)}</span></div>`
          : ""
      }
      <p id="tt-code-demo-help" class="tt-muted tt-code-help">Демо без СМС: нажмите «Получить демо-код», затем введите цифры и «Подтвердить».</p>
      ${state.error ? `<p class="tt-error" data-tt="code-error">${E(state.error)}</p>` : ""}
      <div class="tt-code-dock${isExternalShell() ? " tt-code-dock--inline" : ""}">${btn("Подтвердить", 'data-tt="confirm-code"', "tt-primary tt-btn-block")}${btn("Назад", 'data-tt="detail"', "tt-btn-ghost tt-btn-block")}</div>
    </div>`;
  }

  function recipientScreen(o) {
    const ticketHv = state.recipientTicket?.hv;
    const resolved = ticketHv != null ? resolveInvitation(o, ticketHv) : { inv: o.activeInvitation, stale: false };
    const inv = resolved.inv || o.activeInvitation;
    const from = contactById(inv?.holderId || o.holderId);
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
    const verifyStep = !verified
      ? TT_LK
        ? `<div class="tt-recipient-step tt-recipient-step--active" data-tt="recipient-step-verify">
        <p class="tt-recipient-step-label">Шаг 1 · подтвердите, что это ваш номер</p>
        ${btn("Отправить код на телефон", 'data-tt="recipient-phone-send"', "tt-btn-ghost tt-btn-block")}
        <label class="tt-field"><span class="tt-field-label">Код из SMS</span>
        <input class="tt-input" inputmode="numeric" maxlength="6" data-tt="recipient-phone-code" value="${E(state.recipientPhoneCodeInput || "")}" autocomplete="one-time-code"></label>
        ${btn("Подтвердить номер", 'data-tt="recipient-phone-verify"', "tt-primary tt-btn-block")}
        <p class="tt-muted tt-recipient-step-hint">Без настроенного SMS-провайдера отправка кода недоступна.</p>
      </div>`
        : `<div class="tt-recipient-step tt-recipient-step--active" data-tt="recipient-step-verify">
        <p class="tt-recipient-step-label">Шаг 1 · подтвердите, что это ваш номер</p>
        ${btn("Подтвердить номер (демо)", 'data-tt="demo-verify-phone"', "tt-primary tt-btn-block")}
        <p class="tt-muted tt-recipient-step-hint">Демо без СМС: нажмите кнопку, чтобы продолжить.</p>
      </div>`
      : `<p class="tt-success tt-recipient-verified">Номер подтверждён.</p>`;
    const receiveStep =
      verified && !stale && qrMode
        ? `<div class="tt-recipient-step tt-recipient-step--active" data-tt="recipient-step-receive">
        <p class="tt-recipient-step-label">Шаг 2 · примите предмет</p>
        ${btn("Подтвердить получение", 'data-tt="confirm-qr-receive"', "tt-primary tt-btn-block")}
        <p class="tt-muted tt-recipient-step-hint">Нажмите, когда предмет у вас на руках.</p>
      </div>`
        : verified && !stale && !qrMode && !c
          ? `<div class="tt-recipient-step" data-tt="recipient-step-code">${btn("Получить код", 'data-tt="gen-code"', "tt-primary tt-btn-block")}</div>`
          : verified && !stale && !qrMode && c && !codeValid(o)
            ? `<div class="tt-recipient-step"><p class="tt-error">Код недоступен.</p>${btn("Получить новый код", 'data-tt="gen-code"', "tt-primary tt-btn-block")}</div>`
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
      ${state.error ? `<p class="tt-error" data-tt="recipient-error">${E(state.error)}</p>` : ""}
      ${verifyStep}
      ${receiveStep}
      ${codeBlock}
      ${attDisclosure}
      ${stale && qrMode ? `<p class="tt-error">Подтверждение по этому QR недоступно.</p>` : ""}
      <div class="tt-recipient-foot">${!qrMode && verified ? btn("Истечь срок кода (демо)", 'data-tt="demo-expire"', "tt-btn-ghost tt-recipient-foot-quiet") : ""}${btn("Вернуться к передаче", 'data-tt="exit-recipient"', "tt-btn-ghost tt-recipient-foot-quiet")}</div>
    </article></div>`;
  }

  function externalShellChromeHtml() {
    if (!isExternalShell() || !window.TtExternalUi?.externalActionBarHtml) return "";
    return window.TtExternalUi.externalActionBarHtml();
  }

  function bodyHtml() {
    if (state.ttRoleUnsupported) return unsupportedRoleView();
    const o = state.orderId ? orders.find((x) => x.id === state.orderId) : null;
    if (state.view === "public-receipt") return publicReceiptView();
    if (state.view === "public-holder") return publicHolderView();
    if (createSavedReceiptVisible()) return createSavedReceiptView();
    if (state.view === "handoff-receipt") {
      if (!o || !handoffReceiptValid(o)) return deniedView();
      return handoffReceiptView(o);
    }
    if (state.view === "detail" && o && !orderVisible(o)) return deniedView();
    if (state.view === "create") return createView();
    if (state.view === "transfer" && o) return transferView(o);
    if (state.view === "code" && o) return codeView(o);
    if (state.view === "detail" && o) return detailView(o);
    if (isExternalShell() && state.view === "ext-request" && window.TtExternalUi?.extRequestView) {
      return window.TtExternalUi.extRequestView();
    }
    if (isExternalShell() && o) return detailView(o);
    if (isExternalShell() && window.TtExternalUi?.externalShellHomeHtml) return window.TtExternalUi.externalShellHomeHtml();
    if (isExternalShell()) return `<div class="tt-empty"><p>Нет доступных передач для этого участника.</p></div>`;
    return registryView();
  }

  function userTestBannerBlock() {
    if (!state.userTestEnvironmentBanner) return "";
    return `<div class="tt-user-test-banner" role="alert">${E(state.userTestEnvironmentBanner)}</div>`;
  }

  function renderTracker(opts = {}) {
    if (window.__TT_MESSENGER_PORTAL_ONLY__) return;
    if (current !== ROUTE) return;
    applyBodyClasses();
    const main = document.querySelector("#tt-root-host");
    if (!main) return;
    syncTrackerShellMountFlag(main);

    const viewKey = `${state.view}|${state.orderId}|${state.recipientMode}|${state.handoffTab}|${state.createPhase}`;
    if (viewKey !== lastViewKey && !opts.soft) {
      window.scrollTo(0, 0);
      lastViewKey = viewKey;
    }

    if (state.view === "public-receipt" && isPublicGuestPage()) {
      ttShellMounted = false;
      const body = publicReceiptView();
      main.innerHTML = `<div class="tt-work tt-work-recipient" data-testid="tan-tracker-public-guest">${userTestBannerBlock()}${body}${Att() ? Att().lightboxHtml() : ""}</div>`;
      document.title = "Tandoor RF · Получение подтверждено";
      lucide.createIcons();
      paintQrHosts();
      return;
    }

    if (state.recipientMode) {
      ttShellMounted = false;
      const o = orders.find((x) => x.id === state.orderId);
      const rcv = state.recipientTicket?.rcv;
      const resolvedInv =
        o && state.recipientTicket?.hv != null
          ? resolveInvitation(o, state.recipientTicket.hv)
          : { inv: o?.activeInvitation, stale: false };
      const staleInvite = !!(resolvedInv?.stale && resolvedInv?.inv);
      const rcvOk =
        staleInvite || !rcv || o.pendingId === rcv || o.activeInvitation?.pendingId === rcv;
      const scopeOk =
        staleInvite ||
        !Sc() ||
        Sc().canViewOrder(o, { ...scopeCtx(), externalActing: true, actorContactId: rcv || o.pendingId });
      const allowed = o && rcvOk && scopeOk;
      const recipDemo = isPublicGuestPage()
        ? ""
        : demoHeadPopoverHtml(
            `<p class="tt-demo tt-demo-inline">Демо-данные · изменения до обновления страницы</p>`
          );
      main.innerHTML =
        o && allowed
          ? `<div class="tt-work tt-work-recipient">${userTestBannerBlock()}<div class="tt-head tt-head-compact${isPublicGuestPage() ? "" : " tt-head-compact-demo"}"><span class="tt-head-compact-label">${isPublicGuestPage() ? "Получение передачи" : "Тан-трекер"}</span>${recipDemo}</div>${recipientScreen(o)}${Att() ? Att().lightboxHtml() : ""}</div>`
          : `<div class="tt-work tt-recipient">${userTestBannerBlock()}<p class="tt-error">${o ? "Нет доступа к этой передаче." : "Передача не найдена в демо-памяти. Откройте ссылку из того же окна прототипа."}</p></div>`;
      document.title = "Tandoor RF · Тан-трекер · получатель";
      lucide.createIcons();
      setupDetailOverflowMenu();
      return;
    }

    const snap =
      opts.soft || document.activeElement?.matches?.('[data-tt="search"]') ? captureFocus() : null;
    if (opts.soft && state.view === "list" && patchRegistry()) {
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
    const inDetailFocus = !state.recipientMode && state.view === "detail" && !!state.orderId;
    const inCompactHead =
      inDetailFocus || inCreateWizard || state.view === "code" || state.view === "transfer" || isExternalShell();
    const chrome = inCreateWizard
      ? ""
      : ext && window.TtExternalUi?.externalActionBarHtml
        ? window.TtExternalUi.externalActionBarHtml()
        : ext
          ? `<div class="tt-external-bar"><strong>${E(contactById(state.actingContactId)?.name || "Внешний участник")}</strong>${btn("Выйти из демо-профиля", 'data-tt="clear-act"')}</div>`
          : `<label>Текущий сотрудник (демо)<select data-tt="employee">${Object.keys(employees)
            .map((id) => {
              const label = Sc()?.employeeDemoOptionLabel?.(id, employees) || employees[id].name;
              return `<option value="${id}" ${state.employeeId === id ? "selected" : ""}>${E(label)}</option>`;
            })
            .join("")}</select></label>`;

    const lkRuntime = TT_LK || isPublicGuestPage();
    const demoBody = lkRuntime
      ? `<div data-tt="chrome">${TT_LK && !isPublicGuestPage() ? chrome : ""}</div>`
      : `<p class="tt-demo tt-demo-inline">Демо-данные · изменения до обновления страницы</p><div data-tt="chrome">${chrome}</div>`;
    const demoShell = `${lkReadOnlyBannerHtml()}${
      state.userTestEnvironmentBanner
        ? `<div class="tt-user-test-banner" role="alert">${E(state.userTestEnvironmentBanner)}</div>`
        : ""
    }`;

    const demoHeadPopover = lkRuntime ? "" : demoHeadPopoverHtml(demoBody);
    const externalLkShell = ext && lkRuntime;

    const headBlock = externalLkShell
      ? ""
      : inCompactHead
      ? `<div class="tt-head tt-head-compact${lkRuntime ? "" : " tt-head-compact-demo"}"><span class="tt-head-compact-label">Тан-трекер</span>${demoHeadPopover}</div>`
      : onListRegistry
        ? `<div class="tt-head tt-registry-head"><div class="tt-registry-head-row">
        <div class="tt-registry-head-main"><h1>Тан-трекер</h1>
        <div class="tt-registry-sub-row"><p class="tt-registry-sub">Передача документов и предметов</p>${demoHeadPopover}</div></div>
        <span class="tt-head-cta-desktop" data-tt="head-cta">${showCreateEntryPoints() ? btn("Создать передачу", 'data-tt="create" data-tt-main-cta', "tt-primary") : ""}</span>
      </div></div>`
        : `<div class="tt-head"><div><h1>Тан-трекер</h1><p>Передача документов и предметов</p></div>
        <span data-tt="head-cta">${state.view === "list" && showCreateEntryPoints() ? btn("Создать передачу", 'data-tt="create" data-tt-main-cta', "tt-primary") : ""}</span>
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
        if (cta) cta.innerHTML = state.view === "list" && showCreateEntryPoints() ? btn("Создать передачу", 'data-tt="create" data-tt-main-cta', "tt-primary") : "";
        const popBody = document.querySelector(".tt-demo-head-popover .tt-demo-popover-body");
        if (popBody && (onListRegistry || inCompactHead)) popBody.innerHTML = demoBody;
      }
      const meta = document.querySelector(".tt-shell-meta");
      if (meta) {
        meta.classList.toggle("tt-shell-meta-compact", inDetailFocus);
        meta.classList.toggle(
          "tt-shell-meta--empty",
          (onListRegistry || inCompactHead) &&
            !state.userTestEnvironmentBanner &&
            !(lkAuthenticatedCabinet() && !lkMutationAllowed()),
        );
        meta.innerHTML = demoShell;
      }
    }

    const content = document.getElementById("tt-content");
    if (content) content.innerHTML = externalShellChromeHtml() + bodyHtml();
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

  function submitCreate() {
    syncWizardFieldsFromDom();
    const f = state.form;
    state.error = "";
    if (state.createSubmitting) return;
    if (denyCabinetWriteMutation()) return;
    if (state.attachBusy) {
      state.error = "Дождитесь обработки файлов.";
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
    const holderId = TT_LK ? actorContactId() : employeeContact(state.employeeId)?.id;
    if (finalId === holderId || pendingId === holderId) {
      state.error = "Нельзя назначить себя получателем при создании.";
      return;
    }
    if (TT_LK && window.TanTrackerLk && window.TanTrackerLk.createTransfer) {
      const finalContact = contactById(finalId);
      const relayContact = f.relayId ? contactById(f.relayId) : null;
      const payload = {
        item: f.item.trim(),
        qty: f.qty?.trim() || "",
        comment: f.comment?.trim() || "",
        dueAt: f.due || null,
        finalRecipientPartyId: isDraftPartyId(finalId) ? undefined : finalId,
        finalRecipientExternal:
          finalContact && (finalContact.draft || isDraftPartyId(finalId))
            ? { name: finalContact.name, phone: finalContact.phone }
            : undefined,
        relayPartyId: f.relayId && !isDraftPartyId(f.relayId) ? f.relayId : undefined,
        relayExternal:
          relayContact && (relayContact.draft || isDraftPartyId(f.relayId))
            ? { name: relayContact.name, phone: relayContact.phone }
            : undefined,
        stagingAttachmentIds: state.attachStaging
          .map((s) => s.serverStagingId)
          .filter(Boolean),
      };
      const editingId = state.editDraftOrderId;
      if (editingId) {
        const order = orders.find((x) => x.id === editingId);
        const kept = new Set(
          state.attachStaging.filter((s) => s.serverAttachmentId).map((s) => s.serverAttachmentId),
        );
        const removeAttachmentIds = (order?.attachments || [])
          .map((a) => a.id)
          .filter((id) => !kept.has(id));
        payload.rowVersion = state.editDraftRowVersion ?? order?.rowVersion;
        payload.removeAttachmentIds = removeAttachmentIds;
        if (!payload.rowVersion) {
          state.error = "Не удалось определить версию передачи. Обновите страницу.";
          return;
        }
        state.createSubmitting = true;
        renderTracker();
        window.TanTrackerLk.updateTransferDraft(editingId, payload)
          .then(() => {
            state.createSubmitting = false;
            state.orderId = editingId;
            state.view = "detail";
            state.form = null;
            state.editDraftOrderId = null;
            state.editDraftRowVersion = null;
            state.editDraftRemovedAttachmentIds = [];
            state.createPhase = "item";
            state.createReturnPhase = null;
            state.attachStaging = [];
            state.toast = "Изменения сохранены.";
            state.error = "";
            writeUrl();
            renderTracker();
          })
          .catch((err) => {
            state.createSubmitting = false;
            state.error = err?.message || "Не удалось сохранить изменения.";
            renderTracker();
          });
        return;
      }
      state.createSubmitting = true;
      renderTracker();
      window.TanTrackerLk.createTransfer(payload)
        .then((created) => {
          state.createSubmitting = false;
          state.orderId = created.publicCode || created;
          state.view = "detail";
          clearDetailAttDisclosure();
          state.form = null;
          state.createPhase = "item";
          state.createReturnPhase = null;
          state.attachStaging = [];
          state.attachError = "";
          const inRegistry = orders.some((x) => x.id === created.publicCode);
          if (created.refreshFailed || !inRegistry) {
            state.createSavedReceipt = {
              publicCode: created.publicCode,
              refreshFailed: !!created.refreshFailed,
              refreshError: created.refreshError || "",
            };
            state.toast = "";
            state.error = created.refreshFailed
              ? `Передача ${created.publicCode} сохранена на сервере. ${created.refreshError || "Не удалось обновить реестр."}`.trim()
              : "";
          } else {
            state.createSavedReceipt = null;
            state.error = "";
            state.toast = "Передача создана.";
          }
          writeUrl();
          renderTracker();
        })
        .catch((err) => {
          state.createSubmitting = false;
          state.error = err?.message || "Не удалось создать передачу.";
          renderTracker();
        });
      return;
    }
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
    const b = e.target.closest("[data-tt], [data-tt-open], [data-tt-pick]");
    if (!b || current !== ROUTE) return;
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
      syncPublicHolderAccessTokenForOrder(nextOrderId);
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
    if (action && CABINET_WRITE_ACTIONS.has(action) && denyCabinetWriteMutation()) {
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
    if (action === "edit-draft" && o?.canEditDraft) {
      beginEditDraft(o);
      renderTracker();
      return;
    }
    if (action === "create" || action === "create-fab") {
      state.editDraftOrderId = null;
      state.editDraftRowVersion = null;
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
    if (action === "create-wizard-back") {
      if (state.attachBusy) {
        bumpAttachOpGen();
        state.attachBusy = false;
        state.attachBusyGen = null;
      }
      const r = wizardBack();
      if (r === "cancel") {
        if (state.editDraftOrderId) {
          state.view = "detail";
          state.form = null;
          state.editDraftOrderId = null;
          state.editDraftRowVersion = null;
        } else {
          state.view = "list";
          state.orderId = null;
          state.form = null;
          state.createPhase = "item";
          state.createReturnPhase = null;
        }
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
      if (isPublicHolderSession() && window.TanTrackerLk?.publicHolderSendToFinal) {
        void window.TanTrackerLk.publicHolderSendToFinal(state.publicHolderAccessToken)
          .then((data) => {
            applyPublicHolderPayload(data);
            state.toast = "Конечный получатель назначен.";
            renderTracker();
          })
          .catch((err) => {
            state.error = err?.message || "Не удалось назначить получателя.";
            renderTracker();
          });
        return;
      }
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
    if (action === "messenger-invite-create") {
      const o = orders.find((x) => x.id === state.orderId);
      if (!o || state.messengerInviteBusy || !window.TanTrackerLk?.createExternalMessengerInvite) {
        renderTracker();
        return;
      }
      if (!lkMutationAllowed()) {
        state.error = lkMutationBlockedMessage();
        renderTracker();
        return;
      }
      state.messengerInviteBusy = true;
      state.messengerInviteOrderId = o.id;
      state.messengerInviteError = "";
      renderTracker({ soft: true });
      void window.TanTrackerLk.createExternalMessengerInvite(o.id)
        .then(function (data) {
          applyMessengerInviteData(o, data);
          state.toast = "Ссылка для мессенджера создана.";
          state.messengerInviteError = "";
        })
        .catch(function (err) {
          state.messengerInviteError = (err && err.message) || "Не удалось создать ссылку.";
        })
        .finally(function () {
          state.messengerInviteBusy = false;
          renderTracker();
        });
      return;
    }
    if (action === "messenger-invite-copy") {
      const o = orders.find((x) => x.id === state.orderId);
      if (!o) {
        renderTracker();
        return;
      }
      const runCopy = (url) => copyInviteUrlWithFeedback(url, '[data-tt="messenger-invite-url"]');
      if (messengerPortalUrlValid(o)) {
        runCopy(o.messengerPortalUrl);
        return;
      }
      void ensureMessengerPortalUrl(o).then((url) => runCopy(url));
      return;
    }
    if (action === "messenger-invite-share") {
      const o = orders.find((x) => x.id === state.orderId);
      const url = o?.messengerPortalUrl;
      if (url && navigator.share) {
        void navigator.share({ title: "Получение передачи", url }).catch(() => {});
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
      if (state.attachBusy || state.createSubmitting) {
        renderTracker();
        return;
      }
      submitCreate();
      renderTracker();
      return;
    }
    if (action === "create-retry-refresh" && window.TanTrackerLk?.refreshBootstrap) {
      void window.TanTrackerLk.refreshBootstrap()
        .then(() => {
          const code = state.createSavedReceipt?.publicCode || state.orderId;
          if (code && orders.some((x) => x.id === code)) {
            state.createSavedReceipt = null;
            state.orderId = code;
            state.view = "detail";
            state.error = "";
            state.toast = "Данные обновлены.";
          } else {
            state.error = "Передача пока не появилась в реестре — попробуйте позже или перезагрузите страницу.";
          }
          writeUrl();
          renderTracker();
        })
        .catch((err) => {
          state.error = err?.message || "Не удалось обновить данные.";
          renderTracker();
        });
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
      state.publicReceipt = null;
      state.createSavedReceipt = null;
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
      if (!state.form) state.form = defaultCreateForm();
      if (state.form.mode === "new") {
        state.form.mode = "list";
        state.form.existingMatchId = "";
        state.form.newPhoneStep = "phone";
      } else {
        state.form.mode = "new";
        state.form.newPhoneStep = "phone";
        state.form.existingMatchId = "";
      }
      state.error = "";
      renderTracker();
      return;
    }
    if (action === "transfer-phone-next") {
      if (!state.form) state.form = defaultCreateForm();
      document.querySelectorAll('[data-tt-field="newPhone"]').forEach((el) => {
        state.form.newPhone = el.value;
      });
      const existing = contactByPhone(state.form.newPhone);
      if (existing) {
        state.form.existingMatchId = existing.id;
        state.error = "";
      } else if (!normPhone(state.form.newPhone)) {
        state.error = TT_LK
          ? "Введите телефон: 10 цифр после +7."
          : "Введите телефон: 10 цифр после +7 (демо).";
      } else {
        state.form.existingMatchId = "";
        state.form.newPhoneStep = "name";
        state.error = "";
      }
      renderTracker();
      return;
    }
    if (action === "pick-existing" || action === "pick-existing-wizard") {
      if (!state.form) state.form = defaultCreateForm();
      document.querySelectorAll('[data-tt-field="newPhone"]').forEach((el) => {
        state.form.newPhone = el.value;
      });
      const cid = state.form.existingMatchId || contactByPhone(state.form.newPhone)?.id;
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
      writeUrl();
      renderTracker();
      return;
    }
    if (action === "confirm-transfer" && o && state.form) {
      let rid = state.form.recipientId;
      if (state.form.mode === "new") {
        if (isPublicHolderSession()) {
          startPending(o, null, { name: state.form.newName, phone: state.form.newPhone });
          state.view = "detail";
          writeUrl();
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
      if (tryConfirmCode(o, state.codeInput)) afterCodeSend(o, senderBefore);
      writeUrl();
      renderTracker();
      return;
    }
    if (action === "ext-request-decline" && o) {
      state.extDeclineConfirmOrderId = o.id;
      state.error = "";
      renderTracker();
      return;
    }
    if (action === "ext-decline-cancel") {
      state.extDeclineConfirmOrderId = null;
      state.error = "";
      renderTracker();
      return;
    }
    if (action === "ext-decline-confirm" && o && window.TanTrackerLk?.declineExternalRequest) {
      state.error = "";
      void window.TanTrackerLk.declineExternalRequest(o.id, "")
        .then(function () {
          state.extDeclineConfirmOrderId = null;
          state.view = "list";
          state.orderId = null;
          renderTracker();
        })
        .catch(function (err) {
          state.error = err instanceof Error ? err.message : "Не удалось отклонить заявку.";
          renderTracker();
        });
      return;
    }
    if (action === "complete" && o) {
      state.error = "";
      const actor = actorContactId();
      if (o.status === "completed") state.error = "Передача уже завершена.";
      else if (o.pendingId) state.error = "Сначала отмените ожидание или подтвердите передачу.";
      else if (!actor || o.holderId !== actor) state.error = "Завершить может только текущий держатель.";
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
      const actor = actorContactId();
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
    if (action === "scan-qr-demo" && o) {
      if (shouldUseExternalMessengerHandoff(o)) {
        openExternalMessengerPortalTab(o);
        return;
      }
      state.recipientMode = true;
      state.recipientVia = "qr";
      resetPhoneIdentity();
      if (o.activeInvitation) {
        state.recipientTicket = {
          hv: String(o.activeInvitation.hv),
          rcv: o.activeInvitation.pendingId,
          order: o.id,
          tok: o.activeInvitation.invitationToken || null,
        };
      }
      writeUrl();
      renderTracker();
      return;
    }
    if (action === "open-recipient" && o) {
      if (shouldUseExternalMessengerHandoff(o)) {
        openExternalMessengerPortalTab(o);
        return;
      }
      state.recipientMode = true;
      state.recipientVia = state.handoffTab === "qr" ? "qr" : "code";
      resetPhoneIdentity();
      writeUrl();
      renderTracker();
      return;
    }
    if (action === "confirm-qr-receive" && o) {
      const ticket = resolveInvitation(o, state.recipientTicket?.hv ?? o.activeInvitation?.hv);
      tryConfirmQr(o, ticket);
      renderTracker();
      return;
    }
    if (action === "recipient-phone-send" && o && TT_LK && window.TanTrackerLk?.sendRecipientPhoneCode) {
      state.error = "";
      window.TanTrackerLk.sendRecipientPhoneCode(o, state.recipientTicket)
        .then(() => {
          state.toast = "Код отправлен на номер получателя.";
          renderTracker();
        })
        .catch((err) => {
          state.error = err?.message || "Не удалось отправить код.";
          renderTracker();
        });
      return;
    }
    if (action === "recipient-phone-verify" && o && TT_LK && window.TanTrackerLk?.verifyRecipientPhoneCode) {
      const code = state.recipientPhoneCodeInput.replace(/\D/g, "");
      state.error = "";
      window.TanTrackerLk.verifyRecipientPhoneCode(o, state.recipientTicket, code)
        .then((token) => {
          state.lkPhoneSessionToken = token;
          state.lkPhoneSessionKey = recipientKey(o);
          applyPublicAttachmentUrls(o);
          state.toast = "Номер подтверждён.";
          writeUrl();
          renderTracker();
        })
        .catch((err) => {
          state.error = err?.message || "Неверный код.";
          renderTracker();
        });
      return;
    }
    if (action === "exit-recipient") {
      state.recipientMode = false;
      if (isPublicGuestPage() && state.publicHolderAccessToken) state.view = "public-holder";
      else if (isPublicGuestPage()) state.view = "detail";
      else state.view = "detail";
      ttShellMounted = false;
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
    if (action === "clear-act") {
      bumpAttachOpGen();
      state.attachBusy = false;
      state.attachBusyGen = null;
      state.actingContactId = null;
      clearCompleteConfirm();
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
    if (action === "public-send-to-final" && window.TanTrackerLk?.publicHolderSendToFinal) {
      const token = state.publicHolderAccessToken;
      if (!token) {
        state.error = "Сессия недоступна. Откройте ссылку из QR повторно.";
        renderTracker();
        return;
      }
      void window.TanTrackerLk.publicHolderSendToFinal(token)
        .then((data) => {
          applyPublicHolderPayload(data);
          state.toast = "Конечный получатель назначен.";
          renderTracker();
        })
        .catch((err) => {
          state.error = err?.message || "Не удалось назначить получателя.";
          renderTracker();
        });
      return;
    }
    if (action === "public-open-recipient-qr" && o) {
      state.recipientMode = true;
      state.recipientVia = "qr";
      if (o.activeInvitation) {
        state.recipientTicket = {
          hv: String(o.activeInvitation.hv),
          rcv: o.activeInvitation.pendingId,
          order: o.id,
          tok: o.activeInvitation.invitationToken || null,
        };
      }
      writeUrl();
      renderTracker();
      return;
    }
    if (action === "gen-code") {
      const order = o || orders.find((x) => x.id === state.orderId);
      if (!order) return;
      if (window.__TT_PUBLIC_RECIPIENT__ && !state.lkPhoneSessionToken) {
        state.error = "Сначала подтвердите номер телефона кодом из SMS.";
      } else if (!TT_LK && !identityVerified(order)) {
        state.error = "Сначала подтвердите номер (демo).";
      } else generateCode(order);
      renderTracker();
      return;
    }
    if (action === "attach-remove") {
      const sid = b.getAttribute("data-staging-id");
      const i = state.attachStaging.findIndex((x) => x.id === sid);
      if (i >= 0 && Att()) {
        const removed = state.attachStaging[i];
        if (removed.serverAttachmentId) {
          state.editDraftRemovedAttachmentIds.push(removed.serverAttachmentId);
        }
        Att().untrackUrl(state.attachStaging[i].url);
        state.attachStaging.splice(i, 1);
      }
      renderTracker();
      return;
    }
    if (action === "attach-delete" && o) {
      const attId = b.getAttribute("data-att-id");
      if (!attId) return;
      state.attachBusy = true;
      renderTracker();
      const deletePromise =
        isPublicHolderSession() && window.TanTrackerLk?.publicHolderDeleteAttachment
          ? window.TanTrackerLk.publicHolderDeleteAttachment(state.publicHolderAccessToken, attId).then(
              (data) => {
                applyPublicHolderPayload(data);
              },
            )
          : TT_LK && window.TanTrackerLk?.deleteTransferAttachment
            ? window.TanTrackerLk.deleteTransferAttachment(o.id, attId)
            : Promise.reject(new Error("Удаление недоступно."));
      deletePromise
        .then(() => {
          state.toast = "Файл удалён.";
        })
        .catch((err) => {
          state.attachError = err?.message || "Не удалось удалить файл.";
        })
        .finally(() => {
          state.attachBusy = false;
          renderTracker();
        });
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
    if (action === "attach-lightbox-retry") {
      const a = state.lightboxAtt;
      if (a && Att()?.canPreview(a.mime)) {
        openAttachLightbox(a, b);
      }
      return;
    }
    if (action === "demo-verify-phone") {
      if (TT_LK) return;
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
    if (e.target.matches('[data-tt="recipient-phone-code"]')) {
      state.recipientPhoneCodeInput = e.target.value;
      return;
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

  function hydrateFromServer(data, opts) {
    if (!data) return;
    const skipUrlRead = !!opts?.skipUrlRead;
    const skipRender = !!opts?.skipRender;
    const authoritativeHat = data.holderAccessToken || null;
    contacts = (data.contacts || []).map((c) => ({
      id: c.id,
      name: c.name,
      phone: c.phone || "",
      employeeId: c.employeeId || null,
      team: c.team || null,
      kind: c.kind ?? (data.lkMode ? "user" : c.employeeId ? "user" : "external"),
    }));
    orders = (data.orders || []).map((o) => {
      const copy = { ...o, timeline: [...(o.timeline || [])] };
      clearMessengerPortalCache(copy);
      if (!data.lkMode && Sc()?.migrateOrderFields) Sc().migrateOrderFields(copy);
      if (!copy.activeInvitation && copy.pendingId) syncInvitation(copy);
      if (copy.attachments && copy.attachments.length) {
        copy.attachments = copy.attachments.map((a) => {
          const extUrl =
            data.externalPerson && window.TanTrackerExternal?.attachmentUrl
              ? window.TanTrackerExternal.attachmentUrl(copy.id, a.id, true)
              : null;
          const extDl =
            data.externalPerson && window.TanTrackerExternal?.attachmentUrl
              ? window.TanTrackerExternal.attachmentUrl(copy.id, a.id, false)
              : null;
          const previewUrl =
            extUrl ||
            (Att()?.lkAttachmentThumbUrl
              ? Att().lkAttachmentThumbUrl(copy.id, a.id)
              : `/api/tan-tracker/transfers/${encodeURIComponent(copy.id)}/attachments/${encodeURIComponent(a.id)}?preview=thumb`);
          const downloadUrl =
            extDl ||
            (Att()?.lkAttachmentDownloadUrl
              ? Att().lkAttachmentDownloadUrl(copy.id, a.id)
              : `/api/tan-tracker/transfers/${encodeURIComponent(copy.id)}/attachments/${encodeURIComponent(a.id)}?download=1`);
          return {
            id: a.id,
            name: a.name,
            mime: a.mimeType || a.mime,
            size: a.byteSize || a.size,
            addedAt: a.addedAt,
            addedBy: a.addedBy,
            url: previewUrl,
            downloadUrl,
          };
        });
      } else {
        copy.attachments = copy.attachments || [];
      }
      applyPublicAttachmentUrls(copy);
      return copy;
    });
    if (opts?.preserveCode) {
      const target = orders.find((x) => x.id === opts.preserveCode.transferId);
      if (target) {
        target.code = {
          ...opts.preserveCode.code,
          forContact: target.pendingId,
        };
        state.codeDemoRevealed = true;
      }
    }
    state.userTestEnvironmentBanner = data.userTestEnvironmentBanner || null;
    applyLkCapabilitiesFromBootstrap(data);
    enforceReadOnlyRouteGuards();
    state.ttPrototypeRole = data.prototypeRole || "manager";
    state.ttRoleUnsupported = false;
    state.lkActorPartyId = data.actorPartyId || null;
    state.lkLinkedEmployeeId = data.linkedEmployeeId || null;
    state.externalMessengerEnabled = !!data.externalMessengerEnabled;
    if (data.publicHolder || data.publicRecipient || data.externalPerson) {
      state.actingContactId = data.actorContact?.id || data.actorPartyId || null;
    } else if (data.lkMode) {
      state.actingContactId = null;
    } else {
      state.actingContactId = data.actorContact?.id || data.actorPartyId || null;
    }
    if (data.externalPerson) {
      window.__TT_EXTERNAL_PERSON__ = true;
      window.__TT_EXTERNAL_CAP__ = data.capability || window.__TT_EXTERNAL_CAP__ || "";
      state.historicalSummaries = data.historicalSummaries || [];
      rebuildHolderAccessTokenMap(data);
      syncPublicHolderAccessTokenForOrder(state.orderId);
    }
    if (data.publicHolder || (data.externalPerson && (data.holderAccessToken || data.publicHolder))) {
      if (!data.externalPerson || !Object.keys(state.holderAccessTokensByOrderId).length) {
        state.publicHolderAccessToken =
          authoritativeHat || data.holderAccessToken || state.publicHolderAccessToken || "";
      }
      if (data.publicHolder) state.orderId = data.orders?.[0]?.id || state.orderId;
      window.__TT_PUBLIC_HOLDER__ = !!state.publicHolderAccessToken;
    }
    if (data.lkMode && data.externalPerson) {
      state.lkCanWrite = data.capabilities?.canWrite !== false;
    }
    if (!skipUrlRead) {
      if (window.__TT_PUBLIC_RECIPIENT__) {
        readUrl();
        if (authoritativeHat) state.publicHolderAccessToken = authoritativeHat;
      } else {
        state.recipientMode = false;
      }
    }
    if (window.__TT_PUBLIC_INVITATION_TOKEN__) {
      state.publicInvitationToken = window.__TT_PUBLIC_INVITATION_TOKEN__;
      delete window.__TT_PUBLIC_INVITATION_TOKEN__;
    }
    if (window.__TT_PUBLIC_RECEIPT__) {
      state.publicReceipt = window.__TT_PUBLIC_RECEIPT__;
      state.orderId = state.publicReceipt.publicCode || state.orderId;
      state.view = "public-receipt";
      delete window.__TT_PUBLIC_RECEIPT__;
    }
    bumpAttachOpGen();
    if (!skipRender) renderTracker();
  }

  window.TanTrackerPrototype = {
    orders: () => orders,
    contacts: () => contacts,
    state,
    employeeId: () => state.employeeId,
    effectiveProfile,
    hydrateFromServer,
    applyLkCapabilitiesFromBootstrap,
    lkMutationAllowed,
    lkAuthenticatedCabinet,
    enforceReadOnlyRouteGuards,
    canViewOrder: (orderId) => {
      const o = orders.find((x) => x.id === orderId);
      return o && orderVisible(o);
    },
    registryCardHtml: (o, actor) => registryCardHtml(o, actor),
    registryGroupOrders: (rows, actor) => registryGroupOrders(rows, actor),
    writeUrl,
    syncPublicHolderAccessTokenForOrder,
    seed: () => {
      seedContacts();
      seedOrders();
    },
    routeActive: () => current === ROUTE,
  };

  window.__ttLkRenderTracker = function () {
    if (current === ROUTE) renderTracker();
  };

  syncShellNav();
})();
