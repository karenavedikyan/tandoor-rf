(function () {
  "use strict";

  var REQUEST_TIMEOUT_MS = 10000;
  var EXPECTED = { status: "ok", app: "tandoor-rf" };

  var button = document.getElementById("check-button");
  var statusEl = document.getElementById("status-message");

  if (!button || !statusEl) {
    return;
  }

  function setStatus(text, kind) {
    statusEl.textContent = text;
    statusEl.className = "status" + (kind ? " status--" + kind : "");
  }

  function validateHealthPayload(data) {
    return (
      data &&
      typeof data === "object" &&
      data.status === EXPECTED.status &&
      data.app === EXPECTED.app
    );
  }

  button.addEventListener("click", function () {
    button.disabled = true;
    setStatus("Проверка…", "loading");

    var controller = new AbortController();
    var timeoutId = setTimeout(function () {
      controller.abort();
    }, REQUEST_TIMEOUT_MS);

    fetch("/api/health", {
      method: "GET",
      headers: { Accept: "application/json" },
      signal: controller.signal,
    })
      .then(function (response) {
        if (response.status !== 200) {
          throw new Error(
            "Сервер вернул неожиданный код: " + response.status,
          );
        }
        return response.text();
      })
      .then(function (text) {
        var data;
        try {
          data = JSON.parse(text);
        } catch (_err) {
          throw new Error("Ответ сервера не является корректным JSON.");
        }
        if (!validateHealthPayload(data)) {
          throw new Error("Ответ сервера не соответствует ожидаемому формату.");
        }
        setStatus("Сервер работает: status=ok, app=tandoor-rf", "success");
      })
      .catch(function (err) {
        if (err.name === "AbortError") {
          setStatus(
            "Превышено время ожидания ответа (" +
              REQUEST_TIMEOUT_MS / 1000 +
              " с).",
            "error",
          );
        } else if (err instanceof TypeError) {
          setStatus("Ошибка сети: не удалось связаться с сервером.", "error");
        } else {
          setStatus(err.message || "Неизвестная ошибка.", "error");
        }
      })
      .finally(function () {
        clearTimeout(timeoutId);
        button.disabled = false;
      });
  });
})();
