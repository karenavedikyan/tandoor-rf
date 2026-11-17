(function () {
  "use strict";
  var root = document.getElementById("messenger-accounts");
  var dialog = document.getElementById("messenger-account-dialog");
  if (!root || !dialog) return;
  var user, states = {}, pending, timer, notice = "";
  var names = { max: "MAX", telegram: "Telegram" };
  var esc = function (value) {
    return String(value == null ? "" : value).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  };
  function api() { return window.TandoorRf; }
  // The existing shared API object also handles CSRF and same-origin requests.
  function request(path, body) {
    return api().apiRequest("/api/profile/tanbot/" + path, { method: "POST", body: body }).then(function (r) {
      if (r.response.status !== 200) throw new Error(api().extractErrorMessage(r.data, "Не удалось сохранить настройку."));
      return r.data;
    });
  }
  function refresh() { window.dispatchEvent(new Event("tandoor:messenger-notifications-refresh")); }
  function phone(value) {
    var d = String(value || "").replace(/\D/g, "");
    return d.length === 11 && /^[78]/.test(d) ? "+7" + d.slice(1) : d.length === 10 ? "+7" + d : "";
  }
  function accounts(channel) { return states[channel] && states[channel].accounts || []; }
  function row(channel, p, a) {
    var state = states[channel], caption = !state ? "Проверяем подключение…" :
      state.error ? "Не удалось проверить подключение" :
      !state.integrationEnabled ? "Мессенджер временно недоступен" : a ? "Подключён" : "Не подключён";
    var controls = a ? '<label class="ma-toggle"><span>Уведомления</span><input type="checkbox" data-ma="toggle" ' +
      'data-channel="' + channel + '" data-account="' + esc(a.accountId) + '" aria-label="Уведомления: ' +
      names[channel] + ", " + esc(p || "номер не указан") + '" ' + (a.notificationsEnabled ? "checked" : "") +
      (!state.integrationEnabled ? " disabled" : "") + '></label><button type="button" class="ma-link" data-ma="disconnect" data-channel="' + channel +
      '" data-account="' + esc(a.accountId) + '"' + (!state.integrationEnabled ? " disabled" : "") + '>Отключить</button>' :
      '<button type="button" class="secondary-button" data-ma="connect" data-channel="' + channel +
      '" data-phone="' + esc(p) + '" ' + (!state || state.error || !state.integrationEnabled ? "disabled" : "") +
      '>Подключить ' + names[channel] + "</button>";
    return '<div class="ma-account" data-testid="ma-' + channel + "-" + esc(p || a && a.accountId) + '">' +
      '<div class="ma-account-name"><strong>' + names[channel] + '</strong><span class="ma-muted">' +
      (a && a.username ? "@" + esc(a.username) : "Аккаунт сотрудника") + '</span></div><div>' +
      '<span class="ma-badge ' + (a ? "ma-connected" : "") + '">' + caption + "</span>" +
      (a && p ? '<span class="ma-muted">' + (a.phoneConfirmed ? "Номер подтверждён в боте" : "Номер выбран в ЛК") + "</span>" : "") +
      '</div><div class="ma-controls">' + controls + "</div></div>";
  }
  function render() {
    if (!user || !Object.keys(states).length) return;
    root.hidden = false;
    var ps = [phone(user.phone), phone(user.additionalPhone)].filter(function (p, i, arr) { return p && arr.indexOf(p) === i; });
    var enabled = ["max", "telegram"].reduce(function (n, c) {
      return n + accounts(c).filter(function (a) { return a.notificationsEnabled; }).length;
    }, 0);
    var legacy = [];
    ["max", "telegram"].forEach(function (c) {
      accounts(c).forEach(function (a) { if (ps.indexOf(a.phoneE164) < 0) legacy.push({ channel: c, account: a }); });
    });
    root.innerHTML = '<h2 id="ma-title" class="profile-section-title">Телефоны и боты</h2>' +
      '<p class="profile-muted">Оба номера ведут в один личный кабинет. Для каждого можно подключить свой MAX и Telegram.</p>' +
      '<div class="ma-routing"><strong>' + (["max", "telegram"].some(function (c) { return !states[c] || states[c].error; }) ?
        "Не все подключения проверены" : enabled ? "Аккаунтов с уведомлениями: " + enabled : "Уведомления только в ЛК") +
      '</strong><p>Уведомления и один общий код приёма отправляем во все включённые аккаунты MAX и Telegram. ' +
      'Сбой одного не блокирует остальные.</p></div>' +
      '<p class="ma-feedback" role="status">' + esc(notice) + "</p>" +
      (ps.length ? ps.map(function (p) {
        return '<section class="ma-phone"><header><span class="ma-muted">' +
          (p === phone(user.phone) ? "Основной номер" : "Дополнительный номер") + "</span><h3>" + esc(p) +
          "</h3></header>" + ["max", "telegram"].map(function (c) {
            return row(c, p, accounts(c).find(function (a) { return a.phoneE164 === p; }));
          }).join("") + "</section>";
      }).join("") : '<p class="profile-muted">Сначала сохраните номер телефона в профиле.</p>') +
      (legacy.length ? '<section class="ma-phone"><header><h3>Ранее подключённые аккаунты</h3>' +
        '<p class="ma-muted">Привязки сохранены. Номер для этих аккаунтов не указан или больше не входит в профиль. ' +
        'Чтобы указать текущий номер, нажмите «Подключить» у него и откройте ссылку в том же аккаунте бота.</p></header>' +
        legacy.map(function (a) { return row(a.channel, null, a.account); }).join("") + "</section>" : "") +
      '<p class="ma-muted">Второй аккаунт не заменяет первый. Сохранение телефона само по себе не подключает бота. ' +
      'Для проверки номера отправьте свой контакт кнопкой в боте. Успешные отправки не повторяются при повторе неуспешных.</p>' +
      (["max", "telegram"].some(function (c) { return states[c] && states[c].error; }) ?
        '<button type="button" class="secondary-button" data-ma="refresh">Повторить проверку подключений</button>' : "");
  }
  function showDialog(html) {
    dialog.innerHTML = html + '<p class="ma-dialog-error" role="alert"></p>';
    if (!dialog.open) dialog.showModal();
  }
  function close() {
    dialog.close();
    pending = null;
    window.clearTimeout(timer);
  }
  function error(err) {
    var el = dialog.open ? dialog.querySelector(".ma-dialog-error") : root.querySelector(".ma-feedback");
    if (el) el.textContent = err.message || "Нет связи. Обновите подключения и повторите.";
  }
  function poll() {
    window.clearTimeout(timer);
    if (!pending || !dialog.open || pending.expiresAt <= Date.now()) return;
    timer = window.setTimeout(function () { refresh(); poll(); }, 3000);
  }
  function connect(channel, p) {
    pending = { channel: channel, phone: p };
    showDialog('<h2 id="ma-dialog-title">Подключить ' + names[channel] + '</h2><p>Номер в вашем профиле: <strong>' +
      esc(p) + '</strong></p><p>Откройте бота именно в аккаунте для этого номера. Первый аккаунт останется подключён.</p>' +
      '<label class="ma-consent"><input id="ma-enable" type="checkbox" checked> Получать уведомления в этом аккаунте</label>' +
      '<div class="button-row"><button type="button" class="primary-button" data-ma="start">Получить ссылку</button>' +
      '<button type="button" class="secondary-button" data-ma="close">Отмена</button></div>');
  }
  root.addEventListener("change", function (e) {
    var el = e.target;
    if (el.dataset.ma !== "toggle") return;
    el.disabled = true;
    request(el.dataset.channel + "/notifications", { accountId: el.dataset.account, enabled: el.checked })
      .then(function () { notice = "Настройка этого аккаунта сохранена."; refresh(); })
      .catch(function (err) { el.checked = !el.checked; error(err); })
      .finally(function () { el.disabled = false; });
  });
  root.addEventListener("click", function (e) {
    var el = e.target.closest("[data-ma]");
    if (!el) return;
    if (el.dataset.ma === "refresh") refresh();
    if (el.dataset.ma === "connect") connect(el.dataset.channel, el.dataset.phone);
    if (el.dataset.ma === "disconnect") {
      pending = { channel: el.dataset.channel, accountId: el.dataset.account };
      showDialog('<h2 id="ma-dialog-title">Отключить аккаунт ' + names[pending.channel] +
        '?</h2><p>Уведомления перестанут приходить только в этот аккаунт. Остальные подключения сохранятся.</p>' +
        '<div class="button-row"><button type="button" class="primary-button" data-ma="confirm-disconnect">Отключить аккаунт</button>' +
        '<button type="button" class="secondary-button" data-ma="close">Оставить подключённым</button></div>');
    }
  });
  dialog.addEventListener("cancel", function () { pending = null; window.clearTimeout(timer); });
  dialog.addEventListener("click", function (e) {
    var el = e.target.closest("[data-ma]");
    if (!el) return;
    if (el.dataset.ma === "close") { close(); return; }
    if (el.dataset.ma === "refresh") { refresh(); return; }
    if (!pending) return;
    var action = pending;
    if (el.dataset.ma === "confirm-disconnect") {
      el.disabled = true;
      request(action.channel + "/disconnect", { accountId: action.accountId }).then(function () {
        notice = "Аккаунт отключён. Остальные подключения сохранены."; close(); refresh();
      }).catch(error).finally(function () { el.disabled = false; });
    }
    if (el.dataset.ma === "start") {
      el.disabled = true;
      request(action.channel + "/link/start", { phone: action.phone,
        enableNotifications: dialog.querySelector("#ma-enable").checked }).then(function (result) {
        // Ignore a late result if this dialog was closed or replaced.
        if (pending !== action || !dialog.open) return;
        var link = new URL(result.deepLink);
        if (link.protocol !== "https:" || link.hostname !== (action.channel === "max" ? "max.ru" : "t.me") ||
          link.username || link.password || link.port) throw new Error("Получена некорректная ссылка подключения.");
        var startToken = link.searchParams.get("start");
        if (!startToken || !/^[A-Za-z0-9_-]{1,128}$/.test(startToken)) throw new Error("Получена некорректная ссылка подключения.");
        action.expiresAt = new Date(result.expiresAt).getTime();
        // No request is made to the messenger by the page; user follows the short-lived link.
        showDialog('<h2 id="ma-dialog-title">Подтверждение в ' + names[action.channel] +
          '</h2><p>Номер в ЛК: <strong>' + esc(action.phone) +
          '</strong></p><p>Откройте бота и нажмите «Начать» (Start). После подключения статус здесь обновится.</p>' +
          '<a class="primary-button ma-open" href="' + esc(result.deepLink) +
          '" target="_blank" rel="noopener noreferrer">Открыть ' + names[action.channel] +
          '</a><label class="field ma-copy-field"><span>Если мессенджер на другом устройстве, скопируйте ссылку</span>' +
          '<input class="field__input" readonly value="' + esc(result.deepLink) + '" aria-label="Ссылка подключения"></label>' +
          '<label class="field ma-copy-field"><span>Если после «Начать» нет подтверждения с номером, скопируйте и отправьте эту команду в тот же чат бота. Никому её не пересылайте.</span>' +
          '<input class="field__input" readonly value="/start ' + esc(startToken) + '" aria-label="Команда подключения"></label>' +
          '<div class="button-row"><button type="button" class="secondary-button" data-ma="refresh">Проверить подключение</button>' +
          '<button type="button" class="secondary-button" data-ma="close">Закрыть</button></div>');
        poll();
      }).catch(error).finally(function () { el.disabled = false; });
    }
  });
  window.TandoorMessengerAccounts = {
    setUser: function (value) { user = value; render(); },
    fail: function (channel) { states[channel] = { error: true, accounts: [] }; render(); },
    update: function (channel, value) {
      states[channel] = value;
      if (pending && pending.channel === channel && pending.phone && value.accounts.some(function (a) {
        return a.phoneE164 === pending.phone;
      })) {
        close();
        notice = "Аккаунт подключён. Остальные привязки сохранены.";
      }
      render();
    },
  };
})();
