(function () {
  "use strict";

  var api = window.TandoorRf;

  function mountBell(host) {
    if (!host || !api || !api.apiRequest) return;
    host.innerHTML =
      '<button type="button" class="tt-notif-bell" id="tt-notif-bell" aria-label="Уведомления Тан-трекера"><span id="tt-notif-count" hidden></span></button>' +
      '<div id="tt-notif-panel" class="tt-notif-panel" hidden></div>';
    var bell = document.getElementById("tt-notif-bell");
    var panel = document.getElementById("tt-notif-panel");
    var countEl = document.getElementById("tt-notif-count");

    function render(items) {
      if (!panel) return;
      if (!items.length) {
        panel.innerHTML = "<p class=\"tt-muted\">Нет уведомлений.</p>";
        return;
      }
      panel.innerHTML = items
        .map(function (it) {
          return (
            "<article class=\"tt-notif-item\" data-id=\"" +
            it.id +
            "\"><strong>" +
            it.title +
            "</strong><p>" +
            it.body +
            "</p></article>"
          );
        })
        .join("");
    }

    function refresh() {
      return api.apiRequest("/api/tan-tracker/notifications?unread=1").then(function (result) {
        if (result.response.status !== 200 || !result.data) return;
        var items = result.data.items || [];
        if (countEl) {
          if (items.length) {
            countEl.hidden = false;
            countEl.textContent = String(items.length);
          } else {
            countEl.hidden = true;
          }
        }
        render(items);
      });
    }

    if (bell && panel) {
      bell.addEventListener("click", function () {
        panel.hidden = !panel.hidden;
        if (!panel.hidden) {
          void api
            .apiRequest("/api/tan-tracker/notifications", { method: "GET" })
            .then(function (result) {
              if (result.response.status === 200 && result.data) render(result.data.items || []);
            });
        }
      });
    }

    void refresh();
    window.addEventListener("tandoor:tt-notifications-refresh", function () {
      void refresh();
    });
  }

  window.mountTanTrackerNotifications = mountBell;
})();
