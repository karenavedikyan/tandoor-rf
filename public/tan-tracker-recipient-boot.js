(function () {
  "use strict";

  var statePanel = document.getElementById("tt-state-panel");

  function showError(message) {
    if (!statePanel) return;
    statePanel.classList.remove("clients-hidden");
    statePanel.textContent = message;
  }

  function parseInvitationFromLocation() {
    var hash = location.hash || "";
    var q = hash.indexOf("?");
    var params = new URLSearchParams(q >= 0 ? hash.slice(q + 1) : "");
    var search = new URLSearchParams(location.search || "");
    var token = params.get("tt_tok") || search.get("tt_tok") || "";
    var orderId = params.get("tt_order") || params.get("tt_id") || search.get("tt_order") || "";
    var hv = params.get("tt_hv") || search.get("tt_hv") || "";
    var rcv = params.get("tt_rcv") || search.get("tt_rcv") || "";
    var via = params.get("tt_via") || search.get("tt_via") || "qr";
    return { token: token, orderId: orderId, hv: hv, rcv: rcv, via: via, params: params };
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
      "/api/tan-tracker/public/recipient/receipt?invitationToken=" + encodeURIComponent(token);
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
    if (!data.publicReceipt) applyPublicRoute(inv);
    window.TanTrackerPrototype.hydrateFromServer(window.__TT_LK_BOOTSTRAP__);
    if (typeof window.__ttLkRenderTracker === "function") {
      window.__ttLkRenderTracker();
    }
  }

  function boot() {
    document.body.classList.add("tt-lk-mode", "tt-active");
    var inv = parseInvitationFromLocation();
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
