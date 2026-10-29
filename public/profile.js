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
      return result.data.user;
    });
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
        tanbotStatus.textContent =
          "Telegram подключён" + (d.telegramUsername ? " (@" + d.telegramUsername + ")" : "") + ".";
        tanbotNotifWrap.hidden = false;
        tanbotNotifToggle.checked = !!d.notificationsEnabled;
      } else {
        tanbotStatus.textContent = "Telegram не подключён.";
        tanbotNotifWrap.hidden = true;
      }
      if (d.pendingConfirmation) {
        tanbotPending.hidden = false;
        if (tanbotConfirmNotifWrap) tanbotConfirmNotifWrap.hidden = false;
        var p = d.pendingConfirmation;
        tanbotPending.textContent =
          "Подтвердите привязку Telegram" +
          (p.telegramUsername ? " @" + p.telegramUsername : p.telegramFirstName ? " (" + p.telegramFirstName + ")" : "") +
          ".";
      } else {
        tanbotPending.hidden = true;
        if (tanbotConfirmNotifWrap) tanbotConfirmNotifWrap.hidden = true;
      }
      tanbotActions.innerHTML = "";
      if (!d.linked) {
        var startBtn = document.createElement("button");
        startBtn.type = "button";
        startBtn.className = "secondary-button";
        startBtn.textContent = "Подключить Telegram";
        startBtn.addEventListener("click", startTanbotLink);
        tanbotActions.appendChild(startBtn);
      }
      if (d.pendingConfirmation) {
        var confirmBtn = document.createElement("button");
        confirmBtn.type = "button";
        confirmBtn.className = "primary-button";
        confirmBtn.textContent = "Подтвердить привязку";
        confirmBtn.addEventListener("click", function () {
          confirmTanbotLink(d.pendingConfirmation.attemptId);
        });
        tanbotActions.appendChild(confirmBtn);
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
          window.open(result.data.deepLink, "_blank", "noopener,noreferrer");
          api.setStatus(statusEl, "Откройте Telegram и вернитесь — страница обновит статус автоматически.", "success");
          loadTanbotTelegram();
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
    }, 400);
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
        api.setStatus(statusEl, "Telegram отключён.", "success");
        loadTanbotTelegram();
      }
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
