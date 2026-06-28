/*
 * 川师教务 · 后台（service worker）
 *
 * 收到请求后，把同一份打印文档渲染成 PDF：预览打开 PDF 标签页，导出下载 PDF。
 *
 * 关键：打印文档必须以【与教务页同源】的身份加载，它引用的样式表 / 图片 / 水印才能
 * 正常取到——教务是 http 站点，资源多为同源、会话 Cookie 通常是 SameSite=Lax。
 *
 * 旧版用 data: URL 渲染，那是 opaque 源：跨源取站点资源会被拦截（Private Network
 * Access）或丢掉 SameSite Cookie，结果导出的 PDF 丢失全部样式与图片（“错谬甚多”）。
 * 这里改用 CDP Fetch 拦截：在临时渲染容器里导航到本站的一个占位 URL，把这次导航的响应
 * 替换成我们的打印文档——文档因此“就是本站的页面”，其子资源全部同源带 Cookie 加载，
 * 渲染保真后再 printToPDF。预览、导出因此共用同一个 PDF 生成入口。
 *
 * 优先用 CDP hidden target 渲染；若扩展环境不允许 hidden target，则使用最小化 popup
 * 窗口，避免标签栏闪出 Untitled；最后才退回不激活的临时标签页。printToPDF 用
 * preferCSSPageSize 跟随文档自带的 @page
 * （A4＋方向），并等待字体、照片、水印图片稳定后再落 PDF。
 */

var ALLOWED_ORIGIN = "http://202.115.194.60";
var PRINT_PATH_RE = /\/(?:ExamManage|SelfPrint)\//i;
var SENTINEL = "/__sicnu_print__"; // 占位导航路径；不在任何 content_scripts 匹配范围内，故不会被注入

chrome.runtime.onMessage.addListener(function (message, sender, sendResponse) {
  if (!message || message.type !== "sicnu-pdf") return false;
  exportPdf(message.payload, sender)
    .then(function (result) { sendResponse({ ok: true, result: result }); })
    .catch(function (error) { sendResponse({ ok: false, error: error && error.message ? error.message : String(error) }); });
  return true; // 异步响应
});

async function exportPdf(payload, sender) {
  if (!chrome.debugger) throw new Error("当前浏览器不支持 debugger 接口。");
  if (!payload || !payload.html || !payload.origin) throw new Error("导出请求缺少必要字段。");
  var origin = verifiedOrigin(payload, sender);

  var render = await createHiddenRenderTarget("about:blank", sender).catch(function (hiddenError) {
    var hiddenReason = hiddenError && hiddenError.message ? hiddenError.message : String(hiddenError);
    return createPopupRenderTarget("about:blank", hiddenReason).catch(function (popupError) {
      var popupReason = popupError && popupError.message ? popupError.message : String(popupError);
      return createTabRenderTarget("about:blank", hiddenReason + " | popup: " + popupReason);
    });
  });
  var debuggee = render.debuggee;
  var renderUrl = origin + SENTINEL + "?r=" + Date.now().toString(36) + Math.random().toString(36).slice(2);
  var htmlBase64 = toBase64Utf8(payload.html);

  // 把占位 URL 的导航响应替换成打印文档；其余子资源（样式表/图片/水印）一律放行——
  // 它们与文档同源，会带上会话 Cookie 正常加载。
  var onEvent = function (source, method, params) {
    if (!sameDebuggee(source, debuggee) || method !== "Fetch.requestPaused") return;
    if (params.request.url.indexOf(SENTINEL) !== -1) {
      command(debuggee, "Fetch.fulfillRequest", {
        requestId: params.requestId,
        responseCode: 200,
        responseHeaders: [{ name: "Content-Type", value: "text/html; charset=utf-8" }],
        body: htmlBase64
      }).catch(function () {});
    } else {
      command(debuggee, "Fetch.continueRequest", { requestId: params.requestId }).catch(function () {});
    }
  };

  try {
    await attach(debuggee);
    chrome.debugger.onEvent.addListener(onEvent);
    await command(debuggee, "Page.enable", {});
    await command(debuggee, "Runtime.enable", {});
    await command(debuggee, "Fetch.enable", { patterns: [{ urlPattern: "*" }] });

    var loaded = onceEvent(debuggee, "Page.loadEventFired");
    await command(debuggee, "Page.navigate", { url: renderUrl });
    await withTimeout(loaded, 20000, "渲染打印文档超时。");

    await command(debuggee, "Fetch.disable", {});
    await command(debuggee, "Emulation.setEmulatedMedia", { media: "print" });
    await waitForRenderStable(debuggee);

    var pdf = await withTimeout(command(debuggee, "Page.printToPDF", {
      landscape: payload.orientation === "landscape",
      printBackground: true,
      preferCSSPageSize: true,
      marginTop: 0, marginBottom: 0, marginLeft: 0, marginRight: 0,
      scale: 1
    }), 30000, "浏览器生成 PDF 超时。");
    if (payload.preview) {
      var previewTabId = await withTimeout(previewData("data:application/pdf;base64," + pdf.data), 15000, "打开 PDF 预览超时。");
      return { previewTabId: previewTabId, renderMode: render.mode, fallbackReason: render.fallbackReason || "" };
    }
    var downloadId = await withTimeout(downloadData("data:application/pdf;base64," + pdf.data, payload.filename), 15000, "保存 PDF 超时。");
    return { downloadId: downloadId, renderMode: render.mode, fallbackReason: render.fallbackReason || "" };
  } finally {
    // 无论成败都收尾：摘掉事件监听、脱离调试器、关掉临时窗口，避免黄条与孤儿窗口残留。
    chrome.debugger.onEvent.removeListener(onEvent);
    try { await detach(debuggee); } catch (_) {}
    try { await render.close(); } catch (_) {}
  }
}

function verifiedOrigin(payload, sender) {
  var rawUrl = sender && (sender.url || (sender.tab && sender.tab.url)) || "";
  var url;
  try {
    url = new URL(rawUrl);
  } catch (_) {
    throw new Error("导出请求来源无效。");
  }
  if (url.origin !== ALLOWED_ORIGIN || !PRINT_PATH_RE.test(url.pathname)) {
    throw new Error("导出请求来源不在允许范围。");
  }
  if (payload.origin !== url.origin) {
    throw new Error("导出请求来源不匹配。");
  }
  return url.origin;
}

function onceEvent(debuggee, method) {
  return new Promise(function (resolve) {
    function handler(source, evMethod) {
      if (sameDebuggee(source, debuggee) && evMethod === method) {
        chrome.debugger.onEvent.removeListener(handler);
        resolve();
      }
    }
    chrome.debugger.onEvent.addListener(handler);
  });
}

function sameDebuggee(source, debuggee) {
  if (debuggee.tabId != null) return source.tabId === debuggee.tabId;
  if (debuggee.targetId != null) return source.targetId === debuggee.targetId;
  return false;
}

function withTimeout(promise, ms, message) {
  return Promise.race([
    promise,
    new Promise(function (_resolve, reject) { setTimeout(function () { reject(new Error(message)); }, ms); })
  ]);
}

async function waitForRenderStable(debuggee) {
  var expression = "(" + function () {
    return (async function () {
      if (document.fonts && document.fonts.ready) {
        try { await document.fonts.ready; } catch (e) {}
      }
      var images = Array.prototype.slice.call(document.images || []);
      await Promise.all(images.map(function (img) {
        if (img.complete && img.naturalWidth !== 0) return Promise.resolve();
        if (img.decode) return img.decode().catch(function () {});
        return new Promise(function (resolve) {
          var done = function () { resolve(); };
          img.addEventListener("load", done, { once: true });
          img.addEventListener("error", done, { once: true });
          setTimeout(done, 5000);
        });
      }));
      await new Promise(function (resolve) { setTimeout(resolve, 120); });
      return true;
    })();
  } + ")()";

  await withTimeout(command(debuggee, "Runtime.evaluate", {
    expression: expression,
    awaitPromise: true,
    returnByValue: true
  }), 20000, "等待打印资源超时。").catch(function () {});
  await sleep(250);
}

async function createHiddenRenderTarget(url, sender) {
  if (!sender || !sender.tab || !sender.tab.id) {
    throw new Error("缺少当前标签页，无法创建隐藏渲染目标。");
  }

  var control = { tabId: sender.tab.id };
  var targetId = "";
  await attach(control);
  try {
    var created = await command(control, "Target.createTarget", {
      url: url,
      hidden: true,
      width: 794,
      height: 1123
    });
    targetId = created && created.targetId;
    if (!targetId) throw new Error("浏览器没有返回隐藏渲染目标。");
  } catch (error) {
    try { await detach(control); } catch (_) {}
    throw error;
  }

  return {
    mode: "hidden-target",
    debuggee: { targetId: targetId },
    close: async function () {
      try { await command(control, "Target.closeTarget", { targetId: targetId }); } catch (_) {}
      try { await detach(control); } catch (_) {}
    }
  };
}

async function createTabRenderTarget(url, fallbackReason) {
  var tab = await createRenderTab(url);
  return {
    mode: "inactive-tab",
    fallbackReason: fallbackReason || "",
    debuggee: { tabId: tab.id },
    close: function () { return removeTab(tab.id); }
  };
}

async function createPopupRenderTarget(url, fallbackReason) {
  var win = await createRenderWindow(url);
  return {
    mode: "minimized-popup",
    fallbackReason: fallbackReason || "",
    debuggee: { tabId: win.tabId },
    close: function () { return removeWindow(win.windowId); }
  };
}

function createRenderTab(url) {
  return new Promise(function (resolve, reject) {
    chrome.tabs.create({ url: url, active: false }, function (tab) {
      if (chrome.runtime.lastError || !tab || !tab.id) {
        reject(new Error((chrome.runtime.lastError && chrome.runtime.lastError.message) || "无法创建打印标签页。"));
      } else {
        resolve(tab);
      }
    });
  });
}

function createRenderWindow(url) {
  return new Promise(function (resolve, reject) {
    chrome.windows.create({ url: url, type: "popup", focused: false, state: "minimized" }, function (win) {
      if (chrome.runtime.lastError || !win || !win.tabs || !win.tabs.length) {
        reject(new Error((chrome.runtime.lastError && chrome.runtime.lastError.message) || "无法创建打印窗口。"));
      } else {
        resolve({ windowId: win.id, tabId: win.tabs[0].id });
      }
    });
  });
}

function removeTab(tabId) {
  return new Promise(function (resolve) { chrome.tabs.remove(tabId, resolve); });
}

function removeWindow(windowId) {
  return new Promise(function (resolve) { chrome.windows.remove(windowId, resolve); });
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

function previewData(url) {
  return new Promise(function (resolve, reject) {
    chrome.tabs.create({ url: url, active: true }, function (tab) {
      chrome.runtime.lastError ? reject(new Error(chrome.runtime.lastError.message)) : resolve(tab.id);
    });
  });
}

function sleep(ms) {
  return new Promise(function (resolve) { setTimeout(resolve, ms); });
}

function sanitize(filename) {
  return String(filename || "川师教务考试信息.pdf").replace(/[\\/:*?"<>|]+/g, "-").trim().slice(0, 180);
}

// service worker 里 btoa 不接受非 Latin1 字符，先按 UTF-8 编码再分块转 base64（避免长串触发栈溢出）。
function toBase64Utf8(str) {
  var bytes = new TextEncoder().encode(str);
  var binary = "";
  var CHUNK = 0x8000;
  for (var i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode.apply(null, bytes.subarray(i, i + CHUNK));
  }
  return btoa(binary);
}
