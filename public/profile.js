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

  var ROLE_LABELS = {
    admin: "Администратор",
    director: "Директор",
    rop: "РОП",
    regional_manager: "Региональный менеджер",
    manager: "Менеджер",
    marketer: "Маркетолог",
    analyst: "Аналитик",
    category_manager: "Категорийный менеджер",
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
      return result.data.user;
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
