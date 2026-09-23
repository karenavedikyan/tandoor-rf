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
      if (Array.from(probe.keys()).some(function (key) {
        return key !== "q" && key !== "manager" && key !== "holding" && key !== "phone" && key !== "page";
      })) {
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

  return {
    readStateFromSearch: readStateFromSearch,
    buildListQueryString: buildListQueryString,
    parseReturnQuery: parseReturnQuery,
    shouldAcceptListResponse: shouldAcceptListResponse,
    filterOptions: filterOptions,
  };
});
