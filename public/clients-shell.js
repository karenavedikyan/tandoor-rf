(function () {
  "use strict";

  var api = typeof window !== "undefined" ? window.TandoorRf : undefined;
  var ICONS = typeof window !== "undefined" && window.ShellIcons ? window.ShellIcons : {};
  var THEME_KEY = "tandoor-rf-theme";
  var SIDEBAR_KEY = "tandoor-rf-sidebar-collapsed";
  var DESKTOP_MQ = "(min-width: 1024px)";

  var mobileTrapHandler = null;
  var mobileEscapeHandler = null;
  var resizeHandlerBound = false;

  function escapeHtml(value) {
    return String(value)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function isDesktopViewport() {
    if (typeof window === "undefined" || !window.matchMedia) {
      return true;
    }
    return window.matchMedia(DESKTOP_MQ).matches;
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
    document.querySelectorAll("[data-legacy-logo-full], [data-legacy-logo]").forEach(function (img) {
      img.setAttribute(
        "src",
        theme === "dark" ? "/brand/tandoor-logo-light.svg" : "/brand/tandoor-logo-official.svg",
      );
    });
    document.querySelectorAll("[data-theme-toggle]").forEach(function (btn) {
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
      '<img class="legacy-sidebar__logo legacy-sidebar__logo--full" data-legacy-logo-full src="' +
      src +
      '" width="149" height="42" alt="Tandoor" />' +
      '<img class="legacy-sidebar__logo legacy-sidebar__logo--compact" src="/brand/tandoor-triangle-mark.svg" width="32" height="32" alt="Tandoor" />'
    );
  }

  function navLink(href, label, iconKey, active, activeKey) {
    var isActive = active === activeKey;
    var icon = ICONS[iconKey] || "";
    return (
      '<a class="legacy-nav-link' +
      (isActive ? " is-active" : "") +
      '" href="' +
      href +
      '" aria-label="' +
      escapeHtml(label) +
      '" title="' +
      escapeHtml(label) +
      '">' +
      '<span class="legacy-nav-link__icon">' +
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
      ? navLink("/clients", "Клиенты", "clients", active, "clients")
      : "";
    return (
      '<aside class="legacy-sidebar" id="legacy-sidebar" aria-label="Основная навигация">' +
      '<div class="legacy-sidebar__head">' +
      '<a class="legacy-sidebar__brand" href="' +
      (showClients ? "/clients" : "/profile") +
      '" aria-label="Tandoor tandoor-rf">' +
      logoMarkup() +
      '<span class="legacy-sidebar__project">tandoor-rf</span>' +
      "</a>" +
      '<button type="button" class="legacy-sidebar__collapse" id="legacy-sidebar-collapse" aria-label="Свернуть меню" aria-pressed="false">' +
      (ICONS.collapse || "") +
      "</button>" +
      "</div>" +
      '<nav class="legacy-sidebar__nav">' +
      clientsLink +
      navLink("/profile", "Мой профиль", "profile", active, "profile") +
      "</nav>" +
      '<div class="legacy-sidebar__footer">' +
      '<button type="button" class="legacy-nav-link" id="legacy-logout" aria-label="Выйти" title="Выйти">' +
      '<span class="legacy-nav-link__icon">' +
      (ICONS.logout || "") +
      "</span>" +
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
      '<button type="button" class="legacy-topbar__menu" id="legacy-menu-toggle" aria-expanded="false" aria-controls="legacy-sidebar" aria-label="Открыть меню">' +
      (ICONS.menu || "") +
      "</button>" +
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

  function focusElement(el) {
    if (el && typeof el.focus === "function") {
      el.focus();
    }
  }

  function isSidebarFocusCandidate(el) {
    if (!el || el.hasAttribute("disabled") || el.hidden) {
      return false;
    }
    if (el.getAttribute("aria-hidden") === "true") {
      return false;
    }
    if (!isDesktopViewport() && el.classList.contains("legacy-sidebar__collapse")) {
      return false;
    }
    return true;
  }

  function getSidebarFocusables(sidebar) {
    if (!sidebar) {
      return [];
    }
    var selector =
      'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';
    return Array.prototype.filter.call(sidebar.querySelectorAll(selector), isSidebarFocusCandidate);
  }

  function getFirstDrawerFocusTarget(sidebar) {
    if (!sidebar) {
      return null;
    }
    return (
      sidebar.querySelector(".legacy-sidebar__nav .legacy-nav-link") ||
      sidebar.querySelector(".legacy-sidebar__footer .legacy-nav-link") ||
      getSidebarFocusables(sidebar)[0] ||
      null
    );
  }

  function storeTabIndex(el) {
    if (!el.hasAttribute("data-legacy-tabindex")) {
      el.setAttribute("data-legacy-tabindex", el.getAttribute("tabindex") || "");
    }
  }

  function restoreTabIndex(el) {
    var stored = el.getAttribute("data-legacy-tabindex");
    if (stored === null) {
      return;
    }
    if (stored === "") {
      el.removeAttribute("tabindex");
    } else {
      el.setAttribute("tabindex", stored);
    }
    el.removeAttribute("data-legacy-tabindex");
  }

  function setSidebarInert(sidebar, inert) {
    if (!sidebar) {
      return;
    }
    var focusables = sidebar.querySelectorAll(
      "a, button, input, select, textarea, [tabindex]",
    );
    if (inert) {
      sidebar.setAttribute("aria-hidden", "true");
      if ("inert" in sidebar) {
        sidebar.inert = true;
      }
      focusables.forEach(function (el) {
        storeTabIndex(el);
        el.setAttribute("tabindex", "-1");
      });
    } else {
      sidebar.removeAttribute("aria-hidden");
      if ("inert" in sidebar) {
        sidebar.inert = false;
      }
      focusables.forEach(function (el) {
        restoreTabIndex(el);
      });
    }
  }

  function removeMobileTrap() {
    if (mobileTrapHandler) {
      document.removeEventListener("keydown", mobileTrapHandler, true);
      mobileTrapHandler = null;
    }
    if (mobileEscapeHandler) {
      document.removeEventListener("keydown", mobileEscapeHandler, true);
      mobileEscapeHandler = null;
    }
  }

  function installMobileTrap(sidebar, toggle) {
    removeMobileTrap();
    mobileTrapHandler = function (event) {
      if (event.key !== "Tab" || isDesktopViewport()) {
        return;
      }
      var focusables = getSidebarFocusables(sidebar);
      if (focusables.length === 0) {
        event.preventDefault();
        return;
      }
      var first = focusables[0];
      var last = focusables[focusables.length - 1];
      var active = sidebar.ownerDocument.activeElement;
      if (event.shiftKey) {
        if (active === first || !sidebar.contains(active)) {
          event.preventDefault();
          focusElement(last);
        }
      } else if (active === last || !sidebar.contains(active)) {
        event.preventDefault();
        focusElement(first);
      }
    };
    mobileEscapeHandler = function (event) {
      if (event.key === "Escape" && !isDesktopViewport()) {
        setMobileMenuOpen(false);
      }
    };
    document.addEventListener("keydown", mobileTrapHandler, true);
    document.addEventListener("keydown", mobileEscapeHandler, true);
  }

  function isMobileMenuOpen() {
    var toggle = document.getElementById("legacy-menu-toggle");
    return toggle ? toggle.getAttribute("aria-expanded") === "true" : false;
  }

  function setMobileMenuOpen(open, options) {
    var opts = options || {};
    var sidebar = document.getElementById("legacy-sidebar");
    var backdrop = document.getElementById("legacy-backdrop");
    var toggle = document.getElementById("legacy-menu-toggle");
    if (!sidebar || !backdrop || !toggle) {
      return;
    }

    if (isDesktopViewport()) {
      open = false;
    }

    sidebar.classList.toggle("is-open", open);
    backdrop.hidden = !open;
    toggle.setAttribute("aria-expanded", open ? "true" : "false");

    if (open) {
      setSidebarInert(sidebar, false);
      focusElement(getFirstDrawerFocusTarget(sidebar));
      installMobileTrap(sidebar, toggle);
    } else {
      removeMobileTrap();
      if (!isDesktopViewport()) {
        setSidebarInert(sidebar, true);
      } else {
        setSidebarInert(sidebar, false);
      }
      if (!opts.skipFocus) {
        focusElement(toggle);
      }
    }
  }

  function syncSidebarLayout() {
    var sidebar = document.getElementById("legacy-sidebar");
    var app = document.querySelector(".legacy-app");
    var collapseBtn = document.getElementById("legacy-sidebar-collapse");
    if (!sidebar || !app) {
      return;
    }

    var wantCollapsed = readSidebarCollapsed();

    if (collapseBtn) {
      collapseBtn.hidden = !isDesktopViewport();
    }

    if (isDesktopViewport()) {
      setMobileMenuOpen(false, { skipFocus: true });
      sidebar.classList.toggle("is-collapsed", wantCollapsed);
      app.classList.toggle("sidebar-collapsed", wantCollapsed);
      setSidebarInert(sidebar, false);
      if (collapseBtn) {
        collapseBtn.setAttribute("aria-pressed", wantCollapsed ? "true" : "false");
        collapseBtn.setAttribute("aria-label", wantCollapsed ? "Развернуть меню" : "Свернуть меню");
        collapseBtn.innerHTML = wantCollapsed ? ICONS.expand || "" : ICONS.collapse || "";
      }
    } else {
      sidebar.classList.remove("is-collapsed");
      app.classList.remove("sidebar-collapsed");
      setSidebarInert(sidebar, !isMobileMenuOpen());
    }
  }

  function bindMobileMenu() {
    var toggle = document.getElementById("legacy-menu-toggle");
    var backdrop = document.getElementById("legacy-backdrop");
    if (!toggle || !backdrop) {
      return;
    }
    toggle.addEventListener("click", function () {
      if (isDesktopViewport()) {
        return;
      }
      var open = toggle.getAttribute("aria-expanded") !== "true";
      setMobileMenuOpen(open);
    });
    backdrop.addEventListener("click", function () {
      setMobileMenuOpen(false);
    });
  }

  function bindSidebarCollapse() {
    var collapseBtn = document.getElementById("legacy-sidebar-collapse");
    var sidebar = document.getElementById("legacy-sidebar");
    var app = document.querySelector(".legacy-app");
    if (!collapseBtn || !sidebar || !app) {
      return;
    }
    collapseBtn.addEventListener("click", function () {
      if (!isDesktopViewport()) {
        return;
      }
      var next = !readSidebarCollapsed();
      writeSidebarCollapsed(next);
      syncSidebarLayout();
    });
  }

  function bindViewportSync() {
    if (resizeHandlerBound || typeof window === "undefined") {
      return;
    }
    resizeHandlerBound = true;
    var runSync = function () {
      syncSidebarLayout();
    };
    window.addEventListener("resize", runSync);
    if (window.matchMedia) {
      window.matchMedia(DESKTOP_MQ).addEventListener("change", runSync);
    }
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
    bindViewportSync();
    syncSidebarLayout();
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
    syncSidebarLayout: syncSidebarLayout,
    isDesktopViewport: isDesktopViewport,
    readSidebarCollapsed: readSidebarCollapsed,
    writeSidebarCollapsed: writeSidebarCollapsed,
  };

  if (typeof window !== "undefined") {
    window.ClientsShell = exported;
  }

  if (typeof module !== "undefined" && module.exports) {
    module.exports = exported;
  }
})();
