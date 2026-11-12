(function () {
  "use strict";
  var api = window.TandoorRf;
  if (!api) return;
  var enc = function (v) {
    return String(v == null ? "" : v).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  };
  function isPreview() {
    var shell = window.ClientsShell;
    return Boolean(shell && shell.getPreviewState && shell.getPreviewState().active);
  }
  var style = document.createElement("link");
  style.rel = "stylesheet";
  style.href = "/messenger-notification-settings.css?v=1";
  document.head.appendChild(style);

  window.mountMessengerNotificationSettings = function (root) {
    if (!root || root.refreshMessengerSettings) return;
    var channels = ["max", "telegram"];
    var names = { max: "MAX", telegram: "Telegram" };
    var states = { max: {}, telegram: {} };
    var sequences = { max: 0, telegram: 0 };
    var scope = "messenger-" + Math.random().toString(36).slice(2);
    root.classList.add("mn-settings");

    function draw() {
      var focused = document.activeElement;
      var focusedId = root.contains(focused) ? focused.id : "";
      root.innerHTML = '<h3>Уведомления в мессенджерах</h3>' +
        (isPreview()
          ? '<p class="mn-hint">В режиме «Войти как» статус привязки недоступен. Сотрудник подключает MAX и Telegram из своей учётной записи. Изменения здесь запрещены.</p>'
          : '<p class="mn-hint">Подключение включает коды и уведомления Тан-трекера. Уведомления о новых передачах можно выключить отдельно.</p>' +
            channels.map(function (channel) {
              var s = states[channel], d = s.data, name = names[channel], id = scope + "-" + channel;
              var status = !d ? "Проверяем подключение…" : !d.integrationEnabled ? "Канал временно недоступен" :
                d.linked ? "Подключён · уведомления " + (d.notificationsEnabled ? "включены" : "выключены") : s.link ? "Ожидает подтверждения в боте" : "Не подключён";
              return '<div class="mn-channel"><div class="mn-line"><strong>' + name + '</strong>' +
                '<span class="mn-status" role="status">' + (s.error ? "Не удалось проверить или сохранить настройку" : status) + '</span></div>' +
                (s.error ? '<p class="mn-error" role="alert">' + enc(s.error) + '</p><button id="' + id + '-retry" type="button" data-mn="retry" data-channel="' + channel + '">Повторить</button>' : "") +
                (!s.error && d && d.integrationEnabled
                  ? d.linked
                    ? '<label class="mn-toggle"><input id="' + id + '-toggle" type="checkbox" data-mn="toggle" data-channel="' + channel + '"' +
                      ((s.pendingEnabled === undefined ? d.notificationsEnabled : s.pendingEnabled) ? " checked" : "") + (s.busy ? " disabled" : "") + '>Уведомления о новых передачах в ' + name + '</label>'
                    : '<button id="' + id + '-connect" type="button" data-mn="connect" data-channel="' + channel + '"' + (s.busy ? " disabled" : "") + '>' + (s.link ? "Обновить ссылку " : "Подключить ") + name + '</button>'
                  : "") +
                (s.link && !s.error
                  ? '<p class="mn-hint">Откройте бота и нажмите «Начать» / Start. После возвращения статус обновится.</p><a href="' + enc(s.link) + '" target="_blank" rel="noopener noreferrer">Открыть ' + name + '</a>'
                  : "") + '</div>';
            }).join(""));
      if (focusedId) {
        var replacement = document.getElementById(focusedId);
        if (replacement && !replacement.disabled) replacement.focus({ preventScroll: true });
      }
    }

    async function load(channel) {
      if (isPreview()) { draw(); return; }
      var s = states[channel];
      if (s.busy) return;
      var sequence = ++sequences[channel];
      try {
        var r = await api.apiRequest("/api/profile/tanbot/" + channel);
        if (sequence !== sequences[channel]) return;
        if (isPreview()) { draw(); return; }
        if (r.response.status !== 200 || !r.data) {
          throw Error(api.extractErrorMessage(r.data, "Не удалось загрузить настройки. Повторите попытку."));
        }
        s.data = r.data;
        s.error = "";
        if (s.data.linked || !s.data.integrationEnabled) s.link = "";
      } catch (err) {
        if (sequence !== sequences[channel]) return;
        s.error = err.message || "Не удалось загрузить настройки.";
      }
      draw();
    }

    root.refreshMessengerSettings = function () {
      if (isPreview()) { draw(); return; }
      channels.forEach(function (channel) { void load(channel); });
    };
    root.addEventListener("click", async function (event) {
      var button = event.target.closest("button[data-mn]");
      if (!button || !root.contains(button) || isPreview()) return;
      var channel = button.dataset.channel, s = states[channel];
      if (!s || s.busy) return;
      if (button.dataset.mn === "retry") { void load(channel); return; }
      if (!s.data || !s.data.integrationEnabled || s.data.linked) return;
      s.busy = true;
      s.error = "";
      ++sequences[channel];
      draw();
      try {
        var r = await api.apiRequest("/api/profile/tanbot/" + channel + "/link/start", { method: "POST", body: {} });
        if (isPreview()) { s.link = ""; return; }
        if (r.response.status !== 200 || !r.data || !r.data.deepLink) {
          throw Error(api.extractErrorMessage(r.data, "Не удалось начать подключение."));
        }
        var link = new URL(r.data.deepLink);
        var allowedHost = channel === "max" ? "max.ru" : "t.me";
        if (link.protocol !== "https:" || link.hostname !== allowedHost || link.username || link.password || link.port) {
          throw Error("Получена некорректная ссылка подключения.");
        }
        s.link = link.href;
      } catch (err) {
        s.error = err.message || "Не удалось начать подключение.";
      } finally {
        s.busy = false;
        draw();
      }
    });
    root.addEventListener("change", async function (event) {
      var toggle = event.target.closest('input[data-mn="toggle"]');
      if (!toggle || !root.contains(toggle) || isPreview()) return;
      var channel = toggle.dataset.channel, s = states[channel];
      if (!s || s.busy || !s.data || !s.data.linked || !s.data.integrationEnabled) return;
      var enabled = toggle.checked;
      var saved = false;
      s.busy = true;
      s.pendingEnabled = enabled;
      ++sequences[channel];
      draw();
      try {
        var r = await api.apiRequest("/api/profile/tanbot/" + channel + "/notifications", { method: "POST", body: { enabled: enabled } });
        if (r.response.status !== 200) throw Error(api.extractErrorMessage(r.data, "Не удалось сохранить настройку."));
        s.data.notificationsEnabled = enabled;
        s.error = "";
        saved = true;
      } catch (err) {
        s.error = err.message || "Не удалось сохранить настройку.";
      } finally {
        s.busy = false;
        delete s.pendingEnabled;
        draw();
        if (saved) window.dispatchEvent(new Event("tandoor:messenger-notifications-refresh"));
      }
    });
    function refreshVisible() {
      if (document.visibilityState !== "hidden" && root.getClientRects().length) root.refreshMessengerSettings();
    }
    window.addEventListener("focus", refreshVisible);
    window.addEventListener("pageshow", refreshVisible);
    window.addEventListener("tandoor:messenger-notifications-refresh", refreshVisible);
    document.addEventListener("visibilitychange", refreshVisible);
    draw();
  };

  // Roles without an assignments inbox still need the same topbar entry point.
  window.mountMessengerNotificationBell = function (host) {
    if (!host || host.dataset.mounted) return;
    host.dataset.mounted = "true";
    host.hidden = false;
    host.innerHTML = '<button type="button" class="mn-bell" aria-label="Уведомления" aria-expanded="false" aria-controls="mn-inbox">' +
      '<svg aria-hidden="true" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"><path d="M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9M10 21h4"/></svg></button>' +
      '<dialog class="mn-inbox" id="mn-inbox" aria-label="Уведомления"><header><h2>Уведомления</h2><button type="button">Закрыть</button></header><div data-messenger-settings></div></dialog>';
    var bell = host.querySelector(".mn-bell"), panel = host.querySelector("dialog"), settings = host.querySelector("[data-messenger-settings]");
    window.mountMessengerNotificationSettings(settings);
    bell.addEventListener("click", function () {
      panel.showModal();
      bell.setAttribute("aria-expanded", "true");
      settings.refreshMessengerSettings();
    });
    panel.querySelector("header button").addEventListener("click", function () { panel.close(); });
    panel.addEventListener("close", function () { bell.setAttribute("aria-expanded", "false"); bell.focus(); });
    panel.addEventListener("click", function (event) {
      if (event.target !== panel) return;
      var r = panel.getBoundingClientRect();
      if (event.clientX < r.left || event.clientX > r.right || event.clientY < r.top || event.clientY > r.bottom) panel.close();
    });
  };
  window.dispatchEvent(new Event("tandoor:messenger-settings-ready"));
})();
