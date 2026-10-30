(function () {
  "use strict";

  var statePanel = document.getElementById("tt-state-panel");
  var portalUi = { data: null, showDetails: false, listenersBound: false };

  function showError(message) {
    if (!statePanel) return;
    statePanel.classList.remove("clients-hidden");
    statePanel.textContent = message;
  }

  function hideErrorPanel() {
    if (statePanel) statePanel.classList.add("clients-hidden");
  }

  function parseMstFromLocation() {
    var searchParams = new URLSearchParams(location.search || "");
    var fromSearch = searchParams.get("mst");
    if (fromSearch && fromSearch.trim()) return fromSearch.trim();
    var hash = location.hash || "";
    var q = hash.indexOf("?");
    if (q >= 0) {
      var fromHash = new URLSearchParams(hash.slice(q + 1)).get("mst");
      if (fromHash && fromHash.trim()) return fromHash.trim();
    }
    return "";
  }

  function parseInvitationFromLocation() {
    var hash = location.hash || "";
    var q = hash.indexOf("?");
    var params = new URLSearchParams(q >= 0 ? hash.slice(q + 1) : "");
    var search = new URLSearchParams(location.search || "");
    var token = params.get("tt_tok") || search.get("tt_tok") || "";
    var holderAccessToken = params.get("tt_hat") || search.get("tt_hat") || "";
    var orderId = params.get("tt_order") || params.get("tt_id") || search.get("tt_order") || "";
    var hv = params.get("tt_hv") || search.get("tt_hv") || "";
    var rcv = params.get("tt_rcv") || search.get("tt_rcv") || "";
    var via = params.get("tt_via") || search.get("tt_via") || "qr";
    return {
      token: token,
      holderAccessToken: holderAccessToken,
      orderId: orderId,
      hv: hv,
      rcv: rcv,
      via: via,
      params: params,
    };
  }

  function loadPublicContext(token) {
    var url =
      "/api/tan-tracker/public/recipient/context?invitationToken=" + encodeURIComponent(token);
    return fetch(url, { credentials: "same-origin", headers: { Accept: "application/json" } }).then(
      function (response) {
        return response.json().then(function (data) {
          if (!response.ok) {
            throw new Error(
              (data && data.error && data.error.message) || "Приглашение недоступно.",
            );
          }
          return data;
        });
      },
    );
  }

  function loadPublicReceipt(token) {
    var url =
      "/api/tan-tracker/public/recipient/receipt?invitationToken=" +
      encodeURIComponent(token) +
      "&refresh=1";
    return fetch(url, { credentials: "same-origin", headers: { Accept: "application/json" } }).then(
      function (response) {
        return response.json().then(function (data) {
          if (!response.ok) {
            throw new Error(
              (data && data.error && data.error.message) || "Результат получения недоступен.",
            );
          }
          return data;
        });
      },
    );
  }

  function applyPublicRoute(inv) {
    if (!window.TanTrackerPrototype) return;
    var p = inv.params;
    p.set("tt_view", "recipient");
    if (inv.orderId) p.set("tt_order", inv.orderId);
    if (inv.hv) p.set("tt_hv", inv.hv);
    if (inv.rcv) p.set("tt_rcv", inv.rcv);
    if (inv.via) p.set("tt_via", inv.via);
    if (inv.token) p.set("tt_tok", inv.token);
    location.hash = "tan-tracker?" + p.toString();
  }

  function whenTanTrackerReady(cb, attempt) {
    var n = attempt || 0;
    if (
      window.TanTrackerPrototype &&
      typeof window.TanTrackerPrototype.hydrateFromServer === "function"
    ) {
      cb();
      return;
    }
    if (n >= 80) {
      showError("Не удалось инициализировать интерфейс получения.");
      return;
    }
    setTimeout(function () {
      whenTanTrackerReady(cb, n + 1);
    }, 25);
  }

  function loadPublicHolderContext(holderAccessToken) {
    var url =
      "/api/tan-tracker/public/holder/context?holderAccessToken=" +
      encodeURIComponent(holderAccessToken);
    return fetch(url, { credentials: "same-origin", headers: { Accept: "application/json" } }).then(
      function (response) {
        return response.json().then(function (data) {
          if (!response.ok) {
            throw new Error(
              (data && data.error && data.error.message) || "Передача недоступна.",
            );
          }
          return data;
        });
      },
    );
  }

  function finishBootHolder(data, inv) {
    window.__TT_PUBLIC_RECIPIENT__ = true;
    window.__TT_PUBLIC_HOLDER__ = true;
    window.__TT_LK_BOOTSTRAP__ = data;
    var p = inv.params;
    p.set("tt_screen", "detail");
    var hat = data.holderAccessToken || inv.holderAccessToken;
    if (hat) p.set("tt_hat", hat);
    if (data.orders && data.orders[0]) p.set("tt_order", data.orders[0].id);
    location.hash = "tan-tracker?" + p.toString();
    whenTanTrackerReady(function () {
      window.TanTrackerPrototype.hydrateFromServer(data);
      if (window.TanTrackerPrototype.state) {
        window.TanTrackerPrototype.state.view = "detail";
        window.TanTrackerPrototype.state.publicHolderAccessToken = hat || "";
      }
      if (typeof window.__ttLkRenderTracker === "function") {
        window.__ttLkRenderTracker();
      }
    });
  }

  function finishBoot(data, inv) {
    window.__TT_PUBLIC_RECIPIENT__ = true;
    if (inv.token) {
      window.__TT_PUBLIC_INVITATION_TOKEN__ = inv.token;
    }
    if (data.publicReceipt && data.receipt) {
      window.__TT_PUBLIC_RECEIPT__ = data.receipt;
      window.__TT_LK_BOOTSTRAP__ = {
        lkMode: true,
        publicRecipient: true,
        appOrigin: data.appOrigin || null,
        actorPartyId: data.receipt.recipientPartyId,
        prototypeRole: "manager",
        contacts: [],
        orders: [],
        capabilities: { canWrite: false },
      };
    } else {
      window.__TT_LK_BOOTSTRAP__ = data;
    }
    if (!data.publicReceipt) {
      var screen = inv.params.get("tt_screen") || "";
      if (screen === "detail" || screen === "code") {
        var p = inv.params;
        p.delete("tt_view");
        if (inv.orderId) p.set("tt_order", inv.orderId);
        if (inv.token) p.set("tt_tok", inv.token);
        p.set("tt_screen", screen);
        location.hash = "tan-tracker?" + p.toString();
      } else {
        applyPublicRoute(inv);
      }
    }
    window.TanTrackerPrototype.hydrateFromServer(window.__TT_LK_BOOTSTRAP__);
    if (typeof window.__ttLkRenderTracker === "function") {
      window.__ttLkRenderTracker();
    }
  }

  function channelLabel(channel) {
    return channel === "max" ? "MAX" : "Telegram";
  }

  function escapeHtml(text) {
    return String(text)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function recipientBrandHeader() {
    return (
      '<header class="tt-recipient-brand" data-tt="recipient-brand">' +
      '<img class="tt-recipient-logo tt-recipient-logo-light" src="/brand/tandoor-logo-official.svg" alt="" width="128" height="36" decoding="async" data-legacy-logo-full />' +
      '<img class="tt-recipient-logo tt-recipient-logo-dark" src="/brand/tandoor-logo-light.svg" alt="" width="128" height="36" decoding="async" data-legacy-logo-full />' +
      '<span class="tt-recipient-brand-name">Тандор</span></header>'
    );
  }

  function welcomeAboutDisclosure() {
    return (
      '<details class="tt-disclosure tt-recipient-welcome-about" data-tt="recipient-welcome-about">' +
      '<summary><span class="tt-disclosure-title"><span class="tt-disclosure-title-text">Что это за ссылка?</span></span></summary>' +
      '<div class="tt-disclosure-body tt-recipient-welcome-about-body">' +
      "<p>Тандор помогает отследить передачу документа или предмета между людьми. Личный кабинет получателю не нужен.</p>" +
      "<p>Ссылка персональная — рассчитана на получателя. Подтверждение своего номера в боте помогает показать ваши передачи и выдать код получения.</p>" +
      "<p>Код получения сообщайте отправителю только после того, как предмет реально у вас.</p>" +
      "</div></details>"
    );
  }

  function transferKicker(data) {
    if (!data.transferPublicCode) return "";
    return (
      '<p class="tt-recipient-kicker">Передача ' + escapeHtml(data.transferPublicCode) + "</p>"
    );
  }

  function renderWelcomeInvalid(root, message) {
    hideErrorPanel();
    var copy = message || "Ссылка приглашения недействительна. Попросите отправителя прислать новую ссылку.";
    root.innerHTML =
      '<div class="tt-recipient-wrap"><article class="tt-recipient-card tt-recipient-card--welcome" data-tt="recipient-welcome-invalid">' +
      recipientBrandHeader() +
      '<h1 class="tt-recipient-welcome-heading">Приглашение недоступно</h1>' +
      '<p class="tt-recipient-welcome-lead">' +
      escapeHtml(copy) +
      "</p>" +
      welcomeAboutDisclosure() +
      "</article></div>";
    syncRecipientLogos();
  }

  function renderWelcome(root, data) {
    hideErrorPanel();
    var sender = data.senderDisplayName || "—";
    var item = data.itemTitle || "—";
    root.innerHTML =
      '<div class="tt-recipient-wrap"><article class="tt-recipient-card tt-recipient-card--welcome" data-tt="recipient-welcome">' +
      recipientBrandHeader() +
      transferKicker(data) +
      '<h1 class="tt-recipient-welcome-heading">Вам передают предмет</h1>' +
      '<dl class="tt-recipient-welcome-facts">' +
      "<div><dt>Отправитель</dt><dd>" +
      escapeHtml(sender) +
      "</dd></div>" +
      "<div><dt>Предмет</dt><dd>" +
      escapeHtml(item) +
      "</dd></div></dl>" +
      '<p class="tt-recipient-welcome-lead">Здесь можно посмотреть детали и подтвердить получение. Регистрация не нужна.</p>' +
      '<button type="button" class="tt-primary tt-btn-block tt-recipient-welcome-cta" data-tt="recipient-welcome-continue">Посмотреть передачу</button>' +
      welcomeAboutDisclosure() +
      "</article></div>";
    syncRecipientLogos();
    var cta = root.querySelector('[data-tt="recipient-welcome-continue"]');
    if (cta) cta.focus();
  }

  function renderMessengerDetails(root, data) {
    hideErrorPanel();
    var preamble =
      '<p class="tt-recipient-messenger-preamble" data-tt="recipient-messenger-preamble" tabindex="-1">Бот Тандор попросит подтвердить ваш номер, чтобы выдать код получения. Сообщите код отправителю только после того, как получите предмет.</p>';
    var html =
      '<div class="tt-recipient-wrap"><article class="tt-recipient-card" data-tt="messenger-portal">' +
      recipientBrandHeader() +
      transferKicker(data) +
      '<h2 class="tt-recipient-title">Подтверждение получателя</h2>' +
      preamble +
      '<div class="tt-recipient-step">' +
      '<p class="tt-recipient-step-label">Выберите мессенджер для подтверждения номера</p>' +
      '<div class="tt-messenger-portal-channels">';
    var channels = data.channels || [];
    for (var i = 0; i < channels.length; i++) {
      var ch = channels[i];
      var label = channelLabel(ch.channel);
      if (ch.available && ch.deepLink) {
        html +=
          '<a class="tt-messenger-portal-channel tt-primary tt-btn-block" data-tt="messenger-channel-open" data-channel="' +
          escapeHtml(ch.channel) +
          '" href="' +
          escapeHtml(ch.deepLink) +
          '" target="_blank" rel="noopener noreferrer">Открыть ' +
          escapeHtml(label) +
          "</a>";
      } else {
        html +=
          '<div class="tt-messenger-portal-channel tt-messenger-portal-channel--off" data-tt="messenger-channel-unavailable" data-channel="' +
          escapeHtml(ch.channel) +
          '" aria-disabled="true"><strong>' +
          escapeHtml(label) +
          " недоступен</strong>";
        if (ch.reason) {
          html +=
            '<span class="tt-messenger-portal-reason" data-tt="messenger-unavailable-reason">' +
            escapeHtml(ch.reason) +
            "</span>";
        }
        html += "</div>";
      }
    }
    html += "</div></div>";
    if (data.smsAlternative) {
      html +=
        '<p class="tt-messenger-portal-sms" data-tt="messenger-sms-hint">Можно также подтвердить номер по SMS, если отправитель прислал QR или ссылку с кодом.</p>';
    }
    html += "</article></div>";
    root.innerHTML = html;
    syncRecipientLogos();
    var focusEl = root.querySelector('[data-tt="recipient-messenger-preamble"]');
    if (focusEl && typeof focusEl.focus === "function") focusEl.focus();
  }

  function syncRecipientLogos() {
    if (typeof window.syncLegacyLogos === "function") {
      window.syncLegacyLogos();
      return;
    }
    var theme =
      document.documentElement.getAttribute("data-theme") ||
      (window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light");
    document.querySelectorAll("[data-legacy-logo-full]").forEach(function (img) {
      img.src =
        theme === "dark" ? "/brand/tandoor-logo-light.svg" : "/brand/tandoor-logo-official.svg";
    });
  }

  function renderMessengerPortal(root) {
    var data = portalUi.data;
    if (!data) return;
    if (!portalUi.showDetails) {
      renderWelcome(root, data);
      return;
    }
    renderMessengerDetails(root, data);
  }

  function bindPortalListeners(root) {
    if (portalUi.listenersBound) return;
    portalUi.listenersBound = true;
    root.addEventListener("click", function (ev) {
      var btn = ev.target && ev.target.closest ? ev.target.closest('[data-tt="recipient-welcome-continue"]') : null;
      if (!btn || !portalUi.data) return;
      ev.preventDefault();
      portalUi.showDetails = true;
      renderMessengerPortal(root);
    });
  }

  function bootMessengerPortal(mst) {
    window.__TT_MESSENGER_PORTAL_ONLY__ = true;
    document.body.classList.add("tt-messenger-portal-page");
    var root = document.getElementById("tt-root");
    if (!root) {
      showError("Не удалось открыть страницу получателя.");
      return;
    }
    bindPortalListeners(root);
    portalUi.showDetails = false;
    portalUi.data = null;
    root.innerHTML = '<p data-tt="messenger-portal-loading">Загрузка…</p>';
    var url =
      "/api/tan-tracker/public/recipient/messenger?mst=" + encodeURIComponent(mst);
    fetch(url, { credentials: "same-origin", headers: { Accept: "application/json" } })
      .then(function (response) {
        return response.json().then(function (data) {
          if (!response.ok) {
            throw new Error(
              (data && data.error && data.error.message) || "Приглашение недоступно.",
            );
          }
          return data;
        });
      })
      .then(function (data) {
        portalUi.data = data;
        renderMessengerPortal(root);
      })
      .catch(function (err) {
        renderWelcomeInvalid(
          root,
          err && err.message ? err.message : "Не удалось открыть страницу получателя.",
        );
      });
  }

  function boot() {
    document.body.classList.add("tt-lk-mode", "tt-active");
    var mst = parseMstFromLocation();
    if (mst) {
      bootMessengerPortal(mst);
      return;
    }
    var inv = parseInvitationFromLocation();
    if (inv.holderAccessToken) {
      void loadPublicHolderContext(inv.holderAccessToken)
        .then(function (data) {
          finishBootHolder(data, inv);
        })
        .catch(function (err) {
          showError(err && err.message ? err.message : "Не удалось открыть передачу.");
        });
      return;
    }
    var screen = inv.params.get("tt_screen") || new URLSearchParams(location.search || "").get("tt_screen");
    if (inv.token && (inv.orderId || screen === "detail" || screen === "code")) {
      void loadPublicContext(inv.token)
        .then(function (data) {
          whenTanTrackerReady(function () {
            finishBoot(data, inv);
            if (screen === "detail" || screen === "code") {
              window.TanTrackerPrototype.state.view = screen;
              window.TanTrackerPrototype.state.orderId = inv.orderId || data.orders?.[0]?.id;
              if (typeof window.__ttLkRenderTracker === "function") window.__ttLkRenderTracker();
            }
          });
        })
        .catch(function () {
          return loadPublicReceipt(inv.token).then(function (data) {
            whenTanTrackerReady(function () {
              finishBoot(data, inv);
            });
          });
        })
        .catch(function (err) {
          showError(err && err.message ? err.message : "Не удалось открыть приглашение.");
        });
      return;
    }
    if (!inv.token) {
      showError("Ссылка приглашения неполная или устарела.");
      return;
    }
    void loadPublicContext(inv.token)
      .catch(function () {
        return loadPublicReceipt(inv.token);
      })
      .then(function (data) {
        whenTanTrackerReady(function () {
          finishBoot(data, inv);
        });
      })
      .catch(function (err) {
        showError(err && err.message ? err.message : "Не удалось открыть приглашение.");
      });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot);
  } else {
    boot();
  }
})();
