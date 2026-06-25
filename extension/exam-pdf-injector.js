(function () {
  var scriptId = "sicnu-exam-pdf-fix-main-world";
  document.documentElement.setAttribute("data-sicnu-exam-pdf-bridge", "1");

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
    script.src = getRuntimeUrl("exam-pdf-patch.js");
    script.onload = function () {
      script.remove();
    };
    root.appendChild(script);
  }

  window.addEventListener("sicnu-exam-pdf-request", function (event) {
    var detail = event.detail || {};
    var requestId = detail.requestId;
    if (!requestId) {
      return;
    }

    chrome.runtime.sendMessage({
      type: "sicnu-exam-pdf",
      requestId: requestId,
      payload: detail.payload
    }, function (response) {
      var error = chrome.runtime.lastError ? chrome.runtime.lastError.message : null;
      window.dispatchEvent(new CustomEvent("sicnu-exam-pdf-response", {
        detail: {
          requestId: requestId,
          response: response || null,
          error: error
        }
      }));
    });
  }, false);

  inject();
  window.addEventListener("pageshow", inject, false);
})();
