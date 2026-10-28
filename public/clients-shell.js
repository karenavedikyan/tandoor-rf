(function () {
  "use strict";

  var api = typeof window !== "undefined" ? window.TandoorRf : undefined;
  var ICONS = typeof window !== "undefined" && window.ShellIcons ? window.ShellIcons : {};
  var CLIENT_READ_ROLES = {
    admin: true,
    director: true,
    rop: true,
    regional_manager: true,
    manager: true,
    assistant: true,
  };
  var THEME_KEY = "tandoor-rf-theme";
  var SIDEBAR_KEY = "tandoor-rf-sidebar-collapsed";
  var DESKTOP_MQ = "(min-width: 1024px)";

  var mobileTrapHandler = null;
  var mobileEscapeHandler = null;
  var resizeHandlerBound = false;
  var previewState = { active: false };
  var actorUser = null;

  var PREVIEW_ROLE_LABELS = {
    manager: "Менеджер",
    regional_manager: "Региональный менеджер",
    rop: "РОП",
    director: "Директор",
    assistant: "Ассистент",
    coordinator: "РОА",
  };

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
      if (stored === "dark" || stored === "light") return stored;
    } catch (_err) {
      /* Fall back to the early theme, then system preference. */
    }
    var initial = document.documentElement.getAttribute("data-theme");
    if (initial === "dark" || initial === "light") return initial;
    return window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
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
    document.documentElement.style.colorScheme = theme;
    document.querySelectorAll("[data-legacy-logo-full], [data-legacy-logo]").forEach(function (img) {
      img.setAttribute(
        "src",
        theme === "dark" ? "/brand/tandoor-logo-light.svg" : "/brand/tandoor-logo-official.svg",
      );
    });
    document.querySelectorAll("[data-theme-toggle]").forEach(function (btn) {
      var next = theme === "dark" ? "Светлая тема" : "Тёмная тема";
      btn.setAttribute("aria-label", theme === "dark" ? "Включить светлую тему" : "Включить тёмную тему");
      btn.setAttribute("title", next);
      btn.innerHTML = '<span class="theme-toggle__icon" aria-hidden="true">' +
        (theme === "dark" ? ICONS.themeLight || "" : ICONS.themeDark || "") +
        '</span><span class="theme-toggle__label">' + next + "</span>";
    });
  }

  function toggleTheme() {
    var next = readTheme() === "dark" ? "light" : "dark";
    writeTheme(next);
    applyTheme(next);
  }

  function logoImgMarkup(className) {
    var theme = readTheme();
    var src =
      theme === "dark" ? "/brand/tandoor-logo-light.svg" : "/brand/tandoor-logo-official.svg";
    return (
      '<img class="' +
      className +
      '" data-legacy-logo-full src="' +
      src +
      '" width="142" height="40" alt="Tandoor" />'
    );
  }

  function userInitials(user) {
    if (!user || !user.fullName) {
      return "?";
    }
    var parts = String(user.fullName).trim().split(/\s+/).filter(Boolean);
    if (parts.length === 0) {
      return "?";
    }
    if (parts.length === 1) {
      return parts[0].slice(0, 2).toUpperCase();
    }
    return (parts[0].charAt(0) + parts[parts.length - 1].charAt(0)).toUpperCase();
  }

  function headerBrandMarkup(homeHref) {
    return (
      '<a class="legacy-topbar__brand" href="' +
      escapeHtml(homeHref || "/clients") +
      '" aria-label="Tandoor — личный кабинет">' +
      logoImgMarkup("legacy-topbar__logo") +
      '<span class="legacy-topbar__titles">' +
      '<span class="legacy-topbar__title">ЛИЧНЫЙ КАБИНЕТ</span>' +
      '<span class="legacy-topbar__subtitle">ТАНДОР</span>' +
      "</span>" +
      "</a>"
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

  function canReadClients(user) {
    return Boolean(user && CLIENT_READ_ROLES[user.role]);
  }

  function renderSidebar(active, showClients, showAdminAccess, showAccessWorkspace, clientsHref) {
    var clientsNavHref = clientsHref || "/clients";
    var clientsLink = showClients
      ? navLink(clientsNavHref, "Клиенты", "clients", active, "clients")
      : "";
    var effectiveUser = getEffectiveUser(actorUser);
    var salesLink = showClients && (!effectiveUser || effectiveUser.role !== "assistant") ? navLink("/sales", "Продажи", "sales", active, "sales") : "";
    var launch = api && api.launch;
    var workLink = showClients && (!launch || launch.navigation.work)
      ? navLink("/work", "Моя работа", "work", active, "work")
      : "";
    var workspaceLink = showAccessWorkspace && (!launch || launch.navigation.substitution)
      ? navLink("/access", "Назначения ассистентам", "substitution", active, "access-workspace")
      : "";
    var adminLink = showAdminAccess
      ? navLink("/admin/access", "Настройка доступа", "profile", active, "admin-access")
      : "";
    var serviceLinks = adminLink + navLink("/profile", "Мой профиль", "profile", active, "profile");
    return (
      '<aside class="legacy-sidebar" id="legacy-sidebar" aria-label="Основная навигация">' +
      '<nav class="legacy-sidebar__nav">' +
      '<div class="legacy-sidebar__collapse-wrap">' +
      '<button type="button" class="legacy-sidebar__collapse" id="legacy-sidebar-collapse" aria-label="Свернуть меню" aria-pressed="false">' +
      (ICONS.collapse || "") +
      "</button>" +
      "</div>" +
      clientsLink +
      salesLink +
      workLink +
      workspaceLink +
      "</nav>" +
      '<div class="legacy-sidebar__footer">' +
      (serviceLinks
        ? '<p class="legacy-sidebar__footer-label">Служебное</p>' + serviceLinks
        : "") +
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

  function renderTopbar(showClients, user) {
    var homeHref = showClients ? "/clients" : "/profile";
    var initials = userInitials(user);
    var profileLabel =
      user && user.fullName ? escapeHtml(String(user.fullName)) : "Мой профиль";
    return (
      '<header class="legacy-topbar" id="legacy-topbar">' +
      '<button type="button" class="legacy-topbar__menu" id="legacy-menu-toggle" aria-expanded="false" aria-controls="legacy-sidebar" aria-label="Открыть меню">' +
      (ICONS.menu || "") +
      "</button>" +
      headerBrandMarkup(homeHref) +
      '<span class="legacy-topbar__spacer"></span>' +
      '<div class="legacy-topbar__actions">' +
      (actorUser && actorUser.role === "admin" ? '<button type="button" class="shell-preview-trigger" id="shell-preview-open" aria-haspopup="dialog">'+(previewState.active ? "Сменить профиль" : "Войти как")+'</button>' : "") +
      '<div id="assignment-notifications-mount" data-role="' + escapeHtml(user && user.role || "") + '"></div>' +
      '<button type="button" class="legacy-topbar__theme" data-theme-toggle aria-label="Переключить тему"></button>' +
      '<a class="legacy-topbar__user" href="/profile" aria-label="' +
      profileLabel +
      '" title="' +
      profileLabel +
      '">' +
      '<span class="legacy-topbar__avatar" aria-hidden="true">' +
      escapeHtml(initials) +
      "</span>" +
      "</a>" +
      "</div>" +
      "</header>"
    );
  }

  function ensureTopbarPlacement() {
    var main = document.querySelector(".legacy-content");
    if (main) {
      main.id = main.id || "cabinet-main";
      main.setAttribute("tabindex", "-1");
      if (!document.querySelector(".cabinet-skip")) {
        var skip = document.createElement("a");
        skip.className = "cabinet-skip";
        skip.href = "#" + main.id;
        skip.textContent = "К содержимому";
        document.body.insertBefore(skip, document.body.firstChild);
      }
    }
    var topbarMount = document.getElementById("workspace-topbar");
    var app = document.querySelector(".legacy-app");
    if (topbarMount && app && topbarMount.parentElement !== app) {
      app.insertBefore(topbarMount, app.firstChild);
    }
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

  function getPreviewState() {
    return previewState;
  }

  function getActorUser() {
    return actorUser;
  }

  function getEffectiveUser(user) {
    if (previewState && previewState.active && previewState.targetUser) {
      return previewState.targetUser;
    }
    return user;
  }

  function openEmployeePreviewPicker(returnFocusEl) {
    if (!api) return;
    var old = document.getElementById("shell-preview-picker");
    if (old) old.remove();
    var dialog = document.createElement("dialog"), items = [], seq = 0, timer;
    var returnFocus = returnFocusEl || document.getElementById("shell-preview-open");
    dialog.id = "shell-preview-picker";
    dialog.className = "shell-preview-picker";
    dialog.setAttribute("aria-labelledby", "shell-preview-title");
    dialog.innerHTML = '<header><div><h2 id="shell-preview-title">Войти как сотрудник</h2><p>Только просмотр. Пароль сотрудника не нужен, изменения запрещены.</p></div><button type="button" data-preview-close>Закрыть</button></header>'+
      '<form id="shell-preview-search"><label>Имя или email<input id="shell-preview-query" type="search" maxlength="200" placeholder="Найти сотрудника" autocomplete="off"></label>'+
      '<label>Роль<select id="shell-preview-role"><option value="">Все роли</option>'+Object.keys(PREVIEW_ROLE_LABELS).map(function(r){return '<option value="'+r+'">'+PREVIEW_ROLE_LABELS[r]+'</option>';}).join("")+'</select></label><button type="submit">Найти</button></form>'+
      '<p id="shell-preview-status" role="status" aria-live="polite"></p><div id="shell-preview-results" class="shell-preview-results"></div>';
    document.body.appendChild(dialog);
    var status = dialog.querySelector("#shell-preview-status"), results = dialog.querySelector("#shell-preview-results");
    function resetSelectableRows() {
      results.querySelectorAll("button.shell-preview-person[data-can-select='true']").forEach(function (b) {
        b.disabled = false;
      });
    }
    function setSelectableRowsLoading(loading) {
      results.querySelectorAll("button.shell-preview-person[data-can-select='true']").forEach(function (b) {
        b.disabled = loading;
      });
    }
    function draw() {
      var role = dialog.querySelector("#shell-preview-role").value;
      var rows = items.filter(function(u){return !role || u.role === role;});
      status.textContent = rows.length ? "Найдено: "+rows.length+(items.length===100?". Уточните поиск, показаны первые 100.":"") : "Сотрудники не найдены. Измените поиск или роль.";
      results.innerHTML = rows.map(function(u){
        var blocked = u.canSelect === false;
        var hint = blocked && u.blockReason ? '<small>'+escapeHtml(u.blockReason)+'</small>' : '';
        return '<button type="button" class="shell-preview-person" data-can-select="'+(!blocked)+'" '+(blocked?'disabled title="'+escapeHtml(u.blockReason||"Недоступно")+'"':'data-preview-id="'+escapeHtml(u.id)+'"')+'><span><strong>'+escapeHtml(u.fullName)+'</strong><small>'+escapeHtml(u.email)+'</small>'+hint+'</span><span class="shell-preview-role">'+escapeHtml(PREVIEW_ROLE_LABELS[u.role]||u.role)+'</span></button>';
      }).join("");
    }
    async function search() {
      clearTimeout(timer);
      var n = ++seq, q = dialog.querySelector("#shell-preview-query").value.trim();
      results.innerHTML = "";
      if(q.length===1){status.textContent="Введите минимум 2 символа или очистите поле, чтобы увидеть список.";return;}
      status.textContent = "Загружаем сотрудников…";
      try {
        var r = await api.apiRequest("/api/admin/access/preview/candidates?q="+encodeURIComponent(q));
        if(n!==seq || !dialog.open)return;
        if(r.response.status!==200)throw Error(api.extractErrorMessage(r.data,"Не удалось загрузить сотрудников."));
        items = r.data.items || []; draw();
      } catch(err) { if(n===seq && dialog.open)status.textContent=err.message||"Ошибка запроса."; }
    }
    dialog.querySelector("#shell-preview-search").onsubmit=function(ev){ev.preventDefault();void search();};
    dialog.querySelector("#shell-preview-query").oninput=function(){++seq;results.innerHTML="";clearTimeout(timer);timer=setTimeout(search,300);};
    dialog.querySelector("#shell-preview-role").onchange=draw;
    dialog.querySelector("[data-preview-close]").onclick=function(){dialog.close();};
    dialog.onclose=function(){++seq;clearTimeout(timer);dialog.remove();if(returnFocus&&returnFocus.focus)returnFocus.focus();};
    results.onclick=async function(ev){
      var button=ev.target.closest("[data-preview-id]");
      if(!button || button.disabled)return;
      setSelectableRowsLoading(true);
      status.textContent="Открываем профиль…";
      try {
        var r=await api.apiRequest("/api/admin/access/preview/start",{method:"POST",body:{userId:button.dataset.previewId}});
        if(r.response.status!==200)throw Error(api.extractErrorMessage(r.data,"Не удалось включить просмотр."));
        var role=r.data.preview.targetUser.role;
        window.location.assign(role==="coordinator"?"/access":"/clients");
      } catch(err) {
        if(dialog.open){
          status.textContent=err.message||"Ошибка запроса.";
          resetSelectableRows();
        }
      }
    };
    dialog.showModal();void search();
    dialog.querySelector("#shell-preview-query").focus();
  }

  function bindPreviewPicker() {
    var trigger = document.getElementById("shell-preview-open");
    if (!trigger || !api) return;
    trigger.onclick = function () {
      openEmployeePreviewPicker(trigger);
    };
  }

  function stopPreviewSession() {
    if (!api) {
      window.location.reload();
      return Promise.resolve();
    }
    return api
      .apiRequest("/api/admin/access/preview/stop", { method: "POST", body: {} })
      .then(function (result) {
        if (result.response.status !== 200) {
          throw new Error(api.extractErrorMessage(result.data, "Не удалось выйти из просмотра."));
        }
        window.location.href = "/admin/access";
      });
  }

  function syncPreviewBanner() {
    var frame = document.querySelector(".legacy-frame");
    if (!frame) {
      return;
    }
    var existing = document.getElementById("workspace-preview-banner");
    if (!previewState || !previewState.active) {
      if (existing) {
        existing.remove();
      }
      document.body.classList.remove("clients-preview-active");
      return;
    }

    var bannerHtml = "";
    if (previewState.error) {
      var errorLabel = previewState.targetUser
        ? escapeHtml(previewState.targetUser.fullName)
        : "сотрудника";
      bannerHtml =
        '<div class="clients-preview-banner clients-preview-banner--error" role="alert">' +
        '<span class="clients-preview-banner__text">Просмотр от имени: ' +
        errorLabel +
        ". " +
        escapeHtml(previewState.error.message || "Просмотр недоступен.") +
        "</span>" +
        '<button type="button" class="workspace-button workspace-button--ghost clients-preview-banner__stop" id="clients-preview-stop-btn">Вернуться к администратору</button>' +
        "</div>";
    } else if (previewState.targetUser) {
      var roleLabel =
        PREVIEW_ROLE_LABELS[previewState.targetUser.role] || previewState.targetUser.role || "";
      var adminName =
        actorUser && actorUser.fullName ? escapeHtml(actorUser.fullName) : "администратор";
      var workMode = Boolean(previewState.workMode);
      var expiryNote = "";
      if (workMode && previewState.workExpiresAt) {
        try {
          expiryNote =
            " Действует до " +
            new Date(previewState.workExpiresAt).toLocaleString("ru-RU", { timeZone: "Europe/Moscow" }) +
            " МСК.";
        } catch (_fmt) {
          expiryNote = "";
        }
      }
      var modeText = workMode
        ? "Рабочий режим: действия изменяют данные и уведомления. Инициатор — " +
          adminName +
          "." +
          expiryNote
        : "Только просмотр. Изменения запрещены.";
      bannerHtml =
        '<div class="clients-preview-banner' + (workMode ? " clients-preview-banner--work" : "") + '" role="status">' +
        '<span class="clients-preview-banner__text"><strong>' +
        escapeHtml(previewState.targetUser.fullName) +
        "</strong> · " +
        escapeHtml(roleLabel) +
        ". " +
        modeText +
        "</span>" +
        '<div class="clients-preview-banner__actions">' +
        (workMode
          ? '<button type="button" class="workspace-button workspace-button--secondary" id="clients-preview-readonly-btn">Только просмотр</button>'
          : '<button type="button" class="workspace-button workspace-button--secondary" id="clients-preview-work-btn">Работать от имени сотрудника</button>') +
        '<button type="button" class="workspace-button workspace-button--ghost clients-preview-banner__stop" id="clients-preview-stop-btn">Выйти к администратору</button>' +
        "</div></div>";
    } else {
      if (existing) {
        existing.remove();
      }
      document.body.classList.remove("clients-preview-active");
      return;
    }

    if (!existing) {
      existing = document.createElement("div");
      existing.id = "workspace-preview-banner";
      var topbar = document.getElementById("workspace-topbar");
      if (topbar) {
        topbar.insertAdjacentElement("afterend", existing);
      } else {
        frame.insertBefore(existing, frame.firstChild);
      }
    }
    existing.innerHTML = bannerHtml;
    document.body.classList.add("clients-preview-active");
    var stopBtn = document.getElementById("clients-preview-stop-btn");
    if (stopBtn) {
      stopBtn.addEventListener("click", function () {
        stopPreviewSession().catch(function (err) {
          window.alert(err.message || "Не удалось выйти из просмотра.");
        });
      });
    }
    var workBtn = document.getElementById("clients-preview-work-btn");
    if (workBtn) {
      workBtn.addEventListener("click", function () {
        var ok = window.confirm(
          "Действия изменяют реальные данные и могут отправлять внутренние уведомления. В истории будет указан администратор. Продолжить?",
        );
        if (!ok) return;
        if (window.AssignmentWorkspace && window.AssignmentWorkspace.saveTransferState) {
          window.AssignmentWorkspace.saveTransferState();
        }
        api
          .apiRequest("/api/admin/access/preview/work/enable", { method: "POST", body: { confirm: true } })
          .then(function (result) {
            if (result.response.status !== 200) {
              throw new Error(api.extractErrorMessage(result.data, "Не удалось включить рабочий режим."));
            }
            previewState = result.data.preview || previewState;
            window.location.reload();
          })
          .catch(function (err) {
            window.alert(err.message || "Не удалось включить рабочий режим.");
          });
      });
    }
    var readonlyBtn = document.getElementById("clients-preview-readonly-btn");
    if (readonlyBtn) {
      readonlyBtn.addEventListener("click", function () {
        api
          .apiRequest("/api/admin/access/preview/work/disable", { method: "POST", body: {} })
          .then(function (result) {
            if (result.response.status !== 200) {
              throw new Error(api.extractErrorMessage(result.data, "Не удалось вернуть режим просмотра."));
            }
            previewState = result.data.preview || previewState;
            window.location.reload();
          })
          .catch(function (err) {
            window.alert(err.message || "Не удалось вернуть режим просмотра.");
          });
      });
    }
  }

  function mountShellParts(active, showClients, showAdminAccess, showAccessWorkspace, clientsHref) {
    var sidebarMount = document.getElementById("workspace-sidebar");
    var topbarMount = document.getElementById("workspace-topbar");
    if (sidebarMount) {
      sidebarMount.innerHTML = renderSidebar(
        active,
        showClients,
        showAdminAccess,
        showAccessWorkspace,
        clientsHref,
      );
    }
    if (topbarMount) {
      topbarMount.innerHTML = renderTopbar(showClients, getEffectiveUser(actorUser));
      ensureTopbarPlacement();
    }
    applyTheme(readTheme());
    bindLogout();
    bindMobileMenu();
    bindSidebarCollapse();
    bindThemeToggles();
    bindPreviewPicker();
    bindViewportSync();
    syncSidebarLayout();
    syncPreviewBanner();
    if (actorUser && !document.querySelector('script[data-assignment-notifications]')) {
      var notifications = document.createElement("script");
      notifications.src = "/assignment-notifications.js?v=reviews1";
      notifications.onload = function () { if (window.mountAssignmentNotifications) window.mountAssignmentNotifications(getEffectiveUser(actorUser)); };
      notifications.setAttribute("data-assignment-notifications", "");
      document.head.appendChild(notifications);
    }
  }

  var ACCESS_WORKSPACE_ROLES = {
    admin: true,
    manager: true,
    rop: true,
    coordinator: true,
    director: true,
  };

  function canUseAccessWorkspace(user) {
    return Boolean(user && ACCESS_WORKSPACE_ROLES[user.role]);
  }

  function mountShell(active, options) {
    var opts = options || {};
    var showClients = opts.showClients !== false;
    var showAdminAccess = opts.showAdminAccess === true;
    var showAccessWorkspace = opts.showAccessWorkspace === true;
    mountShellParts(active, showClients, showAdminAccess, showAccessWorkspace, opts.clientsHref);
    if (typeof opts.onReady === "function") {
      opts.onReady();
    }
  }

  function mountAuthenticatedChrome(active, options) {
    mountShell(active, options || {});
    bindPreviewPicker();
    syncPreviewBanner();
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
        actorUser = result.data.user;
        previewState = result.data.preview || { active: false };
        if (
          actorUser.mustChangePassword &&
          window.location.pathname !== "/change-password"
        ) {
          window.location.replace("/change-password");
          return;
        }
        syncPreviewBanner();
        onReady(getEffectiveUser(result.data.user), null);
      })
      .catch(function () {
        onReady(null, "network");
      });
  }

  function ensureAdminAccess(onReady) {
    return ensureAuthenticated(function (_user, reason) {
      if (reason) {
        onReady(null, reason);
        return;
      }
      if (!actorUser || actorUser.role !== "admin") {
        onReady(null, "forbidden");
        return;
      }
      onReady(actorUser, null);
    });
  }

  function ensureClientsReadAccess(onReady) {
    return ensureAuthenticated(function (user, reason) {
      if (reason) {
        onReady(null, reason);
        return;
      }
      if (!canReadClients(user)) {
        onReady(null, "forbidden");
        return;
      }
      onReady(user, null);
    });
  }

  function mountAuthenticatedShell(active, onUserReady) {
    return ensureAuthenticated(function (user, reason) {
      if (reason === "forbidden" || reason === "service" || reason === "network") {
        mountShellParts(active, false, false, false);
        if (typeof onUserReady === "function") {
          onUserReady(null, reason);
        }
        return;
      }
      var showClients = canReadClients(user);
      var isAdmin = user && user.role === "admin";
      var showAccessWorkspace = canUseAccessWorkspace(user);
      var clientsHref = "/clients";
      if (!showClients || !api) {
        mountShellParts(active, showClients, isAdmin, showAccessWorkspace, clientsHref);
        if (typeof onUserReady === "function") {
          onUserReady(user, null);
        }
        return;
      }
      api
        .apiRequest("/api/clients/presentation")
        .then(function (result) {
          if (result.response.status === 200 && result.data && result.data.presentation) {
            clientsHref = result.data.presentation.clientsHref || clientsHref;
          }
          mountShellParts(active, showClients, isAdmin, showAccessWorkspace, clientsHref);
          if (typeof onUserReady === "function") {
            onUserReady(user, null);
          }
        })
        .catch(function () {
          mountShellParts(active, showClients, isAdmin, showAccessWorkspace, clientsHref);
          if (typeof onUserReady === "function") {
            onUserReady(user, null);
          }
        });
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
    ensureClientsReadAccess: ensureClientsReadAccess,
    canReadClients: canReadClients,
    ensureAuthenticated: ensureAuthenticated,
    getPreviewState: getPreviewState,
    getActorUser: getActorUser,
    getEffectiveUser: getEffectiveUser,
    stopPreviewSession: stopPreviewSession,
    openEmployeePreviewPicker: openEmployeePreviewPicker,
    mountAuthenticatedChrome: mountAuthenticatedChrome,
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
