/*
 * 川师教务 · 后台（service worker）
 *
 * 收到导出请求后，用浏览器自身的打印引擎（CDP Page.printToPDF）把考试内容渲染成 PDF 并下载。
 *
 * 忠实复现：打印文档与 exam-print.js 的结构完全一致——A4 页、内容铺满纸张、加载页面自己的
 * 样式表，让浏览器自然排版。【不】锁宽度、【不】搬继承样式、【不】改媒体类型，这些“矫正”
 * 只会让结果偏离原页（已验证）。printToPDF 用默认打印媒体，与旧版导出方法一致。
 *
 * 下载无感：临时打印页放在【最小化、不聚焦的 popup 窗口】里，不会在标签栏多出标签页；
 * 打印媒体下排版只取决于 @page 纸张尺寸，与窗口是否可见、是否最小化无关。用 data: URL
 * （非安全上下文，可直接加载内网 http 样式表/图片），等其 load 完成再打印，无需估时。
 */
chrome.runtime.onMessage.addListener(function (message, _sender, sendResponse) {
  if (!message || message.type !== "sicnu-pdf") return false;
  exportPdf(message.payload)
    .then(function (result) { sendResponse({ ok: true, result: result }); })
    .catch(function (error) { sendResponse({ ok: false, error: error && error.message ? error.message : String(error) }); });
  return true; // 异步响应
});

async function exportPdf(payload) {
  if (!chrome.debugger) throw new Error("当前浏览器不支持 debugger 接口。");
  var html = buildDocument(payload);
  var win = await createHiddenWindow("data:text/html;charset=utf-8," + encodeURIComponent(html));
  var debuggee = { tabId: win.tabId };
  try {
    await tabComplete(win.tabId);
    await attach(debuggee);
    await command(debuggee, "Page.enable", {});
    var pdf = await command(debuggee, "Page.printToPDF", {
      landscape: payload.orientation === "landscape",
      printBackground: true,
      preferCSSPageSize: true,
      marginTop: 0, marginBottom: 0, marginLeft: 0, marginRight: 0,
      scale: 1
    });
    await detach(debuggee);
    await removeWindow(win.windowId);
    var downloadId = await downloadData("data:application/pdf;base64," + pdf.data, payload.filename);
    return { downloadId: downloadId };
  } catch (error) {
    // 失败时必须收尾：脱离调试器、关掉临时窗口，避免留下黄条和孤儿窗口。
    try { await detach(debuggee); } catch (_) {}
    try { await removeWindow(win.windowId); } catch (_) {}
    throw error;
  }
}

function buildDocument(payload) {
  var orientation = payload.orientation === "landscape" ? "landscape" : "portrait";
  var links = (payload.stylesheetHrefs || []).map(function (href) {
    return '<link rel="stylesheet" href="' + escapeAttr(href) + '">';
  }).join("");
  var styles = (payload.inlineStyles || []).map(function (css) { return "<style>" + css + "</style>"; }).join("");
  var wm = payload.watermarkHref ? escapeCssUrl(payload.watermarkHref) : "";
  // 与 exam-print.js 的 sheetCss 完全一致（旧版导出结构）。
  return '<!doctype html><html><head><meta charset="utf-8"><base href="' + escapeAttr(payload.baseHref || "http://202.115.194.60/") + '">' +
    "<title>" + escapeHtml(payload.title || "考试信息") + "</title>" + links + styles +
    "<style>" +
      "@page{size:A4 " + orientation + ";margin:0}" +
      "html,body{margin:0!important;padding:0!important;background:#fff!important;color:#000!important}" +
      "body{-webkit-print-color-adjust:exact!important;print-color-adjust:exact!important}" +
      ".sicnu-print-sheet{box-sizing:border-box;position:relative;width:100%;min-height:100vh;padding:2%;background:#fff;color:#000}" +
      ".sicnu-print-content{position:relative;z-index:1}" +
      "input,button,select,textarea,.btn_bg2{display:none!important}" +
      "table{page-break-inside:auto}tr{page-break-inside:avoid;page-break-after:auto}" +
      "td,th{-webkit-print-color-adjust:exact!important;print-color-adjust:exact!important}" +
      (wm ? ".sicnu-print-sheet:before{content:'';position:fixed;inset:0;background:url('" + wm + "') center center/72% auto no-repeat;z-index:0;pointer-events:none}" : "") +
    "</style></head>" +
    '<body><div class="sicnu-print-sheet"><div class="sicnu-print-content">' + (payload.contentHtml || "") + "</div></div></body></html>";
}

function createHiddenWindow(url) {
  return new Promise(function (resolve, reject) {
    chrome.windows.create({ url: url, type: "popup", focused: false, state: "minimized" }, function (w) {
      if (chrome.runtime.lastError || !w || !w.tabs || !w.tabs.length) {
        reject(new Error((chrome.runtime.lastError && chrome.runtime.lastError.message) || "无法创建打印窗口。"));
      } else {
        resolve({ windowId: w.id, tabId: w.tabs[0].id });
      }
    });
  });
}

function removeWindow(windowId) {
  return new Promise(function (resolve) { chrome.windows.remove(windowId, resolve); });
}

function tabComplete(tabId) {
  return new Promise(function (resolve) {
    function listener(id, info) {
      if (id === tabId && info.status === "complete") {
        chrome.tabs.onUpdated.removeListener(listener);
        resolve();
      }
    }
    chrome.tabs.onUpdated.addListener(listener);
    chrome.tabs.get(tabId, function (tab) {
      if (tab && tab.status === "complete") {
        chrome.tabs.onUpdated.removeListener(listener);
        resolve();
      }
    });
  });
}

function attach(debuggee) {
  return new Promise(function (resolve, reject) {
    chrome.debugger.attach(debuggee, "1.3", function () {
      chrome.runtime.lastError ? reject(new Error(chrome.runtime.lastError.message)) : resolve();
    });
  });
}

function detach(debuggee) {
  return new Promise(function (resolve) { chrome.debugger.detach(debuggee, resolve); });
}

function command(debuggee, method, params) {
  return new Promise(function (resolve, reject) {
    chrome.debugger.sendCommand(debuggee, method, params, function (result) {
      chrome.runtime.lastError ? reject(new Error(chrome.runtime.lastError.message)) : resolve(result);
    });
  });
}

function downloadData(url, filename) {
  return new Promise(function (resolve, reject) {
    chrome.downloads.download({ url: url, filename: sanitize(filename), saveAs: false }, function (id) {
      chrome.runtime.lastError ? reject(new Error(chrome.runtime.lastError.message)) : resolve(id);
    });
  });
}

function sanitize(filename) {
  return String(filename || "川师教务考试信息.pdf").replace(/[\\/:*?"<>|]+/g, "-").trim().slice(0, 180);
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"]/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]; });
}

function escapeAttr(value) { return escapeHtml(value).replace(/'/g, "&#39;"); }
function escapeCssUrl(value) { return String(value).replace(/['"()\\\r\n]/g, ""); }
