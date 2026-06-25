(function () {
  var scriptId = "sicnu-webforms-fix-main-world";

  function getRuntimeUrl(path) {
    if (typeof browser !== "undefined" && browser.runtime && browser.runtime.getURL) {
      return browser.runtime.getURL(path);
    }
    return chrome.runtime.getURL(path);
  }

  function inject() {
    var root = document.documentElement || document.head || document.body;
    if (!root || document.getElementById(scriptId)) {
      return;
    }

    var script = document.createElement("script");
    script.id = scriptId;
    script.src = getRuntimeUrl("webforms-patch.js");
    script.onload = function () {
      script.remove();
    };
    root.appendChild(script);
  }

  inject();
  window.addEventListener("pageshow", inject, false);
})();
