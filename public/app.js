(function () {
  "use strict";
  window.TandoorRf.apiRequest("/api/auth/me").then(function (result) {
    if (result.response.status === 200 && result.data && result.data.user) {
      var user = result.data.user;
      window.location.replace(user.mustChangePassword ? "/change-password" :
        window.ClientsShell.canReadClients(user) ? "/clients" : "/profile");
    } else if (result.response.status === 401) {
      window.location.replace("/login");
    } else {
      window.TandoorRf.setStatus(document.getElementById("status-message"), "Кабинет временно недоступен. Попробуйте войти ещё раз.", "error");
    }
  }).catch(function () {
    window.TandoorRf.setStatus(document.getElementById("status-message"), "Не удалось связаться с сервером. Проверьте подключение и повторите вход.", "error");
  });
})();
