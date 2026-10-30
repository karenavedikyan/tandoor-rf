(function () {
  "use strict";

  var statePanel = document.getElementById("tt-state-panel");

  function showError(message) {
    if (!statePanel) return;
    statePanel.classList.remove("clients-hidden");
    statePanel.textContent = message;
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

  function renderMessengerPortal(root, data) {
    var codeLine = data.transferPublicCode
      ? '<p class="tt-recipient-kicker">Передача ' + escapeHtml(data.transferPublicCode) + "</p>"
      : "";
    var title = data.itemTitle
      ? '<h2 class="tt-recipient-title">' + escapeHtml(data.itemTitle) + "</h2>"
      : '<h2 class="tt-recipient-title">Подтверждение получателя</h2>';
    var html =
      '<div class="tt-recipient-wrap"><article class="tt-recipient-card" data-tt="messenger-portal">' +
      '<p class="tt-recipient-hero">Получение передачи</p>' +
      title +
      codeLine +
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
  }

  function escapeHtml(text) {
    return String(text)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function bootMessengerPortal(mst) {
    window.__TT_MESSENGER_PORTAL_ONLY__ = true;
    document.body.classList.add("tt-messenger-portal-page");
    var root = document.getElementById("tt-root");
    if (!root) {
      showError("Не удалось открыть страницу получателя.");
      return;
    }
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
        renderMessengerPortal(root, data);
      })
      .catch(function (err) {
        root.innerHTML = "";
        showError(err && err.message ? err.message : "Не удалось открыть страницу получателя.");
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
