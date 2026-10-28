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

  const ttNotes = [];
  let ttNoteSeq = 0;

  function prototypeRoleKey() {
    return typeof prototypeRole === "string" ? prototypeRole : "manager";
  }

  function teamOfEmployee(empId, employees) {
    return employees?.[empId]?.team || null;
  }

  function employeeIdsInTeam(team) {
    return TEAMS[team] || [];
  }

  function orderParticipantIds(o) {
    const ids = new Set();
    if (o.createdById) ids.add(o.createdById);
    if (o.holderId) ids.add(o.holderId);
    if (o.pendingId) ids.add(o.pendingId);
    if (o.finalRecipientId) ids.add(o.finalRecipientId);
    (o.timeline || []).forEach((t) => {
      if (t.from) ids.add(t.from);
      if (t.to) ids.add(t.to);
    });
    return ids;
  }

  function contactEmployeeId(contact, contacts) {
    const c = contacts.find((x) => x.id === contact);
    return c?.employeeId || null;
  }

  function canViewOrder(o, ctx) {
    if (!o || !ctx) return false;
    if (ctx.externalActing) {
      const allowed = [o.holderId, o.pendingId, o.finalRecipientId].filter(Boolean);
      return allowed.includes(ctx.actorContactId);
    }
    const role = ctx.prototypeRole || "manager";
    if (role === "director") return true;
    const participants = orderParticipantIds(o);
    if (participants.has(ctx.actorContactId)) return true;
    if (role === "rop" || role === "regional") {
      const team = teamOfEmployee(ctx.employeeId, ctx.employees);
      if (!team) return false;
      const teamEmp = new Set(employeeIdsInTeam(team));
      for (const cid of participants) {
        const eid = contactEmployeeId(cid, ctx.contacts);
        if (eid && teamEmp.has(eid)) return true;
      }
      return false;
    }
    return participants.has(ctx.actorContactId);
  }

  function pushNotification({ user, key, title, text, id, kind = "detail", at = Date.now() }) {
    const uid = user + ":" + key;
    if (ttNotes.some((n) => n.key === uid)) return;
    ttNotes.push({ key: uid, user, title, text, id, kind, at, read: false, seq: ++ttNoteSeq });
  }

  function drainNotifications() {
    const out = ttNotes.splice(0, ttNotes.length);
    return out;
  }

  function syncReminders(orders, ctx, contacts, fmtDue) {
    if (!ctx || ctx.externalActing) return;
    const actor = ctx.actorContactId;
    orders.forEach((o) => {
      if (!canViewOrder(o, ctx)) return;
      if (o.status === "completed") return;
      const fin = contacts.find((c) => c.id === o.finalRecipientId);
      const due = o.dueAt ? fmtDue(o.dueAt) : null;
      const duePhrase = due ? ` до ${due}` : "";
      if (o.holderId === actor && !o.pendingId && o.finalRecipientId && o.holderId !== o.finalRecipientId) {
        pushNotification({
          user: ctx.employeeId,
          key: "tt-hold:" + o.id,
          title: "Нужно передать дальше",
          text: `Передайте «${o.item}» ${fin?.name || "конечному получателю"}${duePhrase}.`,
          id: o.id,
          kind: "detail",
        });
      }
      if (o.pendingId === actor) {
        pushNotification({
          user: ctx.employeeId,
          key: "tt-pending:" + o.id,
          title: "Ожидает вашего получения",
          text: `Подтвердите получение «${o.item}»${duePhrase}.`,
          id: o.id,
          kind: "detail",
        });
      }
      if (o.dueAt && o.dueAt <= Date.now() + 86400000 && o.holderId === actor && o.status !== "completed") {
        const overdue = o.dueAt < Date.now();
        pushNotification({
          user: ctx.employeeId,
          key: "tt-due:" + o.id + ":" + (overdue ? "over" : "today"),
          title: overdue ? "Просрочена передача" : "Срок сегодня",
          text: `«${o.item}» · ${fin?.name || "получатель"}${due ? " · " + due : ""}.`,
          id: o.id,
          kind: "detail",
        });
      }
    });
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
    migrateOrderFields,
    orderParticipantIds,
    canViewOrder,
    syncReminders,
    pushNotification,
    drainNotifications,
    teamOfEmployee,
    employeeIdsInTeam,
    prototypeRoleKey,
  };

  window.TanTrackerNotifications = {
    drain: drainNotifications,
  };
})();
