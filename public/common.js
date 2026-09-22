(function () {
  "use strict";

  var REQUEST_TIMEOUT_MS = 10000;

  function setStatus(el, text, kind) {
    if (!el) {
      return;
    }
    el.textContent = text;
    el.className = "status" + (kind ? " status--" + kind : "");
  }

  function parseJsonSafe(text) {
    try {
      return JSON.parse(text);
    } catch (_err) {
      return null;
    }
  }

  function extractErrorMessage(data, fallback) {
    if (data && data.error) {
      if (typeof data.error === "string") {
        return data.error;
      }
      if (typeof data.error.message === "string") {
        return data.error.message;
      }
    }
    return fallback;
  }

  function apiRequest(path, options) {
    var controller = new AbortController();
    var timeoutId = setTimeout(function () {
      controller.abort();
    }, REQUEST_TIMEOUT_MS);

    var headers = Object.assign(
      {
        Accept: "application/json",
      },
      options && options.headers ? options.headers : {},
    );

    if (options && options.body !== undefined) {
      headers["Content-Type"] = "application/json";
    }

    return fetch(path, {
      method: (options && options.method) || "GET",
      headers: headers,
      body:
        options && options.body !== undefined
          ? JSON.stringify(options.body)
          : undefined,
      credentials: "same-origin",
      signal: controller.signal,
    })
      .then(function (response) {
        return response.text().then(function (text) {
          return {
            response: response,
            data: parseJsonSafe(text),
            text: text,
          };
        });
      })
      .finally(function () {
        clearTimeout(timeoutId);
      });
  }

  function mapRequestError(err, timeoutSec) {
    if (err && err.name === "AbortError") {
      return "Превышено время ожидания ответа (" + timeoutSec + " с).";
    }
    if (err instanceof TypeError) {
      return "Ошибка сети: не удалось связаться с сервером.";
    }
    return (err && err.message) || "Неизвестная ошибка.";
  }

  window.TandoorRf = {
    REQUEST_TIMEOUT_MS: REQUEST_TIMEOUT_MS,
    setStatus: setStatus,
    apiRequest: apiRequest,
    extractErrorMessage: extractErrorMessage,
    mapRequestError: mapRequestError,
  };
})();
