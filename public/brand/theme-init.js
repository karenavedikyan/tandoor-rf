(function () {
  "use strict";
  var theme;
  try {
    theme = window.localStorage.getItem("tandoor-rf-theme");
  } catch (_err) { /* Private browsing can disable storage. */ }
  if (theme !== "light" && theme !== "dark") {
    theme = window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches
      ? "dark" : "light";
  }
  document.documentElement.setAttribute("data-theme", theme);
  document.documentElement.style.colorScheme = theme;
})();
