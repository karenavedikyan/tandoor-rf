(function () {
  "use strict";

  var api = window.TandoorRf;
  var form = document.getElementById("login-form");
  var emailInput = document.getElementById("email");
  var passwordInput = document.getElementById("password");
  var togglePassword = document.getElementById("toggle-password");
  var loginButton = document.getElementById("login-button");
  var statusEl = document.getElementById("status-message");
  var submitting = false;

  if (!form || !emailInput || !passwordInput || !loginButton || !api) {
    return;
  }

  togglePassword?.addEventListener("click", function () {
    var isHidden = passwordInput.type === "password";
    passwordInput.type = isHidden ? "text" : "password";
    togglePassword.textContent = isHidden ? "Скрыть" : "Показать";
    togglePassword.setAttribute("aria-pressed", isHidden ? "true" : "false");
    togglePassword.setAttribute(
      "aria-label",
      isHidden ? "Скрыть пароль" : "Показать пароль",
    );
  });

  form.addEventListener("submit", function (event) {
    event.preventDefault();
    if (submitting) {
      return;
    }

    submitting = true;
    loginButton.disabled = true;
    api.setStatus(statusEl, "Вход…", "loading");

    api
      .apiRequest("/api/auth/login", {
        method: "POST",
        body: {
          email: emailInput.value,
          password: passwordInput.value,
        },
      })
      .then(function (result) {
        if (result.response.status === 200 && result.data && result.data.user) {
          window.location.href = "/profile";
          return;
        }

        if (result.response.status === 503) {
          api.setStatus(
            statusEl,
            api.extractErrorMessage(
              result.data,
              "Вход временно недоступен.",
            ),
            "error",
          );
          return;
        }

        if (result.response.status === 429) {
          var retryAfter = result.response.headers.get("Retry-After");
          api.setStatus(
            statusEl,
            retryAfter
              ? "Слишком много попыток. Повторите через " + retryAfter + " с."
              : api.extractErrorMessage(
                  result.data,
                  "Слишком много попыток входа.",
                ),
            "error",
          );
          return;
        }

        api.setStatus(
          statusEl,
          api.extractErrorMessage(
            result.data,
            "Неверный email или пароль.",
          ),
          "error",
        );
      })
      .catch(function (err) {
        api.setStatus(
          statusEl,
          api.mapRequestError(err, api.REQUEST_TIMEOUT_MS / 1000),
          "error",
        );
      })
      .finally(function () {
        submitting = false;
        loginButton.disabled = false;
      });
  });
})();
