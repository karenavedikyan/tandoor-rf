(function () {
  "use strict";
  let data = null, view = "all", source = "all", creator = "", period = "all";
  let api = null, draftMode = "off", busy = false, message = "", generation = 0;
  const labels = { off: "Выключены", all: "Все новые треки", staff: "Только от сотрудников", external: "Только от внешних пользователей" };
  const E = value => String(value ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
  const fmt = n => Number(n || 0).toLocaleString("ru-RU");
  function hydrate(boot) {
    generation++;
    const next = boot?.adminOverview || null;
    if (!data || !next) { view = "all"; source = "all"; creator = ""; period = "all"; }
    data = next;
    draftMode = next?.notificationMode || "off";
    busy = false; message = "";
  }
  function isGeneral() { return !!data && view === "all"; }
  function filter(rows, actor) {
    if (!data) return rows;
    return rows.filter(o => {
      if (view === "mine") {
        const participants = [o.createdById, o.holderId, o.pendingId, o.finalRecipientId];
        for (const t of o.timeline || []) {
          if (["Назначен следующий получатель", "Ожидание передачи отменено"].includes(t.note)) continue;
          participants.push(t.from, t.to);
        }
        if (!actor || !participants.includes(actor)) return false;
      }
      if (source !== "all" && (o.fromExternal ? "external" : "staff") !== source) return false;
      if (creator && o.createdById !== creator) return false;
      if (period === "30" && (!o.createdAt || o.createdAt < Date.parse(data.daily[0].day + "T00:00:00+03:00"))) return false;
      return true;
    });
  }
  function select(name, options, selected, disabled) {
    return `<select data-tt-admin="${name}"${disabled ? " disabled" : ""}>${options.map(([value, label]) =>
      `<option value="${E(value)}"${selected === value ? " selected" : ""}>${E(label)}</option>`).join("")}</select>`;
  }
  function orderMeta(order) {
    if (!data) return "";
    const author = api.getContacts().find(c => c.id === order.createdById)?.name || "Автор недоступен";
    const created = order.createdAt ? new Intl.DateTimeFormat("ru-RU", {
      dateStyle: "short", timeStyle: "short", timeZone: "Europe/Moscow",
    }).format(order.createdAt) : "дата неизвестна";
    return `<span class="tt-admin-order-meta">Автор: ${E(author)} · ${order.fromExternal ? "внешний пользователь" : "сотрудник"} · Создан: ${E(created)} МСК</span>`;
  }
  function html() {
    if (!data) return "";
    const s = data.summary;
    const contacts = new Map(api.getContacts().map(c => [c.id, c.name]));
    const authors = [...new Set(api.getOrders().map(o => o.createdById).filter(Boolean))]
      .map(id => [id, contacts.get(id) || "Автор недоступен"]).sort((a, b) => a[1].localeCompare(b[1], "ru"));
    const difference = s.recent - s.previous;
    return `<section class="tt-admin-overview" aria-labelledby="tt-admin-title">
      <div class="tt-admin-heading"><div><h2 id="tt-admin-title">Общий реестр администратора</h2>
        <p>Все неудалённые треки от сотрудников и внешних пользователей. Общий вид включает архивы и лично скрытые передачи.</p></div>
        <button type="button" data-tt-admin="refresh"${busy ? " disabled" : ""}>Обновить</button></div>
      <div class="tt-admin-tabs" role="group" aria-label="Область реестра">
        <button type="button" data-tt-admin="view-all" aria-pressed="${view === "all"}">Общий реестр</button>
        <button type="button" data-tt-admin="view-mine" aria-pressed="${view === "mine"}">Мои передачи</button>
      </div>
      <div class="tt-admin-metrics">
        <div><strong>${fmt(s.total)}</strong><span>Создано всего</span></div>
        <div><strong>${fmt(s.recent)}</strong><span>Новых за 30 дней</span></div>
        <div><strong>${fmt(s.authors)}</strong><span>Авторов за 30 дней</span></div>
        <div><strong>${difference > 0 ? "+" : ""}${fmt(difference)}</strong><span>К предыдущим 30 дням</span></div>
      </div>
      <p class="tt-admin-note">За всё время: сотрудники ${fmt(s.staff)}, внешние ${fmt(s.external)}.
        Статистика считает создание трека один раз, включая архивные и удалённые записи, сохранённые в базе. Передача дальше не увеличивает счётчик. Дни по Москве.</p>
      <details class="tt-admin-dynamics"><summary>Динамика за 30 дней</summary>
        <div class="tt-admin-table-wrap"><table><caption>Новые треки по московским датам</caption>
          <thead><tr><th scope="col">Дата</th><th scope="col">Сотрудники</th><th scope="col">Внешние</th><th scope="col">Всего</th></tr></thead>
          <tbody>${data.daily.map(d => `<tr><th scope="row">${E(d.day.split("-").reverse().join("."))}</th><td>${fmt(d.staff)}</td><td>${fmt(d.external)}</td><td>${fmt(d.staff + d.external)}</td></tr>`).join("")}</tbody>
        </table></div>
      </details>
      <div class="tt-admin-filters">
        <label>Кто создал${select("source", [["all", "Все пользователи"], ["staff", "Сотрудники"], ["external", "Внешние пользователи"]], source)}</label>
        <label>Автор${select("creator", [["", "Все авторы"], ...authors], creator)}</label>
        <label>Когда создан${select("period", [["all", "За всё время"], ["30", "Последние 30 дней"]], period)}</label>
      </div>
      <p class="tt-admin-note">Найдено в выбранном реестре: ${fmt(filter(api.getOrders(), api.getActor()).length)}. Поиск и фильтры статуса ниже дополнительно уточняют список, но не меняют статистику и подписку.</p>
      <details class="tt-admin-settings"><summary>Уведомления администратора о новых треках</summary>
        <p>Текущий режим: <strong>${E(labels[data.notificationMode])}</strong>. Это отдельная подписка, она не меняет ваши личные уведомления по передачам.</p>
        <label>Какие новые треки сообщать${select("notification-mode", Object.entries(labels), draftMode, busy || data.readOnly)}</label>
        <button type="button" data-tt-admin="save"${busy || data.readOnly || draftMode === data.notificationMode ? " disabled" : ""}>${busy ? "Сохранение…" : "Сохранить уведомления"}</button>
        <p class="tt-admin-note">После включения только новые треки, без рассылки истории. Уведомления появляются в ЛК и подключённых MAX/Telegram с включёнными уведомлениями. При выключении ожидающие отправки отменяются. Уже отправленные сообщения не удаляются.</p>
        ${data.readOnly ? '<p class="tt-admin-note">В режиме просмотра настройка недоступна.</p>' : ""}
      </details>
      <p class="tt-admin-feedback" role="status" aria-live="polite">${E(message)}</p>
    </section>`;
  }
  function redraw(focus) {
    api?.render();
    if (focus) document.querySelector(`[data-tt-admin="${focus}"]`)?.focus({ preventScroll: true });
  }
  document.addEventListener("change", event => {
    if (!data) return;
    const name = event.target.getAttribute("data-tt-admin"), value = event.target.value;
    if (name === "source") { source = value; creator = ""; }
    else if (name === "creator") creator = value;
    else if (name === "period") period = value;
    else if (name === "notification-mode") {
      draftMode = value;
      const save = document.querySelector('[data-tt-admin="save"]');
      if (save) save.disabled = busy || data.readOnly || draftMode === data.notificationMode;
      return;
    } else return;
    redraw(name);
  });
  document.addEventListener("click", async event => {
    const button = event.target.closest("button[data-tt-admin]");
    if (!data || !button || button.disabled || busy) return;
    const action = button.getAttribute("data-tt-admin");
    if (action === "view-all" || action === "view-mine") {
      view = action === "view-all" ? "all" : "mine";
      source = "all"; creator = ""; period = "all";
      api.resetPersonalFilters();
      redraw(action); return;
    }
    if (action !== "save" && action !== "refresh") return;
    if (action === "save" && data.readOnly) return;
    const currentGeneration = generation, mode = draftMode;
    busy = true; message = ""; redraw();
    document.querySelector(".tt-admin-settings")?.setAttribute("open", "");
    const controller = new AbortController(), timer = setTimeout(() => controller.abort(), 20000);
    try {
      const result = await window.TandoorRf.apiRequest(action === "save"
        ? "/api/tan-tracker/admin/track-notifications" : "/api/tan-tracker/bootstrap",
      action === "save" ? { method: "PATCH", body: { mode }, signal: controller.signal } : { signal: controller.signal });
      if (currentGeneration !== generation) return;
      if (result.response.status !== 200) throw new Error(window.TandoorRf.extractErrorMessage(result.data, "Не удалось сохранить настройку."));
      if (action === "refresh") {
        window.__TT_LK_BOOTSTRAP__ = result.data;
        window.TanTrackerPrototype.hydrateFromServer(result.data);
      } else {
        data.notificationMode = result.data.notificationMode;
        draftMode = data.notificationMode;
        message = "Настройка сохранена. Старые треки повторно не рассылаются.";
      }
    } catch (error) {
      if (currentGeneration === generation) message = error.name === "AbortError" ? "Не удалось дождаться ответа. Обновите страницу и проверьте настройку." : error.message;
    } finally {
      clearTimeout(timer);
      if (currentGeneration === generation) {
        busy = false; redraw();
        document.querySelector(".tt-admin-settings")?.setAttribute("open", "");
        document.querySelector(`[data-tt-admin="${action === "save" ? "notification-mode" : "refresh"}"]`)?.focus({ preventScroll: true });
      }
    }
  });
  window.TanTrackerAdmin = { attach: input => { api = input; }, hydrate, html, filter, isGeneral, orderMeta,
    resetFilters: () => { source = "all"; creator = ""; period = "all"; } };
})();
