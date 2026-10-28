(function () {
  "use strict";

  /** Minimal v2.js surface required by site/tan-tracker.js (tt56). */
  window.screens = window.screens || [];
  window.add = function add() {};
  window.current = "tan-tracker";
  window.roleNav = function roleNav(items) {
    return items;
  };
  window.render = function render() {
    if (window.__ttLkRenderTracker) window.__ttLkRenderTracker();
  };

  window.$ = function $(sel) {
    return document.querySelector(sel);
  };
})();
