(function () {
  "use strict";

  var api = window.TandoorRf;
  var ORIGIN = window.location.origin;

  var STAGING_UPLOAD_TIMEOUT_MS = 120000;
  var MESSENGER_INVITE_TIMEOUT_MS = 45000;

  function setStagingUploadTimeoutForTests(ms) {
    STAGING_UPLOAD_TIMEOUT_MS = Math.max(1, Number(ms) || STAGING_UPLOAD_TIMEOUT_MS);
  }

  function setMessengerInviteTimeoutForTests(ms) {
    MESSENGER_INVITE_TIMEOUT_MS = Math.max(1, Number(ms) || MESSENGER_INVITE_TIMEOUT_MS);
  }

  function linkedAbortSignal(timeoutMs, externalSignal) {
    var controller = new AbortController();
    var timeoutId = setTimeout(function () {
      controller.abort();
    }, timeoutMs);
    function onExternalAbort() {
      controller.abort();
    }
    if (externalSignal) {
      if (externalSignal.aborted) {
        controller.abort();
      } else {
        externalSignal.addEventListener("abort", onExternalAbort);
      }
    }
    return {
      signal: controller.signal,
      abort: function () {
        controller.abort();
      },
      cleanup: function () {
        clearTimeout(timeoutId);
        if (externalSignal) {
          externalSignal.removeEventListener("abort", onExternalAbort);
        }
      },
    };
  }

  function mapStagingUploadFetchError(err, opts) {
    var timeoutSec = Math.round(STAGING_UPLOAD_TIMEOUT_MS / 1000);
    var externalSignal = opts && opts.signal;
    var hardTimeout = !!(err && err.ttHardTimeout);
    if (hardTimeout || (api.isAbortLikeError && api.isAbortLikeError(err))) {
      return new Error(
        "Превышено время ожидания загрузки файла (" +
          timeoutSec +
          " с). Можно выбрать файл ещё раз.",
      );
    }
    if (externalSignal && externalSignal.aborted) {
      return new Error("Загрузка отменена.");
    }
    if (err instanceof TypeError) {
      return new Error("Ошибка сети: не удалось загрузить файл.");
    }
    return err instanceof Error ? err : new Error("Не удалось загрузить файл.");
  }

  function postStagingAttachment(path, file, opts) {
    opts = opts || {};
    var linked = linkedAbortSignal(STAGING_UPLOAD_TIMEOUT_MS, opts.signal);
    var settled = false;
    return new Promise(function (resolve, reject) {
      var hardTimer = setTimeout(function () {
        if (settled) return;
        settled = true;
        linked.abort();
        linked.cleanup();
        reject(
          mapStagingUploadFetchError(
            Object.assign(new Error("staging-upload-timeout"), {
              name: "AbortError",
              ttHardTimeout: true,
            }),
            opts,
          ),
        );
      }, STAGING_UPLOAD_TIMEOUT_MS);

      fetch(ORIGIN + path, {
        method: "POST",
        credentials: "same-origin",
        headers: {
          Origin: ORIGIN,
          "X-TT-Filename": encodeURIComponent(file.name),
          "X-TT-Mime-Type": file.type || "application/octet-stream",
        },
        body: file,
        signal: linked.signal,
      })
        .then(function (response) {
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
        })
        .then(function (data) {
          if (settled) return;
          settled = true;
          clearTimeout(hardTimer);
          linked.cleanup();
          resolve(data);
        })
        .catch(function (err) {
          if (settled) return;
          settled = true;
          clearTimeout(hardTimer);
          linked.cleanup();
          reject(mapStagingUploadFetchError(err, opts));
        });
    });
  }

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
    uploadStagingFile: function (file, opts) {
      return postStagingAttachment("/api/tan-tracker/staging-attachments", file, opts);
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
    publicHolderUploadStagingFile: function (holderAccessToken, file, opts) {
      var url =
        "/api/tan-tracker/public/holder/staging-attachments?holderAccessToken=" +
        encodeURIComponent(holderAccessToken);
      return postStagingAttachment(url, file, opts);
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
    declineExternalRequest: function (transferId, reason) {
      return api
        .apiRequest(
          "/api/tan-tracker/transfers/" + encodeURIComponent(transferId) + "/external-decline",
          { method: "POST", body: { reason: reason || "" } },
        )
        .then(function (result) {
          if (result.response.status === 200 && result.data && result.data.bootstrap) {
            window.TanTrackerPrototype.hydrateFromServer(result.data.bootstrap);
            return true;
          }
          throw new Error(api.extractErrorMessage(result.data, "Не удалось отклонить заявку."));
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
    createExternalMessengerInvite: function (transferId) {
      var inviteTimeoutSec = Math.round(MESSENGER_INVITE_TIMEOUT_MS / 1000);
      var invitePath =
        "/api/tan-tracker/transfers/" + encodeURIComponent(transferId) + "/messenger-invite";
      var inviteRequest = api.apiRequest(invitePath, {
        method: "POST",
        body: {},
        timeoutMs: MESSENGER_INVITE_TIMEOUT_MS,
      });
      var inviteHardTimerId = null;
      var inviteHardTimeout = new Promise(function (_resolve, reject) {
        inviteHardTimerId = setTimeout(function () {
          reject(
            Object.assign(new Error("messenger-invite-timeout"), { name: "AbortError" }),
          );
        }, MESSENGER_INVITE_TIMEOUT_MS);
      });
      return Promise.race([inviteRequest, inviteHardTimeout])
        .then(function (result) {
          if (result.response.status === 201 && result.data && result.data.portalUrl) {
            return result.data;
          }
          throw new Error(
            api.extractErrorMessage(result.data, "Не удалось создать ссылку для мессенджера."),
          );
        })
        .catch(function (err) {
          if (
            err instanceof Error &&
            api.isAbortLikeError &&
            !api.isAbortLikeError(err) &&
            !(err instanceof TypeError)
          ) {
            throw err;
          }
          throw new Error(api.mapRequestError(err, inviteTimeoutSec));
        })
        .finally(function () {
          if (inviteHardTimerId) clearTimeout(inviteHardTimerId);
        });
    },
    setStagingUploadTimeoutForTests: setStagingUploadTimeoutForTests,
    setMessengerInviteTimeoutForTests: setMessengerInviteTimeoutForTests,
    savePersonalRecipientLabel: function (transferId, body) {
      return api
        .apiRequest(
          "/api/tan-tracker/transfers/" + encodeURIComponent(transferId) + "/personal-recipient-label",
          { method: "POST", body: body },
        )
        .then(function (result) {
          if (result.response.status === 200 && result.data && result.data.bootstrap) {
            window.TanTrackerPrototype.hydrateFromServer(result.data.bootstrap);
            return true;
          }
          throw new Error(api.extractErrorMessage(result.data, "Не удалось сохранить имя."));
        });
    },
    registryCleanup: function (payload) {
      return api
        .apiRequest("/api/tan-tracker/registry/cleanup", { method: "POST", body: payload })
        .then(function (result) {
          if (result.response.status !== 200 || !result.data || result.data.ok !== true) {
            throw new Error(api.extractErrorMessage(result.data, "Не удалось выполнить действие."));
          }
          return result.data;
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
