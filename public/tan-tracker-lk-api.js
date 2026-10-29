(function () {
  "use strict";

  var api = window.TandoorRf;
  var ORIGIN = window.location.origin;

  function jsonFetch(path, options) {
    var headers = Object.assign({ Origin: ORIGIN }, options.headers || {});
    if (options.body !== undefined && !(options.body instanceof FormData)) {
      headers["Content-Type"] = "application/json";
    }
    return fetch(ORIGIN + path, {
      method: options.method || "GET",
      credentials: options.credentials || "same-origin",
      headers: headers,
      body:
        options.body === undefined
          ? undefined
          : options.body instanceof FormData
            ? options.body
            : JSON.stringify(options.body),
    }).then(function (response) {
      return response.json().then(function (data) {
        return { response: response, data: data };
      });
    });
  }

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

  function applyBootstrapWithCode(bootstrap, transferId, codePayload) {
    if (bootstrap && window.TanTrackerPrototype && window.TanTrackerPrototype.hydrateFromServer) {
      window.TanTrackerPrototype.hydrateFromServer(bootstrap, {
        preserveCode: { transferId: transferId, code: codePayload },
      });
    }
  }

  function invitationPayloadFromOrder(order, ticket) {
    var inv = order.activeInvitation;
    var hv = ticket && ticket.hv != null ? Number(ticket.hv) : inv && inv.hv;
    var pendingId = (ticket && ticket.rcv) || (inv && inv.pendingId);
    if (ticket && ticket.tok) {
      return { invitationToken: ticket.tok };
    }
    if (inv && inv.invitationToken) {
      return { invitationToken: inv.invitationToken };
    }
    return {
      transferId: order.id,
      hv: hv,
      pendingPartyId: pendingId,
    };
  }

  window.TanTrackerLk = {
    uploadStagingFile: function (file) {
      return fetch(ORIGIN + "/api/tan-tracker/staging-attachments", {
        method: "POST",
        credentials: "same-origin",
        headers: {
          Origin: ORIGIN,
          "X-TT-Filename": encodeURIComponent(file.name),
          "X-TT-Mime-Type": file.type || "application/octet-stream",
        },
        body: file,
      }).then(function (response) {
        return response.text().then(function (text) {
          var data = null;
          try {
            data = text ? JSON.parse(text) : null;
          } catch (_err) {
            data = null;
          }
          if (!response.ok) {
            var msg =
              (data && data.error && data.error.message) ||
              (response.status >= 500
                ? "Ошибка сервера при загрузке файла."
                : "Не удалось загрузить файл.");
            if (!data && text) msg += " Ответ сервера не в формате JSON.";
            throw new Error(msg);
          }
          if (!data) {
            throw new Error("Некорректный ответ сервера при загрузке файла.");
          }
          return data;
        });
      });
    },
    updateTransferDraft: function (transferId, payload) {
      return api
        .apiRequest("/api/tan-tracker/transfers/" + encodeURIComponent(transferId) + "/draft-edit", {
          method: "POST",
          body: payload,
        })
        .then(function (result) {
          if (result.response.status === 200 && result.data && result.data.bootstrap) {
            window.TanTrackerPrototype.hydrateFromServer(result.data.bootstrap);
            return { transferId: transferId, refreshFailed: false };
          }
          throw new Error(api.extractErrorMessage(result.data, "Не удалось сохранить изменения."));
        });
    },
    createTransfer: function (payload) {
      return api
        .apiRequest("/api/tan-tracker/transfers", { method: "POST", body: payload })
        .then(function (result) {
          if (result.response.status !== 201 || !result.data || !result.data.publicCode) {
            var fallback = "Не удалось создать передачу.";
            if (!result.data && result.text) {
              fallback = "Не удалось создать передачу (ответ сервера не JSON).";
            }
            throw new Error(api.extractErrorMessage(result.data, fallback));
          }
          var publicCode = result.data.publicCode;
          if (result.data.bootstrap) {
            window.TanTrackerPrototype.hydrateFromServer(result.data.bootstrap);
            return { publicCode: publicCode, refreshFailed: false };
          }
          if (result.data.refreshRequired) {
            return refreshBootstrap()
              .then(function () {
                return { publicCode: publicCode, refreshFailed: false };
              })
              .catch(function (refreshErr) {
                return {
                  publicCode: publicCode,
                  refreshFailed: true,
                  refreshError:
                    (refreshErr && refreshErr.message) || "Не удалось обновить данные после создания.",
                };
              });
          }
          return { publicCode: publicCode, refreshFailed: false };
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
    generateHandoffCode: function (transferId, publicOpts) {
      if (window.__TT_PUBLIC_RECIPIENT__ && publicOpts && publicOpts.invitationToken) {
        return jsonFetch("/api/tan-tracker/public/recipient/code/generate", {
          method: "POST",
          body: {
            invitationToken: publicOpts.invitationToken,
            phoneSessionToken: publicOpts.phoneSessionToken,
          },
        }).then(function (result) {
          if (result.response.status !== 200 || !result.data || !result.data.code) {
            throw new Error(api.extractErrorMessage(result.data, "Не удалось выпустить код."));
          }
          var order = window.TanTrackerPrototype.orders().find(function (x) {
            return x.id === transferId;
          });
          if (order) {
            order.code = {
              code: result.data.code,
              expiresAt: result.data.expiresAt,
              attempts: 0,
              used: false,
              forContact: order.pendingId,
            };
          }
          return result.data;
        });
      }
      return api
        .apiRequest("/api/tan-tracker/transfers/" + encodeURIComponent(transferId) + "/code/generate", {
          method: "POST",
          body: {},
        })
        .then(function (result) {
          if (result.response.status === 200 && result.data && result.data.code) {
            var codePayload = {
              code: result.data.code,
              expiresAt: result.data.expiresAt,
              attempts: 0,
              used: false,
            };
            applyBootstrapWithCode(result.data.bootstrap, transferId, codePayload);
            return result.data;
          }
          throw new Error(api.extractErrorMessage(result.data, "Не удалось выпустить код."));
        });
    },
    publicHolderSendToFinal: function (holderAccessToken) {
      return jsonFetch("/api/tan-tracker/public/holder/send-to-final", {
        method: "POST",
        body: { holderAccessToken: holderAccessToken },
      }).then(function (result) {
        if (result.response.status !== 200 || !result.data) {
          throw new Error(api.extractErrorMessage(result.data, "Не удалось назначить получателя."));
        }
        return result.data;
      });
    },
    publicHolderChangePending: function (holderAccessToken, pendingPartyId, external) {
      var body = { holderAccessToken: holderAccessToken };
      if (external && (external.name || external.phone)) {
        body.external = external;
      } else {
        body.pendingPartyId = pendingPartyId;
      }
      return jsonFetch("/api/tan-tracker/public/holder/pending/change", {
        method: "POST",
        body: body,
      }).then(function (result) {
        if (result.response.status !== 200 || !result.data) {
          throw new Error(api.extractErrorMessage(result.data, "Не удалось назначить получателя."));
        }
        return result.data;
      });
    },
    publicHolderUploadStagingFile: function (holderAccessToken, file) {
      var url =
        "/api/tan-tracker/public/holder/staging-attachments?holderAccessToken=" +
        encodeURIComponent(holderAccessToken);
      return fetch(ORIGIN + url, {
        method: "POST",
        credentials: "same-origin",
        headers: {
          Origin: ORIGIN,
          "X-TT-Filename": encodeURIComponent(file.name),
          "X-TT-Mime-Type": file.type || "application/octet-stream",
        },
        body: file,
      }).then(function (response) {
        return response.json().then(function (data) {
          if (!response.ok) {
            throw new Error(
              (data && data.error && data.error.message) || "Не удалось загрузить файл.",
            );
          }
          return data;
        });
      });
    },
    publicHolderAddAttachments: function (holderAccessToken, stagingAttachmentIds) {
      return jsonFetch("/api/tan-tracker/public/holder/attachments", {
        method: "POST",
        body: { holderAccessToken: holderAccessToken, stagingAttachmentIds: stagingAttachmentIds },
      }).then(function (result) {
        if (result.response.status !== 200 || !result.data) {
          throw new Error(api.extractErrorMessage(result.data, "Не удалось сохранить файлы."));
        }
        return result.data;
      });
    },
    publicHolderDeleteAttachment: function (holderAccessToken, attachmentId) {
      var url =
        "/api/tan-tracker/public/holder/attachments/" +
        encodeURIComponent(attachmentId) +
        "?holderAccessToken=" +
        encodeURIComponent(holderAccessToken);
      return jsonFetch(url, { method: "DELETE" }).then(function (result) {
        if (result.response.status !== 200 || !result.data) {
          throw new Error(api.extractErrorMessage(result.data, "Не удалось удалить файл."));
        }
        return result.data;
      });
    },
    publicHolderVerifyCode: function (holderAccessToken, code) {
      return jsonFetch("/api/tan-tracker/public/holder/code/verify", {
        method: "POST",
        body: { holderAccessToken: holderAccessToken, code: code },
      }).then(function (result) {
        if (result.response.status !== 200 || !result.data) {
          throw new Error(api.extractErrorMessage(result.data, "Не удалось подтвердить код."));
        }
        return result.data;
      });
    },
    loadPublicHolderContext: function (holderAccessToken) {
      var url =
        "/api/tan-tracker/public/holder/context?holderAccessToken=" + encodeURIComponent(holderAccessToken);
      return jsonFetch(url, { method: "GET" }).then(function (result) {
        if (result.response.status !== 200) {
          throw new Error(api.extractErrorMessage(result.data, "Передача недоступна."));
        }
        return result.data;
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
    sendRecipientPhoneCode: function (order, ticket) {
      return jsonFetch("/api/tan-tracker/public/recipient/phone/send", {
        method: "POST",
        body: invitationPayloadFromOrder(order, ticket),
      }).then(function (result) {
        if (result.response.status !== 200) {
          throw new Error(
            api.extractErrorMessage(result.data, "Подтверждение телефона недоступно."),
          );
        }
        return true;
      });
    },
    verifyRecipientPhoneCode: function (order, ticket, code) {
      var body = invitationPayloadFromOrder(order, ticket);
      body.code = code;
      return jsonFetch("/api/tan-tracker/public/recipient/phone/verify", {
        method: "POST",
        body: body,
      }).then(function (result) {
        if (result.response.status !== 200 || !result.data.phoneSessionToken) {
          throw new Error(api.extractErrorMessage(result.data, "Неверный код подтверждения."));
        }
        return result.data.phoneSessionToken;
      });
    },
    confirmQrHandoff: function (order, ticket, phoneSessionToken) {
      var body = invitationPayloadFromOrder(order, ticket);
      body.phoneSessionToken = phoneSessionToken;
      return jsonFetch("/api/tan-tracker/public/recipient/handoff/qr-confirm", {
        method: "POST",
        body: body,
      }).then(function (result) {
        if (result.response.status !== 200) {
          throw new Error(api.extractErrorMessage(result.data, "Не удалось подтвердить получение."));
        }
        if (window.__TT_PUBLIC_RECIPIENT__) {
          return result.data && result.data.receipt ? result.data.receipt : { publicCode: order.id };
        }
        return refreshBootstrap();
      });
    },
    legacyCompleteTransfer: function (transferId) {
      return api
        .apiRequest(
          "/api/tan-tracker/transfers/" + encodeURIComponent(transferId) + "/legacy-complete",
          { method: "POST", body: {} },
        )
        .then(function (result) {
          if (result.response.status === 200 && result.data && result.data.bootstrap) {
            window.TanTrackerPrototype.hydrateFromServer(result.data.bootstrap);
            return true;
          }
          throw new Error(api.extractErrorMessage(result.data, "Не удалось завершить передачу."));
        });
    },
    addTransferAttachments: function (transferId, stagingAttachmentIds) {
      return api
        .apiRequest(
          "/api/tan-tracker/transfers/" + encodeURIComponent(transferId) + "/attachments",
          { method: "POST", body: { stagingAttachmentIds: stagingAttachmentIds } },
        )
        .then(function (result) {
          if (result.response.status === 200 && result.data && result.data.bootstrap) {
            window.TanTrackerPrototype.hydrateFromServer(result.data.bootstrap);
            return true;
          }
          throw new Error(api.extractErrorMessage(result.data, "Не удалось прикрепить файлы."));
        });
    },
    deleteTransferAttachment: function (transferId, attachmentId) {
      return api
        .apiRequest(
          "/api/tan-tracker/transfers/" +
            encodeURIComponent(transferId) +
            "/attachments/" +
            encodeURIComponent(attachmentId),
          { method: "DELETE", body: {} },
        )
        .then(function (result) {
          if (result.response.status === 200 && result.data && result.data.bootstrap) {
            window.TanTrackerPrototype.hydrateFromServer(result.data.bootstrap);
            return true;
          }
          throw new Error(api.extractErrorMessage(result.data, "Не удалось удалить файл."));
        });
    },
  };
})();
