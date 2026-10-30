(function () {
  "use strict";

  var ORIGIN = window.location.origin;

  function capHeaders() {
    var cap = window.__TT_EXTERNAL_CAP__ || "";
    var est = new URLSearchParams(window.location.search).get("est") || "";
    var h = { Origin: ORIGIN };
    if (cap) h["X-TT-External-Cap"] = cap;
    if (est) h["X-TT-External-Est"] = est;
    return h;
  }

  function json(path, opts) {
    opts = opts || {};
    return fetch(ORIGIN + path, {
      method: opts.method || "GET",
      credentials: "same-origin",
      headers: Object.assign({ "Content-Type": "application/json" }, capHeaders(), opts.headers || {}),
      body: opts.body ? JSON.stringify(opts.body) : undefined,
    }).then(function (r) {
      return r.json().then(function (data) {
        return { response: r, data: data };
      });
    });
  }

  window.TanTrackerExternal = {
    fetchIntakeRecipients: function () {
      var q = new URLSearchParams(window.location.search);
      var qs = q.get("est") ? "est=" + encodeURIComponent(q.get("est")) : "cap=" + encodeURIComponent(q.get("cap") || window.__TT_EXTERNAL_CAP__ || "");
      return fetch("/api/tan-tracker/public/external/intake-recipients?" + qs, { credentials: "same-origin" }).then(function (r) {
        return r.json().then(function (data) {
          if (!r.ok) throw new Error((data && data.error && data.error.message) || "Список сотрудников недоступен.");
          return data.recipients || [];
        });
      });
    },
    refreshBootstrap: function () {
      var q = new URLSearchParams(window.location.search);
      var qs = q.get("est") ? "est=" + encodeURIComponent(q.get("est")) : "cap=" + encodeURIComponent(q.get("cap") || window.__TT_EXTERNAL_CAP__ || "");
      return fetch("/api/tan-tracker/public/external/bootstrap?" + qs, { credentials: "same-origin" }).then(function (r) {
        return r.json().then(function (data) {
          if (!r.ok) throw new Error((data && data.error && data.error.message) || "Сессия недоступна.");
          window.__TT_LK_BOOTSTRAP__ = data;
          window.__TT_EXTERNAL_CAP__ = data.capability;
          if (window.TanTrackerPrototype && window.TanTrackerPrototype.hydrateFromServer) {
            window.TanTrackerPrototype.hydrateFromServer(data);
          }
          return data;
        });
      });
    },
    saveDraft: function (step, payload) {
      return json("/api/tan-tracker/public/external/request/draft", { method: "POST", body: { step: step, payload: payload } });
    },
    confirmDraft: function (draftId) {
      return json("/api/tan-tracker/public/external/request/confirm", { method: "POST", body: { draftId: draftId } });
    },
    uploadPhoto: function (draftId, file) {
      var q = "draftId=" + encodeURIComponent(draftId);
      var cap = capHeaders();
      return fetch(ORIGIN + "/api/tan-tracker/public/external/request/photo?" + q, {
        method: "POST",
        credentials: "same-origin",
        headers: Object.assign(
          {
            Origin: ORIGIN,
            "X-TT-Filename": encodeURIComponent(file.name || "photo.jpg"),
            "X-TT-Mime-Type": file.type || "application/octet-stream",
          },
          cap,
        ),
        body: file,
      }).then(function (r) {
        return r.json().then(function (data) {
          if (!r.ok) throw new Error((data && data.error && data.error.message) || "Не удалось загрузить фото.");
          return data;
        });
      });
    },
    logoutAll: function () {
      return json("/api/tan-tracker/public/external/logout-all", { method: "POST", body: {} });
    },
    registryCleanup: function (payload) {
      return json("/api/tan-tracker/public/external/registry/cleanup", { method: "POST", body: payload }).then(
        function (result) {
          if (result.response.status !== 200 || !result.data || result.data.ok !== true) {
            var msg =
              (result.data && result.data.error && result.data.error.message) || "Не удалось выполнить действие.";
            throw new Error(msg);
          }
          return result.data;
        },
      );
    },
    attachmentUrl: function (transferId, attId, preview) {
      var q = new URLSearchParams(window.location.search);
      var cap = q.get("cap") || window.__TT_EXTERNAL_CAP__ || "";
      var est = q.get("est") || "";
      var p =
        "/api/tan-tracker/public/external/attachments/" +
        encodeURIComponent(attId) +
        "?transferId=" +
        encodeURIComponent(transferId);
      if (est) p += "&est=" + encodeURIComponent(est);
      else if (cap) p += "&cap=" + encodeURIComponent(cap);
      if (preview) p += "&preview=thumb";
      return p;
    },
  };
})();
