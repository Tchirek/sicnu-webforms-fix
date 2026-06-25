chrome.runtime.onMessage.addListener(function (message, sender, sendResponse) {
  if (!message || message.type !== "sicnu-exam-pdf") {
    return false;
  }

  generatePdf(message.payload)
    .then(function (result) {
      sendResponse({ ok: true, result: result });
    })
    .catch(function (error) {
      sendResponse({
        ok: false,
        error: error && error.message ? error.message : String(error)
      });
    });

  return true;
});

async function generatePdf(payload) {
  if (!payload || !payload.contentHtml) {
    throw new Error("缺少可打印内容。");
  }

  var html = buildPrintDocument(payload);
  var url = "data:text/html;charset=utf-8," + encodeURIComponent(html);
  var tab = await createTab(url);
  var debuggee = { tabId: tab.id };

  try {
    await waitForTabComplete(tab.id);
    await sleep(800);
    await attachDebugger(debuggee);
    await sendDebuggerCommand(debuggee, "Page.enable", {});
    var pdf = await sendDebuggerCommand(debuggee, "Page.printToPDF", {
      landscape: payload.orientation === "landscape",
      printBackground: true,
      preferCSSPageSize: true,
      marginTop: 0,
      marginRight: 0,
      marginBottom: 0,
      marginLeft: 0,
      scale: 1
    });
    await detachDebugger(debuggee);
    await removeTab(tab.id);
    if (payload.preview) {
      var previewTabId = await previewPdf(pdf.data, payload.filename || "川师教务考试信息.pdf");
      return { previewTabId: previewTabId };
    }
    var downloadId = await downloadPdf(pdf.data, payload.filename || "川师教务考试信息.pdf");
    return { downloadId: downloadId };
  } catch (error) {
    try {
      await detachDebugger(debuggee);
    } catch (_) {}
    try {
      await removeTab(tab.id);
    } catch (_) {}
    throw error;
  }
}

function buildPrintDocument(payload) {
  var orientation = payload.orientation === "landscape" ? "landscape" : "portrait";
  var baseHref = escapeAttribute(payload.baseHref || "http://202.115.194.60/");
  var title = escapeHtml(payload.title || "川师教务考试信息");
  var stylesheetLinks = (payload.stylesheetHrefs || []).map(function (href) {
    return "<link rel=\"stylesheet\" href=\"" + escapeAttribute(href) + "\">";
  }).join("\n");
  var inlineStyles = (payload.inlineStyles || []).map(function (css) {
    return "<style>" + css + "</style>";
  }).join("\n");
  var watermark = payload.watermarkHref ? escapeCssUrl(payload.watermarkHref) : "";
  var watermarkCss = watermark
    ? ".sicnu-print-sheet:before{content:\"\";position:fixed;inset:0;background:url('" + watermark + "') center center / 72% auto no-repeat;z-index:0;pointer-events:none;}"
    : "";

  return "<!doctype html><html><head>" +
    "<meta charset=\"utf-8\">" +
    "<base href=\"" + baseHref + "\">" +
    "<title>" + title + "</title>" +
    stylesheetLinks +
    inlineStyles +
    "<style>" +
    "@page{size:A4 " + orientation + ";margin:0;}" +
    "html,body{margin:0!important;padding:0!important;background:#fff!important;color:#000!important;}" +
    "body{-webkit-print-color-adjust:exact!important;print-color-adjust:exact!important;}" +
    ".sicnu-print-sheet{box-sizing:border-box;position:relative;width:100%;min-height:100vh;padding:2%;background:#fff;color:#000;}" +
    watermarkCss +
    ".sicnu-print-content{position:relative;z-index:1;}" +
    "input,button,select,textarea,.btn_bg2{display:none!important;}" +
    "table{page-break-inside:auto;}" +
    "tr{page-break-inside:avoid;page-break-after:auto;}" +
    "td,th{-webkit-print-color-adjust:exact!important;print-color-adjust:exact!important;}" +
    "</style>" +
    "</head><body><div class=\"sicnu-print-sheet\"><div class=\"sicnu-print-content\">" +
    payload.contentHtml +
    "</div></div></body></html>";
}

function createTab(url) {
  return new Promise(function (resolve, reject) {
    chrome.tabs.create({ url: url, active: false }, function (tab) {
      var error = chrome.runtime.lastError;
      if (error) {
        reject(new Error(error.message));
      } else {
        resolve(tab);
      }
    });
  });
}

function waitForTabComplete(tabId) {
  return new Promise(function (resolve, reject) {
    var timeout = setTimeout(function () {
      chrome.tabs.onUpdated.removeListener(listener);
      reject(new Error("打印页加载超时。"));
    }, 20000);

    function listener(updatedTabId, changeInfo) {
      if (updatedTabId === tabId && changeInfo.status === "complete") {
        clearTimeout(timeout);
        chrome.tabs.onUpdated.removeListener(listener);
        resolve();
      }
    }

    chrome.tabs.onUpdated.addListener(listener);
    chrome.tabs.get(tabId, function (tab) {
      if (chrome.runtime.lastError) {
        clearTimeout(timeout);
        chrome.tabs.onUpdated.removeListener(listener);
        reject(new Error(chrome.runtime.lastError.message));
      } else if (tab && tab.status === "complete") {
        clearTimeout(timeout);
        chrome.tabs.onUpdated.removeListener(listener);
        resolve();
      }
    });
  });
}

function attachDebugger(debuggee) {
  return new Promise(function (resolve, reject) {
    chrome.debugger.attach(debuggee, "1.3", function () {
      var error = chrome.runtime.lastError;
      if (error) {
        reject(new Error(error.message));
      } else {
        resolve();
      }
    });
  });
}

function detachDebugger(debuggee) {
  return new Promise(function (resolve) {
    chrome.debugger.detach(debuggee, function () {
      resolve();
    });
  });
}

function sendDebuggerCommand(debuggee, method, params) {
  return new Promise(function (resolve, reject) {
    chrome.debugger.sendCommand(debuggee, method, params, function (result) {
      var error = chrome.runtime.lastError;
      if (error) {
        reject(new Error(error.message));
      } else {
        resolve(result);
      }
    });
  });
}

function removeTab(tabId) {
  return new Promise(function (resolve) {
    chrome.tabs.remove(tabId, function () {
      resolve();
    });
  });
}

function downloadPdf(base64, filename) {
  return new Promise(function (resolve, reject) {
    chrome.downloads.download({
      url: "data:application/pdf;base64," + base64,
      filename: sanitizeFilename(filename),
      saveAs: false
    }, function (downloadId) {
      var error = chrome.runtime.lastError;
      if (error) {
        reject(new Error(error.message));
      } else {
        resolve(downloadId);
      }
    });
  });
}

function previewPdf(base64, filename) {
  return new Promise(function (resolve, reject) {
    chrome.tabs.create({
      url: "data:application/pdf;base64," + base64,
      active: true
    }, function (tab) {
      var error = chrome.runtime.lastError;
      if (error) {
        reject(new Error(error.message));
      } else {
        resolve(tab.id);
      }
    });
  });
}

function sleep(ms) {
  return new Promise(function (resolve) {
    setTimeout(resolve, ms);
  });
}

function sanitizeFilename(filename) {
  return String(filename || "川师教务考试信息.pdf")
    .replace(/[\\/:*?"<>|]+/g, "-")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 180);
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"]/g, function (char) {
    return {
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      "\"": "&quot;"
    }[char];
  });
}

function escapeAttribute(value) {
  return escapeHtml(value).replace(/'/g, "&#39;");
}

function escapeCssUrl(value) {
  return String(value).replace(/[\\'")\n\r]/g, "");
}
