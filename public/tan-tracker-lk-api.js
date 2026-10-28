(function () {
  "use strict";

  var api = window.TandoorRf;

  function refreshBootstrap() {
    return api.apiRequest("/api/tan-tracker/bootstrap").then(function (result) {
      if (result.response.status !== 200 || !result.data) {
        throw new Error(api.extractErrorMessage(result.data, "Не удалось обновить данные."));
      }
      window.__TT_LK_BOOTSTRAP__ = result.data;
      if (window.TanTrackerPrototype && window.TanTrackerPrototype.hydrateFromServer) {
        window.TanTrackerPrototype.hydrateFromServer(result.data);
      }
      return result.data;
    });
  }

  window.TanTrackerLk = {
    createTransfer: function (payload) {
      return api
        .apiRequest("/api/tan-tracker/transfers", { method: "POST", body: payload })
        .then(function (result) {
          if (result.response.status === 201 && result.data && result.data.bootstrap) {
            window.TanTrackerPrototype.hydrateFromServer(result.data.bootstrap);
            return result.data.publicCode;
          }
          throw new Error(api.extractErrorMessage(result.data, "Не удалось создать передачу."));
        });
    },
    verifyHandoffCode: function (transferId, code) {
      return api
        .apiRequest("/api/tan-tracker/transfers/" + encodeURIComponent(transferId) + "/code/verify", {
          method: "POST",
          body: { code: code },
        })
        .then(function (result) {
          if (result.response.status === 200 && result.data && result.data.bootstrap) {
            window.TanTrackerPrototype.hydrateFromServer(result.data.bootstrap);
            return true;
          }
          throw new Error(api.extractErrorMessage(result.data, "Неверный код."));
        });
    },
    generateHandoffCode: function (transferId) {
      return api
        .apiRequest("/api/tan-tracker/transfers/" + encodeURIComponent(transferId) + "/code/generate", {
          method: "POST",
          body: {},
        })
        .then(function (result) {
          if (result.response.status === 200 && result.data) {
            if (result.data.bootstrap) {
              window.TanTrackerPrototype.hydrateFromServer(result.data.bootstrap);
            }
            return result.data;
          }
          throw new Error(api.extractErrorMessage(result.data, "Не удалось выпустить код."));
        });
    },
    cancelPending: function (transferId) {
      return api
        .apiRequest("/api/tan-tracker/transfers/" + encodeURIComponent(transferId) + "/pending/cancel", {
          method: "POST",
          body: {},
        })
        .then(function (result) {
          if (result.response.status === 200 && result.data && result.data.bootstrap) {
            window.TanTrackerPrototype.hydrateFromServer(result.data.bootstrap);
            return true;
          }
          throw new Error(api.extractErrorMessage(result.data, "Не удалось отменить ожидание."));
        });
    },
    changePending: function (transferId, pendingPartyId) {
      return api
        .apiRequest("/api/tan-tracker/transfers/" + encodeURIComponent(transferId) + "/pending/change", {
          method: "POST",
          body: { pendingPartyId: pendingPartyId },
        })
        .then(function (result) {
          if (result.response.status === 200 && result.data && result.data.bootstrap) {
            window.TanTrackerPrototype.hydrateFromServer(result.data.bootstrap);
            return true;
          }
          throw new Error(api.extractErrorMessage(result.data, "Не удалось сменить получателя."));
        });
    },
    refreshBootstrap: refreshBootstrap,
  };
})();
