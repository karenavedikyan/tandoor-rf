(function (root, factory) {
  if (typeof module === "object" && module.exports) {
    module.exports = factory();
  } else {
    root.ClientsLogic = factory();
  }
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  function readStateFromSearch(search) {
    var params = new URLSearchParams(search || "");
    return {
      q: params.get("q") || "",
      manager: params.get("manager") || "",
      holding: params.get("holding") || "",
      phone: params.get("phone") || "all",
      page: Math.max(1, Number(params.get("page") || "1") || 1),
    };
  }

  function buildListQueryString(state) {
    var params = new URLSearchParams();
    if (state.q) params.set("q", state.q);
    if (state.manager) params.set("manager", state.manager);
    if (state.holding) params.set("holding", state.holding);
    if (state.phone && state.phone !== "all") params.set("phone", state.phone);
    if (state.page > 1) params.set("page", String(state.page));
    return params.toString();
  }

  function parseReturnQuery(search) {
    var params = new URLSearchParams(search || "");
    var value = params.get("return");
    if (typeof value !== "string" || value === "") {
      return "";
    }
    if (!value.startsWith("?")) {
      return "";
    }
    try {
      var probe = new URLSearchParams(value.slice(1));
      if (
        Array.from(probe.keys()).some(function (key) {
          return key !== "q" && key !== "manager" && key !== "holding" && key !== "phone" && key !== "page";
        })
      ) {
        return "";
      }
      return value;
    } catch (_err) {
      return "";
    }
  }

  function shouldAcceptListResponse(requestId, activeRequestId) {
    return requestId === activeRequestId;
  }

  function shouldAcceptDetailResponse(requestId, activeRequestId) {
    return requestId === activeRequestId;
  }

  function filterOptions(items, query) {
    var normalized = (query || "").trim().toLowerCase();
    if (!normalized) {
      return items.slice();
    }
    return items.filter(function (item) {
      var haystack = (item.name + " " + item.shortId).toLowerCase();
      return haystack.indexOf(normalized) !== -1;
    });
  }

  function optionLabel(item) {
    return item.name + " · " + item.shortId;
  }

  function createComboboxModel() {
    return {
      selectedId: "",
      searchText: "",
      activeIndex: -1,
      open: false,
    };
  }

  function comboboxLabelForId(selectedId, options) {
    if (!selectedId) {
      return "";
    }
    var match = options.find(function (item) {
      return item.id === selectedId;
    });
    return match ? optionLabel(match) : selectedId.slice(0, 8).toUpperCase();
  }

  function comboboxApplyFromUrl(model, selectedId, options) {
    model.selectedId = selectedId || "";
    model.searchText = comboboxLabelForId(model.selectedId, options);
    model.activeIndex = -1;
    model.open = false;
    return model;
  }

  function comboboxOnInput(model, value) {
    model.searchText = value;
    model.selectedId = "";
    model.activeIndex = -1;
    model.open = true;
    return model;
  }

  function comboboxOnBlur(model, options) {
    model.searchText = comboboxLabelForId(model.selectedId, options);
    model.activeIndex = -1;
    model.open = false;
    return model;
  }

  function comboboxSelect(model, selectedId, options) {
    model.selectedId = selectedId || "";
    model.searchText = comboboxLabelForId(model.selectedId, options);
    model.activeIndex = -1;
    model.open = false;
    return model;
  }

  function comboboxListEntries(options, query, allLabel) {
    var entries = [{ id: "", label: allLabel }];
    filterOptions(options, query).forEach(function (item) {
      entries.push({ id: item.id, label: optionLabel(item) });
    });
    return entries;
  }

  function comboboxMoveActive(model, entryCount, delta) {
    if (entryCount <= 0) {
      model.activeIndex = -1;
      return model;
    }
    if (model.activeIndex < 0) {
      model.activeIndex = delta > 0 ? 0 : entryCount - 1;
      return model;
    }
    model.activeIndex = (model.activeIndex + delta + entryCount) % entryCount;
    return model;
  }

  function createDetailController(deps) {
    var pageGuid = null;
    var activeRequestId = 0;

    function parseGuidOrShowError() {
      pageGuid = deps.parseGuidFromPath();
      if (!pageGuid) {
        deps.showInvalidGuid();
        return false;
      }
      return true;
    }

    function loadClient() {
      if (!pageGuid) {
        return Promise.resolve();
      }
      activeRequestId += 1;
      var requestId = activeRequestId;
      deps.showLoading();
      return deps
        .fetchClient(pageGuid)
        .then(function (result) {
          if (!shouldAcceptDetailResponse(requestId, activeRequestId)) {
            return;
          }
          return deps.handleClientResult(result);
        })
        .catch(function (err) {
          if (!shouldAcceptDetailResponse(requestId, activeRequestId)) {
            return;
          }
          deps.showClientError(err, function onRetry() {
            loadClient().catch(function (retryErr) {
              deps.showClientError(retryErr, onRetry);
            });
          });
        });
    }

    function ensureAccessAndLoad() {
      return new Promise(function (resolve, reject) {
        deps
          .ensureAdminAccess(function (_user, reason) {
            if (reason) {
              deps.handleAccessReason(reason, function onRetry() {
                ensureAccessAndLoad().then(resolve, reject);
              });
              return;
            }
            loadClient().then(resolve, reject);
          })
          .catch(reject);
      });
    }

    function bootstrap() {
      if (!parseGuidOrShowError()) {
        return Promise.resolve();
      }
      return ensureAccessAndLoad().catch(function (err) {
        deps.showInitError(err, function onRetry() {
          ensureAccessAndLoad().catch(function (retryErr) {
            deps.showInitError(retryErr, onRetry);
          });
        });
      });
    }

    return {
      bootstrap: bootstrap,
      ensureAccessAndLoad: ensureAccessAndLoad,
      loadClient: loadClient,
      getPageGuid: function () {
        return pageGuid;
      },
    };
  }

  function mountCombobox(config) {
    var model = config.model;
    var input = config.input;
    var hidden = config.hidden;
    var listEl = config.listEl;
    var options = config.options;
    var allLabel = config.allLabel;
    var listboxId = config.listboxId;
    var onApplySelection = config.onApplySelection;

    function syncDom() {
      input.value = model.searchText;
      hidden.value = model.selectedId;
      input.setAttribute("aria-expanded", model.open ? "true" : "false");
    }

    var ownerDocument = config.root.ownerDocument || (typeof document !== "undefined" ? document : null);

    function renderList() {
      var entries = comboboxListEntries(options(), model.searchText, allLabel);
      listEl.innerHTML = "";
      entries.forEach(function (entry, index) {
        var li = (ownerDocument || listEl.ownerDocument).createElement("li");
        li.className = "clients-combobox__option";
        li.setAttribute("role", "option");
        li.id = listboxId + "-opt-" + index;
        li.dataset.value = entry.id;
        li.textContent = entry.label;
        if (index === model.activeIndex) {
          li.classList.add("is-active");
          li.setAttribute("aria-selected", "true");
          input.setAttribute("aria-activedescendant", li.id);
        } else {
          li.setAttribute("aria-selected", "false");
        }
        listEl.appendChild(li);
      });
      listEl.classList.toggle("clients-hidden", !model.open);
      if (model.activeIndex < 0) {
        input.removeAttribute("aria-activedescendant");
      }
      return entries;
    }

    function openList() {
      model.open = true;
      renderList();
      syncDom();
    }

    function closeList(restoreLabel) {
      if (restoreLabel) {
        comboboxOnBlur(model, options());
      }
      model.open = false;
      model.activeIndex = -1;
      listEl.classList.add("clients-hidden");
      input.setAttribute("aria-expanded", "false");
      input.removeAttribute("aria-activedescendant");
      syncDom();
    }

    function applySelection(selectedId) {
      comboboxSelect(model, selectedId, options());
      syncDom();
      closeList(false);
      onApplySelection(model.selectedId);
    }

    input.addEventListener("focus", function () {
      openList();
    });

    input.addEventListener("input", function () {
      comboboxOnInput(model, input.value);
      syncDom();
      openList();
    });

    input.addEventListener("keydown", function (event) {
      var entries = comboboxListEntries(options(), model.searchText, allLabel);
      if (event.key === "ArrowDown") {
        event.preventDefault();
        model.open = true;
        comboboxMoveActive(model, entries.length, 1);
        renderList();
        return;
      }
      if (event.key === "ArrowUp") {
        event.preventDefault();
        model.open = true;
        comboboxMoveActive(model, entries.length, -1);
        renderList();
        return;
      }
      if (event.key === "Enter") {
        if (model.open && model.activeIndex >= 0 && entries[model.activeIndex]) {
          event.preventDefault();
          applySelection(entries[model.activeIndex].id);
        }
        return;
      }
      if (event.key === "Escape") {
        event.preventDefault();
        closeList(true);
        return;
      }
      if (event.key === "Tab") {
        closeList(true);
      }
    });

    listEl.addEventListener("mousedown", function (event) {
      var target = event.target;
      if (!target || typeof target.closest !== "function") {
        return;
      }
      var option = target.closest(".clients-combobox__option");
      if (!option) {
        return;
      }
      event.preventDefault();
      applySelection(option.dataset.value || "");
    });

    if (ownerDocument) {
      ownerDocument.addEventListener("click", function (event) {
        if (config.root.contains(event.target)) {
          return;
        }
        if (model.open) {
          closeList(true);
        }
      });
    }

    return {
      model: model,
      syncFromUrl: function (selectedId) {
        var activeElement =
          (input.ownerDocument && input.ownerDocument.activeElement) ||
          (typeof document !== "undefined" ? document.activeElement : null);
        if (model.open || activeElement === input) {
          model.selectedId = selectedId || "";
          hidden.value = model.selectedId;
          return;
        }
        comboboxApplyFromUrl(model, selectedId, options());
        syncDom();
      },
      reset: function () {
        comboboxSelect(model, "", options());
        syncDom();
        closeList(false);
      },
      syncDom: syncDom,
      renderList: renderList,
    };
  }

  return {
    readStateFromSearch: readStateFromSearch,
    buildListQueryString: buildListQueryString,
    parseReturnQuery: parseReturnQuery,
    shouldAcceptListResponse: shouldAcceptListResponse,
    shouldAcceptDetailResponse: shouldAcceptDetailResponse,
    filterOptions: filterOptions,
    optionLabel: optionLabel,
    createComboboxModel: createComboboxModel,
    comboboxApplyFromUrl: comboboxApplyFromUrl,
    comboboxOnInput: comboboxOnInput,
    comboboxOnBlur: comboboxOnBlur,
    comboboxSelect: comboboxSelect,
    comboboxListEntries: comboboxListEntries,
    comboboxMoveActive: comboboxMoveActive,
    createDetailController: createDetailController,
    mountCombobox: mountCombobox,
  };
});
