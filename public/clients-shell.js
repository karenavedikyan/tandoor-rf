(function () {
  "use strict";

  var api = typeof window !== "undefined" ? window.TandoorRf : undefined;
  var THEME_KEY = "tandoor-rf-theme";
  var SIDEBAR_KEY = "tandoor-rf-sidebar-collapsed";

  function escapeHtml(value) {
    return String(value)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function readTheme() {
    try {
      var stored = localStorage.getItem(THEME_KEY);
      return stored === "dark" ? "dark" : "light";
    } catch (_err) {
      return "light";
    }
  }

  function writeTheme(theme) {
    try {
      localStorage.setItem(THEME_KEY, theme);
    } catch (_err) {
      /* ignore */
    }
  }

  function readSidebarCollapsed() {
    try {
      return localStorage.getItem(SIDEBAR_KEY) === "true";
    } catch (_err) {
      return false;
    }
  }

  function writeSidebarCollapsed(collapsed) {
    try {
      localStorage.setItem(SIDEBAR_KEY, collapsed ? "true" : "false");
    } catch (_err) {
      /* ignore */
    }
  }

  function applyTheme(theme) {
    document.documentElement.setAttribute("data-theme", theme);
    var logos = document.querySelectorAll("[data-legacy-logo]");
    logos.forEach(function (img) {
      img.setAttribute(
        "src",
        theme === "dark" ? "/brand/tandoor-logo-light.svg" : "/brand/tandoor-logo-official.svg",
      );
    });
    var toggles = document.querySelectorAll("[data-theme-toggle]");
    toggles.forEach(function (btn) {
      var next = theme === "dark" ? "Светлая тема" : "Тёмная тема";
      btn.textContent = next;
      btn.setAttribute("aria-label", "Переключить на " + next.toLowerCase());
    });
  }

  function toggleTheme() {
    var next = readTheme() === "dark" ? "light" : "dark";
    writeTheme(next);
    applyTheme(next);
  }

  function logoMarkup() {
    var theme = readTheme();
    var src =
      theme === "dark" ? "/brand/tandoor-logo-light.svg" : "/brand/tandoor-logo-official.svg";
    return (
      '<img class="legacy-sidebar__logo" data-legacy-logo src="' +
      src +
      '" width="149" height="42" alt="Tandoor" />'
    );
  }

  function navLink(href, label, icon, active, activeKey) {
    var isActive = active === activeKey;
    return (
      '<a class="legacy-nav-link' +
      (isActive ? " is-active" : "") +
      '" href="' +
      href +
      '">' +
      '<span class="legacy-nav-link__icon" aria-hidden="true">' +
      icon +
      "</span>" +
      '<span class="legacy-nav-link__text">' +
      escapeHtml(label) +
      "</span>" +
      "</a>"
    );
  }

  function renderSidebar(active, showClients) {
    var clientsLink = showClients
      ? navLink("/clients", "Клиенты", "👥", active, "clients")
      : "";
    return (
      '<aside class="legacy-sidebar" id="legacy-sidebar" aria-label="Основная навигация">' +
      '<div class="legacy-sidebar__head">' +
      '<a class="legacy-sidebar__brand" href="' +
      (showClients ? "/clients" : "/profile") +
      '">' +
      logoMarkup() +
      '<span class="legacy-sidebar__project">tandoor-rf</span>' +
      "</a>" +
      '<button type="button" class="legacy-sidebar__collapse" id="legacy-sidebar-collapse" aria-label="Свернуть меню" aria-pressed="false">≡</button>' +
      "</div>" +
      '<nav class="legacy-sidebar__nav">' +
      clientsLink +
      navLink("/profile", "Мой профиль", "👤", active, "profile") +
      "</nav>" +
      '<div class="legacy-sidebar__footer">' +
      '<button type="button" class="legacy-nav-link" id="legacy-logout">' +
      '<span class="legacy-nav-link__icon" aria-hidden="true">⎋</span>' +
      '<span class="legacy-nav-link__text">Выйти</span>' +
      "</button>" +
      '<p id="legacy-logout-status" class="legacy-logout-status" role="status" aria-live="polite"></p>' +
      "</div>" +
      "</aside>"
    );
  }

  function renderTopbar() {
    return (
      '<header class="legacy-topbar" id="legacy-topbar">' +
      '<button type="button" class="legacy-topbar__menu" id="legacy-menu-toggle" aria-expanded="false" aria-controls="legacy-sidebar" aria-label="Открыть меню">☰</button>' +
      '<span class="legacy-topbar__spacer"></span>' +
      '<button type="button" class="legacy-topbar__theme" data-theme-toggle aria-label="Переключить тему"></button>' +
      "</header>"
    );
  }

  function setLogoutStatus(message, kind) {
    var statusEl = document.getElementById("legacy-logout-status");
    if (!statusEl) {
      return;
    }
    statusEl.textContent = message || "";
    statusEl.className = "legacy-logout-status" + (kind ? " legacy-logout-status--" + kind : "");
  }

  function bindLogout() {
    var logout = document.getElementById("legacy-logout");
    if (!logout || !api) {
      return;
    }
    logout.addEventListener("click", function () {
      logout.disabled = true;
      setLogoutStatus("Выход…", "loading");
      api
        .apiRequest("/api/auth/logout", { method: "POST", body: {} })
        .then(function (result) {
          if (result.response.status === 200) {
            window.location.replace("/login");
            return;
          }
          setLogoutStatus(
            api.extractErrorMessage(
              result.data,
              "Не удалось завершить выход. Повторите попытку.",
            ),
            "error",
          );
        })
        .catch(function (err) {
          setLogoutStatus(api.mapRequestError(err, api.REQUEST_TIMEOUT_MS / 1000), "error");
        })
        .finally(function () {
          logout.disabled = false;
        });
    });
  }

  function setMobileMenuOpen(open) {
    var sidebar = document.getElementById("legacy-sidebar");
    var backdrop = document.getElementById("legacy-backdrop");
    var toggle = document.getElementById("legacy-menu-toggle");
    if (!sidebar || !backdrop || !toggle) {
      return;
    }
    sidebar.classList.toggle("is-open", open);
    backdrop.hidden = !open;
    toggle.setAttribute("aria-expanded", open ? "true" : "false");
    if (open) {
      var firstLink = sidebar.querySelector(".legacy-nav-link");
      if (firstLink instanceof HTMLElement) {
        firstLink.focus();
      }
    }
  }

  function bindMobileMenu() {
    var toggle = document.getElementById("legacy-menu-toggle");
    var backdrop = document.getElementById("legacy-backdrop");
    if (!toggle || !backdrop) {
      return;
    }
    toggle.addEventListener("click", function () {
      var open = toggle.getAttribute("aria-expanded") !== "true";
      setMobileMenuOpen(open);
    });
    backdrop.addEventListener("click", function () {
      setMobileMenuOpen(false);
    });
    document.addEventListener("keydown", function (event) {
      if (event.key === "Escape") {
        setMobileMenuOpen(false);
      }
    });
  }

  function bindSidebarCollapse() {
    var collapseBtn = document.getElementById("legacy-sidebar-collapse");
    var sidebar = document.getElementById("legacy-sidebar");
    var app = document.querySelector(".legacy-app");
    if (!collapseBtn || !sidebar || !app) {
      return;
    }
    var collapsed = readSidebarCollapsed();
    if (collapsed) {
      sidebar.classList.add("is-collapsed");
      app.classList.add("sidebar-collapsed");
      collapseBtn.setAttribute("aria-pressed", "true");
      collapseBtn.setAttribute("aria-label", "Развернуть меню");
    }
    collapseBtn.addEventListener("click", function () {
      var next = !sidebar.classList.contains("is-collapsed");
      sidebar.classList.toggle("is-collapsed", next);
      app.classList.toggle("sidebar-collapsed", next);
      collapseBtn.setAttribute("aria-pressed", next ? "true" : "false");
      collapseBtn.setAttribute("aria-label", next ? "Развернуть меню" : "Свернуть меню");
      writeSidebarCollapsed(next);
    });
  }

  function bindThemeToggles() {
    document.querySelectorAll("[data-theme-toggle]").forEach(function (btn) {
      btn.addEventListener("click", toggleTheme);
    });
  }

  function mountShellParts(active, showClients) {
    var sidebarMount = document.getElementById("workspace-sidebar");
    var topbarMount = document.getElementById("workspace-topbar");
    if (sidebarMount) {
      sidebarMount.innerHTML = renderSidebar(active, showClients);
    }
    if (topbarMount) {
      topbarMount.innerHTML = renderTopbar();
    }
    applyTheme(readTheme());
    bindLogout();
    bindMobileMenu();
    bindSidebarCollapse();
    bindThemeToggles();
  }

  function mountShell(active, options) {
    var opts = options || {};
    var showClients = opts.showClients !== false;
    mountShellParts(active, showClients);
    if (typeof opts.onReady === "function") {
      opts.onReady();
    }
  }

  function ensureAuthenticated(onReady) {
    if (!api) {
      window.location.replace("/login");
      return Promise.resolve();
    }
    return api
      .apiRequest("/api/auth/me")
      .then(function (result) {
        if (result.response.status === 401) {
          window.location.replace("/login");
          return;
        }
        if (result.response.status === 403) {
          onReady(null, "forbidden");
          return;
        }
        if (result.response.status === 503 || result.response.status >= 500) {
          onReady(null, "service");
          return;
        }
        if (result.response.status !== 200 || !result.data || !result.data.user) {
          onReady(null, "service");
          return;
        }
        onReady(result.data.user, null);
      })
      .catch(function () {
        onReady(null, "network");
      });
  }

  function ensureAdminAccess(onReady) {
    return ensureAuthenticated(function (user, reason) {
      if (reason) {
        onReady(null, reason);
        return;
      }
      if (user.role !== "admin") {
        onReady(null, "forbidden");
        return;
      }
      onReady(user, null);
    });
  }

  function mountAuthenticatedShell(active, onUserReady) {
    return ensureAuthenticated(function (user, reason) {
      if (reason === "forbidden" || reason === "service" || reason === "network") {
        mountShellParts(active, false);
        if (typeof onUserReady === "function") {
          onUserReady(null, reason);
        }
        return;
      }
      var isAdmin = user && user.role === "admin";
      mountShellParts(active, isAdmin);
      if (typeof onUserReady === "function") {
        onUserReady(user, null);
      }
    });
  }

  function setPanelMessage(el, kind, title, text, actionHtml) {
    if (!el) {
      return;
    }
    el.hidden = false;
    el.classList.remove("clients-hidden");
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

  if (typeof document !== "undefined") {
    applyTheme(readTheme());
    if (document.querySelector("[data-theme-toggle]") && !document.getElementById("workspace-sidebar")) {
      document.querySelectorAll("[data-theme-toggle]").forEach(function (btn) {
        btn.addEventListener("click", toggleTheme);
      });
    }
  }

  var exported = {
    mountShell: mountShell,
    mountAuthenticatedShell: mountAuthenticatedShell,
    ensureAdminAccess: ensureAdminAccess,
    ensureAuthenticated: ensureAuthenticated,
    setPanelMessage: setPanelMessage,
    escapeHtml: escapeHtml,
    copyText: copyText,
    applyTheme: applyTheme,
    readTheme: readTheme,
    toggleTheme: toggleTheme,
    setMobileMenuOpen: setMobileMenuOpen,
  };

  if (typeof window !== "undefined") {
    window.ClientsShell = exported;
  }

  if (typeof module !== "undefined" && module.exports) {
    module.exports = exported;
  }
})();
