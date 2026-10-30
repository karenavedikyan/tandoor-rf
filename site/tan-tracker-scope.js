(function () {
  "use strict";

  const TEAMS = {
    volkova: ["m1", "a1", "c1", "r1"],
    orlov: ["m2", "m3", "r2"],
  };

  const ROLE_EMPLOYEE = {
    director: "d1",
    rop: "r1",
    regional: "r1",
    manager: "m1",
    assistant: "a1",
    coordinator: "c1",
  };

  const EMPLOYEE_PROTOTYPE_ROLE = {
    d1: "director",
    r1: "rop",
    r2: "rop",
    m1: "manager",
    m2: "manager",
    m3: "manager",
    a1: "assistant",
    c1: "coordinator",
  };

  const DEMO_ROLE_LABEL = {
    director: "Директор",
    rop: "РОП",
    manager: "Менеджер",
    assistant: "Ассистент",
    coordinator: "Координатор",
  };

  const TT_SUPPORTED_ROLES = new Set(Object.keys(ROLE_EMPLOYEE));

  function effectiveRoleForEmployee(empId) {
    return EMPLOYEE_PROTOTYPE_ROLE[empId] || "manager";
  }

  function employeeDemoOptionLabel(empId, employees) {
    const e = employees?.[empId];
    if (!e) return empId;
    const role = effectiveRoleForEmployee(empId);
    const roleLabel = DEMO_ROLE_LABEL[role] || role;
    return `${e.name} · ${roleLabel}`;
  }

  function normalizeTanTrackerRole(raw) {
    if (!raw) return null;
    if (raw === "assistant_lead") return "coordinator";
    return raw;
  }

  /** Tan-tracker only: do not inherit global roleProfiles / default director. */
  function resolveTanTrackerRole(params) {
    const rawRole = params.get("role") || params.get("as_role");
    const explicit = params.has("role") || params.has("as_role");
    const role = normalizeTanTrackerRole(rawRole);
    if (explicit) {
      if (!role || !TT_SUPPORTED_ROLES.has(role)) {
        return { unsupported: true, requested: rawRole || "", role: null, person: null, explicit: true };
      }
      return {
        unsupported: false,
        role,
        person: params.get("as_person") || null,
        explicit: true,
        requested: rawRole || "",
      };
    }
    return { unsupported: false, role: "manager", person: null, explicit: false, requested: "" };
  }

  /** @type {Record<string, Map<string, { key: string, title: string, text: string, orderId: string, read: boolean }>>} */
  const inboxByEmployee = {};

  function prototypeRoleKey(ttRole) {
    if (typeof ttRole === "string" && TT_SUPPORTED_ROLES.has(ttRole)) return ttRole;
    return "manager";
  }

  function teamOfEmployee(empId, employees) {
    return employees?.[empId]?.team || null;
  }

  function employeeIdsInTeam(team) {
    return TEAMS[team] || [];
  }

  const TIMELINE_AUDIT_NOTES = new Set([
    "Назначен следующий получатель",
    "Ожидание передачи отменено",
  ]);

  /** Contacts with confirmed custody or active role — not unconfirmed pending assignments. */
  function orderParticipantIds(o) {
    const ids = new Set();
    if (o.createdById) ids.add(o.createdById);
    if (o.holderId) ids.add(o.holderId);
    if (o.pendingId) ids.add(o.pendingId);
    if (o.finalRecipientId) ids.add(o.finalRecipientId);
    (o.timeline || []).forEach((t) => {
      if (TIMELINE_AUDIT_NOTES.has(t.note)) return;
      if (t.from) ids.add(t.from);
      if (t.to) ids.add(t.to);
    });
    return ids;
  }

  function contactEmployeeId(contactId, contacts) {
    const c = contacts.find((x) => x.id === contactId);
    return c?.employeeId || null;
  }

  function moscowYmd(ts) {
    return new Intl.DateTimeFormat("en-CA", {
      timeZone: "Europe/Moscow",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(new Date(ts));
  }

  function dueUrgencyLabel(dueAt, now = Date.now()) {
    if (!dueAt || dueAt < now) return dueAt < now ? "over" : null;
    if (moscowYmd(dueAt) === moscowYmd(now)) return "today";
    if (dueAt <= now + 86400000) return "soon";
    return null;
  }

  function canViewOrder(o, ctx) {
    if (!o || !ctx || !ctx.prototypeRole) return false;
    if (ctx.externalActing) {
      const allowed = [o.holderId, o.pendingId, o.finalRecipientId].filter(Boolean);
      return allowed.includes(ctx.actorContactId);
    }
    const role = ctx.prototypeRole || "manager";
    const actor = ctx.actorContactId;
    if (role === "director") return true;
    if (actor && [o.holderId, o.pendingId, o.finalRecipientId].includes(actor)) return true;
    const participants = orderParticipantIds(o);
    if (participants.has(actor)) return true;
    if (role === "rop" || role === "regional") {
      const team = teamOfEmployee(ctx.employeeId, ctx.employees);
      if (team) {
        const teamEmp = new Set(employeeIdsInTeam(team));
        for (const cid of participants) {
          const eid = contactEmployeeId(cid, ctx.contacts);
          if (eid && teamEmp.has(eid)) return true;
        }
      }
    }
    if ((o.revokedParticipants || []).includes(actor)) return false;
    return false;
  }

  function reconcileEmployeeInbox(employeeId, items) {
    const prev = inboxByEmployee[employeeId] || new Map();
    const next = new Map();
    items.forEach((item) => {
      const old = prev.get(item.key);
      next.set(item.key, {
        key: item.key,
        title: item.title,
        text: item.text,
        orderId: item.orderId,
        at: item.at,
        messengerText: item.messengerText || null,
        read: old?.read && old.orderId === item.orderId ? old.read : false,
      });
    });
    inboxByEmployee[employeeId] = next;
  }

  function contactName(contacts, id) {
    return contacts.find((c) => c.id === id)?.name || "—";
  }

  function pendingIsExternalOrder(o, contacts) {
    if (!o?.pendingId) return false;
    return contacts.find((c) => c.id === o.pendingId)?.kind === "external";
  }

  function orderIsCompleted(o) {
    return o?.status === "completed";
  }

  function isConfirmedHandoffNote(note) {
    return /Подтверждено (одноразовым кодом|по QR)/.test(note || "");
  }

  function isAssignPendingNote(note) {
    return (
      note === "Назначен следующий получатель" ||
      note === "Возврат" ||
      note === "Продолжение после доставки" ||
      /^Изменён получатель/.test(note || "")
    );
  }

  function isCancelPendingNote(note) {
    return note === "Ожидание передачи отменено";
  }

  function dueTail(o, fmtDue) {
    const due = o.dueAt ? fmtDue(o.dueAt) : null;
    return due ? ` до ${due}` : "";
  }

  function eventItem(o, key, title, text, at) {
    return {
      key,
      title,
      text,
      orderId: o.id,
      at,
      messengerText: `Тан-трекер · ${o.id}\n${text}`,
    };
  }

  function pushStaffEvent(byUser, employeeId, item, seen) {
    if (!employeeId) return;
    const dedupe = `${employeeId}:${item.key}`;
    if (seen.has(dedupe)) return;
    seen.add(dedupe);
    (byUser[employeeId] ||= []).push(item);
  }

  function syncHandoffEvents(orders, contacts, fmtDue) {
    const byUser = {};
    const seen = new Set();

    (orders || []).forEach((o) => {
      const timeline = o.timeline || [];
      timeline.forEach((t, ti) => {
        const at = t.at;
        const fromName = contactName(contacts, t.from);
        const toName = contactName(contacts, t.to);

        if (isAssignPendingNote(t.note)) {
          const prevAssign = timeline
            .slice(0, ti)
            .reverse()
            .find((x) => isAssignPendingNote(x.note));
          if (prevAssign && prevAssign.to !== t.to) {
            const prevEmp = contactEmployeeId(prevAssign.to, contacts);
            const cancelText = `«${o.item}» вам отменена: ${fromName} выбрал другого получателя. Код и QR недействительны.`;
            pushStaffEvent(
              byUser,
              prevEmp,
              eventItem(o, `tt-ev:${o.id}:${ti}:cancel:recipient`, "Передача отменена", cancelText, at),
              seen
            );
          }
          const duePhrase = dueTail(o, fmtDue);
          const fromExt = o.fromExternal && contacts.find((c) => c.id === t.from)?.kind === "external";
          const recvTitle = fromExt ? "Вам передают от клиента" : "Вам передают";
          const recvText = `«${o.item}». ${fromName} передаст вам предмет${duePhrase}. При встрече подтвердите получение: назовите код из SMS или покажите QR.`;
          const sendText = `«${o.item}» направлена ${toName}. Вы остаётесь ответственным, пока получатель не подтвердит получение кодом или QR.`;
          pushStaffEvent(
            byUser,
            contactEmployeeId(t.to, contacts),
            eventItem(o, `tt-ev:${o.id}:${ti}:assign:recipient`, recvTitle, recvText, at),
            seen
          );
          pushStaffEvent(
            byUser,
            contactEmployeeId(t.from, contacts),
            eventItem(o, `tt-ev:${o.id}:${ti}:assign:sender`, "Передача направлена", sendText, at),
            seen
          );
        }

        if (isCancelPendingNote(t.note)) {
          const cancelText = `«${o.item}» вам отменена: ${fromName} выбрал другого получателя. Код и QR недействительны.`;
          pushStaffEvent(
            byUser,
            contactEmployeeId(t.to, contacts),
            eventItem(o, `tt-ev:${o.id}:${ti}:cancel:recipient`, "Передача отменена", cancelText, at),
            seen
          );
        }

        if (isConfirmedHandoffNote(t.note)) {
          const finName = contactName(contacts, o.finalRecipientId);
          const due = o.dueAt ? fmtDue(o.dueAt) : null;
          const intermediate = !!(o.finalRecipientId && t.to !== o.finalRecipientId);
          const toFinal = !!(o.finalRecipientId && t.to === o.finalRecipientId);
          const holderText = intermediate
            ? `«${o.item}» у вас. Передайте дальше: ${finName}, срок до ${due || "срок не указан"}.`
            : toFinal
              ? `«${o.item}» у вас. Передача дошла до вас. Если предмет нужно передать дальше или вернуть — нажмите «Передать дальше».`
              : `«${o.item}» у вас. Передача ${o.id} завершена, делать ничего не нужно.`;
          pushStaffEvent(
            byUser,
            contactEmployeeId(t.to, contacts),
            eventItem(o, `tt-ev:${o.id}:${ti}:confirm:recipient`, "Предмет у вас", holderText, at),
            seen
          );
          if (toFinal && o.createdById && o.createdById !== t.from && o.createdById !== t.to) {
            const creatorEmp = contactEmployeeId(o.createdById, contacts);
            const holderName = contactName(contacts, t.to);
            pushStaffEvent(
              byUser,
              creatorEmp,
              eventItem(
                o,
                `tt-ev:${o.id}:${ti}:confirm:creator-delivered`,
                "Доставлено",
                `Доставлено: «${o.item}» у ${holderName}.`,
                at
              ),
              seen
            );
          }
          const formerText = `${toName} подтвердил получение «${o.item}». Вы больше не ответственны за предмет.`;
          pushStaffEvent(
            byUser,
            contactEmployeeId(t.from, contacts),
            eventItem(o, `tt-ev:${o.id}:${ti}:confirm:sender`, "Получение подтверждено", formerText, at),
            seen
          );
          const creatorId = o.createdById;
          if (intermediate && creatorId && creatorId !== t.from && creatorId !== t.to) {
            const creatorEmp = contactEmployeeId(creatorId, contacts);
            const creatorText = `«${o.item}» теперь у ${toName}. Следующий: ${finName}.`;
            pushStaffEvent(
              byUser,
              creatorEmp,
              eventItem(o, `tt-ev:${o.id}:${ti}:confirm:creator`, "Предмет передан дальше", creatorText, at),
              seen
            );
          }
        }
      });

      if (orderIsCompleted(o)) {
        const finHolder = o.holderId;
        const finName = contactName(contacts, finHolder);
        const completeAt =
          timeline
            .slice()
            .reverse()
            .find((t) => t.note === "Передача завершена" || t.note === "Передача явно завершена")?.at ||
          o.holderSince ||
          Date.now();
        const completeText = `Передача ${o.id} завершена: «${o.item}» остаётся у ${finName}.`;
        const lastConfirm = timeline.filter((t) => isConfirmedHandoffNote(t.note)).pop();
        const formerId = lastConfirm?.from;
        const completeRoles = new Map();
        const creatorEmp = contactEmployeeId(o.createdById, contacts);
        if (creatorEmp && o.createdById !== finHolder) completeRoles.set(creatorEmp, "creator");
        const formerEmp = contactEmployeeId(formerId, contacts);
        if (formerEmp && formerId !== finHolder && !completeRoles.has(formerEmp)) {
          completeRoles.set(formerEmp, "former");
        }
        completeRoles.forEach((role, emp) => {
          pushStaffEvent(
            byUser,
            emp,
            eventItem(o, `tt-ev:${o.id}:complete:${role}`, "Передача завершена", completeText, completeAt),
            seen
          );
        });
      }

      const code = o.code;
      const handoffVer = o.handoffVer ?? 0;
      if (
        code &&
        !code.used &&
        code.expiresAt > Date.now() &&
        code.attempts < 5 &&
        pendingIsExternalOrder(o, contacts) &&
        o.status !== "completed"
      ) {
        const pendingName = contactName(contacts, o.pendingId);
        const channel = code.channel === "max" ? "MAX" : "Telegram";
        const holderEmp = contactEmployeeId(o.holderId, contacts);
        const codeText = `${pendingName} подтвердил номер в ${channel} и получил код для «${o.item}». Введите код в Тан-трекере, чтобы завершить передачу.`;
        pushStaffEvent(
          byUser,
          holderEmp,
          eventItem(o, `tt-ev:${o.id}:code:${handoffVer}`, "Получатель получил код", codeText, code.issuedAt || Date.now()),
          seen
        );
      }
    });

    return byUser;
  }

  function syncReminders(orders, contacts, fmtDue) {
    const byUser = {};
    const push = (employeeId, item) => {
      if (!employeeId) return;
      (byUser[employeeId] ||= []).push(item);
    };

    (orders || []).forEach((o) => {
      if (o.status === "completed" || o.status === "delivered") return;
      const fin = contacts.find((c) => c.id === o.finalRecipientId);
      const due = o.dueAt ? fmtDue(o.dueAt) : null;
      const duePhrase = due ? ` до ${due}` : "";
      const holderEmp = contactEmployeeId(o.holderId, contacts);
      const pendingEmp = o.pendingId ? contactEmployeeId(o.pendingId, contacts) : null;

      if (holderEmp && o.finalRecipientId && o.holderId !== o.finalRecipientId) {
        const wait =
          o.pendingId && o.pendingId !== o.finalRecipientId
            ? " Следующий участник должен подтвердить получение по коду или QR — вы остаётесь ответственным до подтверждения."
            : "";
        push(holderEmp, {
          key: "tt-hold:" + o.id,
          title: "Нужно передать дальше",
          text: `Передайте «${o.item}» ${fin?.name || "конечному получателю"}${duePhrase}.${wait}`,
          orderId: o.id,
          at: Date.now(),
          messengerText: null,
        });
      }

      if (pendingEmp) {
        push(pendingEmp, {
          key: "tt-pending:" + o.id,
          title: "Ожидает вашего получения",
          text: `Подтвердите получение «${o.item}»${duePhrase}.`,
          orderId: o.id,
          at: Date.now(),
          messengerText: null,
        });
      }

      if (holderEmp && o.dueAt) {
        const now = Date.now();
        if (o.dueAt < now) {
          push(holderEmp, {
            key: "tt-due:" + o.id + ":over",
            title: "Просрочена передача",
            text: `«${o.item}» · ${fin?.name || "получатель"}${due ? " · " + due : ""}.`,
            orderId: o.id,
            at: Date.now(),
            messengerText: null,
          });
        } else {
          const urgency = dueUrgencyLabel(o.dueAt, now);
          if (urgency === "today" || urgency === "soon") {
            push(holderEmp, {
              key: "tt-due:" + o.id + ":" + urgency,
              title: urgency === "today" ? "Срок сегодня" : "Срок скоро",
              text: `«${o.item}» · ${fin?.name || "получатель"}${due ? " · " + due : ""}.`,
              orderId: o.id,
              at: Date.now(),
              messengerText: null,
            });
          }
        }
      }
    });

    const eventsByUser = syncHandoffEvents(orders, contacts, fmtDue);
    Object.keys(eventsByUser).forEach((employeeId) => {
      eventsByUser[employeeId].forEach((item) => {
        (byUser[employeeId] ||= []).push(item);
      });
    });

    const touched = new Set(Object.keys(byUser));
    Object.keys(inboxByEmployee).forEach((id) => touched.add(id));
    touched.forEach((employeeId) => reconcileEmployeeInbox(employeeId, byUser[employeeId] || []));
  }

  function forEmployee(employeeId) {
    const m = inboxByEmployee[employeeId];
    if (!m) return [];
    return [...m.values()];
  }

  function markRead(employeeId, key) {
    const m = inboxByEmployee[employeeId];
    const n = m?.get(key);
    if (n) n.read = true;
  }

  function migrateOrderFields(o) {
    if (!o.finalRecipientId) {
      o.finalRecipientId = o.pendingId || o.holderId;
    }
    if (!o.createdById) {
      o.createdById = o.timeline?.[0]?.from || o.holderId;
    }
    if (o.id === "TT-2026-002") {
      o.allowLegacyComplete = true;
      o.finalRecipientId = o.holderId;
    }
  }

  window.TanTrackerScope = {
    TEAMS,
    ROLE_EMPLOYEE,
    TT_SUPPORTED_ROLES,
    normalizeTanTrackerRole,
    resolveTanTrackerRole,
    migrateOrderFields,
    orderParticipantIds,
    canViewOrder,
    syncReminders,
    dueUrgencyLabel,
    teamOfEmployee,
    employeeIdsInTeam,
    prototypeRoleKey,
    contactEmployeeId,
    effectiveRoleForEmployee,
    employeeDemoOptionLabel,
    DEMO_ROLE_LABEL,
  };

  window.TanTrackerNotifications = {
    forEmployee,
    markRead,
  };
})();
