(function () {
  "use strict";

  var api = window.TandoorRf;

  function escapeHtml(value) {
    return String(value)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function renderHeader(active) {
    return (
      '<header class="workspace-header">' +
      '<div class="workspace-header__inner">' +
      '<a class="workspace-brand" href="/clients">' +
      '<img class="workspace-brand__logo" src="/brand/tandoor-logo-official.svg" width="149" height="42" alt="Tandoor" />' +
      '<span class="workspace-brand__title">tandoor-rf</span>' +
      "</a>" +
      '<nav class="workspace-nav" aria-label="Основная навигация">' +
      '<a class="workspace-nav__link' +
      (active === "clients" ? " is-active" : "") +
      '" href="/clients">Клиенты</a>' +
      '<a class="workspace-nav__link' +
      (active === "profile" ? " is-active" : "") +
      '" href="/profile">Мой профиль</a>' +
      '<button type="button" class="workspace-nav__link" id="workspace-logout">Выйти</button>' +
      "</nav>" +
      "</div>" +
      "</header>"
    );
  }

  function mountShell(active) {
    var mount = document.getElementById("workspace-shell");
    if (!mount) {
      return;
    }
    mount.innerHTML = renderHeader(active);
    var logout = document.getElementById("workspace-logout");
    if (logout && api) {
      logout.addEventListener("click", function () {
        logout.disabled = true;
        api
          .apiRequest("/api/auth/logout", { method: "POST", body: {} })
          .then(function () {
            window.location.replace("/login");
          })
          .catch(function () {
            window.location.replace("/login");
          });
      });
    }
  }

  function ensureAdminAccess(onReady) {
    if (!api) {
      window.location.replace("/login");
      return;
    }
    api.apiRequest("/api/auth/me").then(function (result) {
      if (result.response.status === 401) {
        window.location.replace("/login");
        return;
      }
      if (result.response.status !== 200 || !result.data || !result.data.user) {
        onReady(null, "service");
        return;
      }
      if (result.data.user.role !== "admin") {
        onReady(null, "forbidden");
        return;
      }
      onReady(result.data.user, null);
    });
  }

  function setPanelMessage(el, kind, title, text, actionHtml) {
    if (!el) {
      return;
    }
    el.hidden = false;
    el.innerHTML =
      '<div class="clients-empty">' +
      '<p class="clients-empty__title">' +
      escapeHtml(title) +
      "</p>" +
      (text ? "<p>" + escapeHtml(text) + "</p>" : "") +
      (actionHtml || "") +
      "</div>";
    el.dataset.state = kind;
  }

  function copyText(value) {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      return navigator.clipboard.writeText(value);
    }
    return new Promise(function (resolve, reject) {
      try {
        var area = document.createElement("textarea");
        area.value = value;
        area.setAttribute("readonly", "readonly");
        area.style.position = "fixed";
        area.style.left = "-9999px";
        document.body.appendChild(area);
        area.select();
        var ok = document.execCommand("copy");
        document.body.removeChild(area);
        if (ok) {
          resolve(undefined);
        } else {
          reject(new Error("copy failed"));
        }
      } catch (err) {
        reject(err);
      }
    });
  }

  window.ClientsShell = {
    mountShell: mountShell,
    ensureAdminAccess: ensureAdminAccess,
    setPanelMessage: setPanelMessage,
    escapeHtml: escapeHtml,
    copyText: copyText,
  };
})();
