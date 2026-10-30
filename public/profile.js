(function () {
  "use strict";

  var api = window.TandoorRf;
  var shell = window.ClientsShell;
  var form = document.getElementById("profile-form");
  var fullNameInput = document.getElementById("full-name");
  var emailInput = document.getElementById("email");
  var phoneInput = document.getElementById("phone");
  var roleInput = document.getElementById("role");
  var statusInput = document.getElementById("status");
  var saveButton = document.getElementById("save-button");
  var statusEl = document.getElementById("status-message");
  var saving = false;
  var tanbotSection = document.getElementById("tanbot-telegram-section");
  var tanbotStatus = document.getElementById("tanbot-telegram-status");
  var tanbotPending = document.getElementById("tanbot-telegram-pending");
  var tanbotActions = document.getElementById("tanbot-telegram-actions");
  var tanbotNotifWrap = document.getElementById("tanbot-notifications-toggle-wrap");
  var tanbotNotifToggle = document.getElementById("tanbot-notifications-toggle");
  var tanbotConfirmNotifWrap = document.getElementById("tanbot-confirm-notifications-wrap");
  var tanbotConfirmNotifToggle = document.getElementById("tanbot-confirm-notifications");
  var tanbotRefreshTimer = null;
  var tanbotMaxSection = document.getElementById("tanbot-max-section");
  var tanbotMaxStatus = document.getElementById("tanbot-max-status");
  var tanbotMaxPending = document.getElementById("tanbot-max-pending");
  var tanbotMaxActions = document.getElementById("tanbot-max-actions");
  var tanbotMaxNotifWrap = document.getElementById("tanbot-max-notifications-toggle-wrap");
  var tanbotMaxNotifToggle = document.getElementById("tanbot-max-notifications-toggle");
  var tanbotMaxConfirmNotifWrap = document.getElementById("tanbot-max-confirm-notifications-wrap");
  var tanbotMaxConfirmNotifToggle = document.getElementById("tanbot-max-confirm-notifications");
  var pendingTanbotDeepLinks = { telegram: "", max: "" };
  var tgLinkFallback = document.getElementById("tanbot-telegram-link-fallback");
  var tgLinkUrlInput = document.getElementById("tanbot-telegram-link-url");
  var tgLinkCopyBtn = document.getElementById("tanbot-telegram-link-copy");
  var maxLinkFallback = document.getElementById("tanbot-max-link-fallback");
  var maxLinkUrlInput = document.getElementById("tanbot-max-link-url");
  var maxLinkCopyBtn = document.getElementById("tanbot-max-link-copy");

  var ROLE_LABELS = {
    admin: "Администратор",
    director: "Директор",
    rop: "РОП",
    regional_manager: "Региональный менеджер",
    manager: "Менеджер",
    marketer: "Маркетолог",
    analyst: "Аналитик",
    category_manager: "Категорийный менеджер",
    assistant: "Ассистент",
    coordinator: "РОА (руководитель отдела ассистентов)",
  };

  var STATUS_LABELS = {
    invited: "Приглашён",
    active: "Активен",
    disabled: "Отключён",
  };

  if (!form || !fullNameInput || !emailInput || !api) {
    return;
  }

  function redirectToLogin() {
    window.location.replace("/login");
  }

  function fillForm(user) {
    fullNameInput.value = user.fullName || "";
    emailInput.value = user.email || "";
    phoneInput.value = user.phone || "";
    roleInput.value = ROLE_LABELS[user.role] || user.role || "";
    statusInput.value = STATUS_LABELS[user.status] || user.status || "";
    form.hidden = false;
  }

  function loadProfile() {
    api.setStatus(statusEl, "Загрузка профиля…", "loading");
    return api.apiRequest("/api/profile/self").then(function (result) {
      if (result.response.status === 401) {
        redirectToLogin();
        return null;
      }
      if (result.response.status === 503) {
        api.setStatus(
          statusEl,
          api.extractErrorMessage(result.data, "Вход временно недоступен."),
          "error",
        );
        return null;
      }
      if (result.response.status !== 200 || !result.data || !result.data.user) {
        api.setStatus(statusEl, "Не удалось загрузить профиль.", "error");
        return null;
      }
      fillForm(result.data.user);
      api.setStatus(statusEl, "", "");
      loadTanbotTelegram();
      loadTanbotMax();
      return result.data.user;
    });
  }

  function showPendingDeepLink(fallbackEl, inputEl, url, linked) {
    if (!fallbackEl || !inputEl) return;
    if (linked || !url) {
      fallbackEl.hidden = true;
      return;
    }
    inputEl.value = url;
    fallbackEl.hidden = false;
  }

  function copyInputValue(inputEl, label) {
    if (!inputEl || !inputEl.value) return;
    function showManualFallback() {
      inputEl.focus();
      inputEl.select();
      api.setStatus(statusEl, "Не удалось скопировать автоматически — выделите ссылку и скопируйте вручную.", "error");
    }
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(inputEl.value).then(
        function () {
          api.setStatus(statusEl, label + " скопирована.", "success");
        },
        function () {
          showManualFallback();
        },
      );
      return;
    }
    inputEl.select();
    try {
      document.execCommand("copy");
      api.setStatus(statusEl, label + " скопирована.", "success");
    } catch (_) {
      showManualFallback();
    }
  }

  function openMessengerDeepLink(deepLink, channelKey, fallbackEl, inputEl) {
    pendingTanbotDeepLinks[channelKey] = deepLink;
    showPendingDeepLink(fallbackEl, inputEl, deepLink, false);
    var popup = null;
    try {
      popup = window.open(deepLink, "_blank", "noopener,noreferrer");
    } catch (_) {
      popup = null;
    }
    if (!popup) {
      api.setStatus(
        statusEl,
        "Браузер заблокировал новое окно — откройте ссылку ниже или скопируйте её.",
        "error",
      );
    }
  }

  function loadTanbotTelegram() {
    if (!tanbotSection || !api.apiRequest) return;
    return api.apiRequest("/api/profile/tanbot/telegram").then(function (result) {
      if (result.response.status !== 200 || !result.data) {
        tanbotSection.hidden = true;
        return;
      }
      var d = result.data;
      if (!d.integrationEnabled) {
        tanbotSection.hidden = true;
        return;
      }
      tanbotSection.hidden = false;
      if (d.linked) {
        pendingTanbotDeepLinks.telegram = "";
        tanbotStatus.textContent =
          "Telegram подключён" + (d.telegramUsername ? " (@" + d.telegramUsername + ")" : "") + ".";
        tanbotNotifWrap.hidden = false;
        tanbotNotifToggle.checked = !!d.notificationsEnabled;
      } else {
        tanbotStatus.textContent = "Telegram не подключён.";
        tanbotNotifWrap.hidden = true;
      }
      tanbotPending.hidden = true;
      if (tanbotConfirmNotifWrap) tanbotConfirmNotifWrap.hidden = true;
      showPendingDeepLink(tgLinkFallback, tgLinkUrlInput, pendingTanbotDeepLinks.telegram, d.linked);
      tanbotActions.innerHTML = "";
      if (!d.linked) {
        var startBtn = document.createElement("button");
        startBtn.type = "button";
        startBtn.className = "secondary-button";
        startBtn.textContent = "Подключить Telegram";
        startBtn.addEventListener("click", startTanbotLink);
        tanbotActions.appendChild(startBtn);
      }
      if (d.linked) {
        var discBtn = document.createElement("button");
        discBtn.type = "button";
        discBtn.className = "secondary-button";
        discBtn.textContent = "Отключить Telegram";
        discBtn.addEventListener("click", disconnectTanbot);
        tanbotActions.appendChild(discBtn);
      }
    });
  }

  function startTanbotLink() {
    api
      .apiRequest("/api/profile/tanbot/telegram/link/start", { method: "POST", body: {} })
      .then(function (result) {
        if (result.response.status === 200 && result.data && result.data.deepLink) {
          openMessengerDeepLink(result.data.deepLink, "telegram", tgLinkFallback, tgLinkUrlInput);
          api.setStatus(
            statusEl,
            "Откройте Telegram и нажмите Start — привязка завершится в боте. Статус обновится на этой странице.",
            "success",
          );
          loadTanbotTelegram();
          scheduleTanbotRefresh();
        } else {
          api.setStatus(statusEl, api.extractErrorMessage(result.data, "Не удалось начать привязку."), "error");
        }
      });
  }

  function loadTanbotMax() {
    if (!tanbotMaxSection || !api.apiRequest) return;
    return api.apiRequest("/api/profile/tanbot/max").then(function (result) {
      if (result.response.status !== 200 || !result.data) {
        tanbotMaxSection.hidden = true;
        return;
      }
      var d = result.data;
      if (!d.integrationEnabled) {
        tanbotMaxSection.hidden = true;
        return;
      }
      tanbotMaxSection.hidden = false;
      if (d.linked) {
        pendingTanbotDeepLinks.max = "";
        tanbotMaxStatus.textContent =
          "MAX подключён" + (d.maxUsername ? " (@" + d.maxUsername + ")" : "") + ".";
        tanbotMaxNotifWrap.hidden = false;
        tanbotMaxNotifToggle.checked = !!d.notificationsEnabled;
      } else {
        tanbotMaxStatus.textContent = "MAX не подключён.";
        tanbotMaxNotifWrap.hidden = true;
      }
      tanbotMaxPending.hidden = true;
      if (tanbotMaxConfirmNotifWrap) tanbotMaxConfirmNotifWrap.hidden = true;
      showPendingDeepLink(maxLinkFallback, maxLinkUrlInput, pendingTanbotDeepLinks.max, d.linked);
      tanbotMaxActions.innerHTML = "";
      if (!d.linked) {
        var startBtn = document.createElement("button");
        startBtn.type = "button";
        startBtn.className = "secondary-button";
        startBtn.textContent = "Подключить MAX";
        startBtn.addEventListener("click", startTanbotMaxLink);
        tanbotMaxActions.appendChild(startBtn);
      }
      if (d.linked) {
        var discBtn = document.createElement("button");
        discBtn.type = "button";
        discBtn.className = "secondary-button";
        discBtn.textContent = "Отключить MAX";
        discBtn.addEventListener("click", disconnectTanbotMax);
        tanbotMaxActions.appendChild(discBtn);
      }
    });
  }

  function startTanbotMaxLink() {
    api
      .apiRequest("/api/profile/tanbot/max/link/start", { method: "POST", body: {} })
      .then(function (result) {
        if (result.response.status === 200 && result.data && result.data.deepLink) {
          openMessengerDeepLink(result.data.deepLink, "max", maxLinkFallback, maxLinkUrlInput);
          api.setStatus(
            statusEl,
            "Откройте MAX и нажмите Start — привязка завершится в боте. Статус обновится на этой странице.",
            "success",
          );
          loadTanbotMax();
          scheduleTanbotRefresh();
        } else {
          api.setStatus(statusEl, api.extractErrorMessage(result.data, "Не удалось начать привязку."), "error");
        }
      });
  }

  function scheduleTanbotRefresh() {
    if (tanbotRefreshTimer) window.clearTimeout(tanbotRefreshTimer);
    tanbotRefreshTimer = window.setTimeout(function () {
      loadTanbotTelegram();
      loadTanbotMax();
    }, 400);
  }

  function confirmTanbotMaxLink(attemptId) {
    var enableNotifications =
      tanbotMaxConfirmNotifToggle && !tanbotMaxConfirmNotifToggle.hidden && tanbotMaxConfirmNotifToggle.checked;
    api
      .apiRequest("/api/profile/tanbot/max/link/confirm", {
        method: "POST",
        body: { attemptId: attemptId, enableNotifications: !!enableNotifications },
      })
      .then(function (result) {
        if (result.response.status === 200) {
          api.setStatus(statusEl, "MAX подключён.", "success");
          loadTanbotMax();
        } else {
          api.setStatus(statusEl, api.extractErrorMessage(result.data, "Не удалось подтвердить."), "error");
        }
      });
  }

  function disconnectTanbotMax() {
    api.apiRequest("/api/profile/tanbot/max/disconnect", { method: "POST", body: {} }).then(function (result) {
      if (result.response.status === 200) {
        pendingTanbotDeepLinks.max = "";
        api.setStatus(statusEl, "MAX отключён.", "success");
        loadTanbotMax();
      }
    });
  }

  if (tanbotMaxNotifToggle) {
    tanbotMaxNotifToggle.addEventListener("change", function () {
      api
        .apiRequest("/api/profile/tanbot/max/notifications", {
          method: "POST",
          body: { enabled: tanbotMaxNotifToggle.checked },
        })
        .then(function (result) {
          if (result.response.status !== 200) {
            tanbotMaxNotifToggle.checked = !tanbotMaxNotifToggle.checked;
            api.setStatus(statusEl, api.extractErrorMessage(result.data, "Не удалось сохранить настройку."), "error");
          }
        });
    });
  }

  function confirmTanbotLink(attemptId) {
    var enableNotifications =
      tanbotConfirmNotifToggle && !tanbotConfirmNotifToggle.hidden && tanbotConfirmNotifToggle.checked;
    api
      .apiRequest("/api/profile/tanbot/telegram/link/confirm", {
        method: "POST",
        body: { attemptId: attemptId, enableNotifications: !!enableNotifications },
      })
      .then(function (result) {
        if (result.response.status === 200) {
          api.setStatus(statusEl, "Telegram подключён.", "success");
          loadTanbotTelegram();
        } else {
          api.setStatus(statusEl, api.extractErrorMessage(result.data, "Не удалось подтвердить."), "error");
        }
      });
  }

  function disconnectTanbot() {
    api.apiRequest("/api/profile/tanbot/telegram/disconnect", { method: "POST", body: {} }).then(function (result) {
      if (result.response.status === 200) {
        pendingTanbotDeepLinks.telegram = "";
        api.setStatus(statusEl, "Telegram отключён.", "success");
        loadTanbotTelegram();
      }
    });
  }

  if (tgLinkCopyBtn && tgLinkUrlInput) {
    tgLinkCopyBtn.addEventListener("click", function () {
      copyInputValue(tgLinkUrlInput, "Ссылка для Telegram");
    });
  }
  if (maxLinkCopyBtn && maxLinkUrlInput) {
    maxLinkCopyBtn.addEventListener("click", function () {
      copyInputValue(maxLinkUrlInput, "Ссылка для MAX");
    });
  }

  if (tanbotNotifToggle) {
    tanbotNotifToggle.addEventListener("change", function () {
      api
        .apiRequest("/api/profile/tanbot/telegram/notifications", {
          method: "POST",
          body: { enabled: tanbotNotifToggle.checked },
        })
        .then(function (result) {
          if (result.response.status !== 200) {
            tanbotNotifToggle.checked = !tanbotNotifToggle.checked;
            api.setStatus(statusEl, api.extractErrorMessage(result.data, "Не удалось сохранить настройку."), "error");
          }
        });
    });
  }

  form.addEventListener("submit", function (event) {
    event.preventDefault();
    if (saving) {
      return;
    }
    saving = true;
    saveButton.disabled = true;
    api.setStatus(statusEl, "Сохранение…", "loading");

    api
      .apiRequest("/api/profile/self", {
        method: "PATCH",
        body: {
          fullName: fullNameInput.value,
          phone: phoneInput.value,
        },
      })
      .then(function (result) {
        if (result.response.status === 401) {
          redirectToLogin();
          return;
        }
        if (result.response.status === 503) {
          api.setStatus(
            statusEl,
            api.extractErrorMessage(result.data, "Вход временно недоступен."),
            "error",
          );
          return;
        }
        if (result.response.status !== 200 || !result.data || !result.data.user) {
          api.setStatus(
            statusEl,
            api.extractErrorMessage(result.data, "Не удалось сохранить профиль."),
            "error",
          );
          return;
        }
        fillForm(result.data.user);
        api.setStatus(statusEl, "Профиль сохранён.", "success");
      })
      .catch(function (err) {
        api.setStatus(
          statusEl,
          api.mapRequestError(err, api.REQUEST_TIMEOUT_MS / 1000),
          "error",
        );
      })
      .finally(function () {
        saving = false;
        saveButton.disabled = false;
      });
  });

  window.addEventListener("focus", scheduleTanbotRefresh);
  window.addEventListener("pageshow", scheduleTanbotRefresh);
  document.addEventListener("visibilitychange", function () {
    if (document.visibilityState === "visible") scheduleTanbotRefresh();
  });

  shell.mountAuthenticatedShell("profile", function (user, reason) {
    if (reason) {
      api.setStatus(statusEl, "Не удалось проверить доступ. Обновите страницу.", "error");
      return;
    }
    if (!user) {
      redirectToLogin();
      return;
    }
    loadProfile().catch(function (err) {
      api.setStatus(
        statusEl,
        api.mapRequestError(err, api.REQUEST_TIMEOUT_MS / 1000),
        "error",
      );
    });
  });
})();
