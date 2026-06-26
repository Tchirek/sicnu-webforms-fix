/*
 * 川师教务 · 后台（service worker）
 *
 * 收到请求后，把同一份打印文档渲染成 PDF：预览打开 PDF 标签页，打印/导出下载 PDF。
 *
 * 关键：打印文档必须以【与教务页同源】的身份加载，它引用的样式表 / 图片 / 水印才能
 * 正常取到——教务是 http 站点，资源多为同源、会话 Cookie 通常是 SameSite=Lax。
 *
 * 旧版用 data: URL 渲染，那是 opaque 源：跨源取站点资源会被拦截（Private Network
 * Access）或丢掉 SameSite Cookie，结果导出的 PDF 丢失全部样式与图片（“错谬甚多”）。
 * 这里改用 CDP Fetch 拦截：在隐藏窗口里导航到本站的一个占位 URL，把这次导航的响应
 * 替换成我们的打印文档——文档因此“就是本站的页面”，其子资源全部同源带 Cookie 加载，
 * 渲染保真后再 printToPDF。预览、打印、导出因此共用同一个 PDF 生成入口。
 *
 * 渲染放在最小化、不聚焦的 popup 窗口里。printToPDF 用 preferCSSPageSize 跟随文档自带的
 * @page（A4＋方向），并等待字体、照片、水印图片稳定后再落 PDF。
 */

var SENTINEL = "/__sicnu_print__"; // 占位导航路径；不在任何 content_scripts 匹配范围内，故不会被注入

chrome.runtime.onMessage.addListener(function (message, _sender, sendResponse) {
  if (!message || message.type !== "sicnu-pdf") return false;
  exportPdf(message.payload)
    .then(function (result) { sendResponse({ ok: true, result: result }); })
    .catch(function (error) { sendResponse({ ok: false, error: error && error.message ? error.message : String(error) }); });
  return true; // 异步响应
});

async function exportPdf(payload) {
  if (!chrome.debugger) throw new Error("当前浏览器不支持 debugger 接口。");
  if (!payload || !payload.html || !payload.origin) throw new Error("导出请求缺少必要字段。");

  var win = await createHiddenWindow("about:blank");
  var debuggee = { tabId: win.tabId };
  var renderUrl = payload.origin + SENTINEL + "?r=" + Date.now().toString(36) + Math.random().toString(36).slice(2);
  var htmlBase64 = toBase64Utf8(payload.html);

  // 把占位 URL 的导航响应替换成打印文档；其余子资源（样式表/图片/水印）一律放行——
  // 它们与文档同源，会带上会话 Cookie 正常加载。
  var onEvent = function (source, method, params) {
    if (source.tabId !== win.tabId || method !== "Fetch.requestPaused") return;
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

    var loaded = onceEvent(win.tabId, "Page.loadEventFired");
    await command(debuggee, "Page.navigate", { url: renderUrl });
    await withTimeout(loaded, 20000, "渲染打印文档超时。");

    await command(debuggee, "Fetch.disable", {});
    await command(debuggee, "Emulation.setEmulatedMedia", { media: "print" });
    await waitForRenderStable(debuggee);

    var pdf = await command(debuggee, "Page.printToPDF", {
      landscape: payload.orientation === "landscape",
      printBackground: true,
      preferCSSPageSize: true,
      marginTop: 0, marginBottom: 0, marginLeft: 0, marginRight: 0,
      scale: 1
    });
    if (payload.preview) {
      var previewTabId = await previewData("data:application/pdf;base64," + pdf.data);
      return { previewTabId: previewTabId };
    }
    var downloadId = await downloadData("data:application/pdf;base64," + pdf.data, payload.filename);
    return { downloadId: downloadId };
  } finally {
    // 无论成败都收尾：摘掉事件监听、脱离调试器、关掉临时窗口，避免黄条与孤儿窗口残留。
    chrome.debugger.onEvent.removeListener(onEvent);
    try { await detach(debuggee); } catch (_) {}
    try { await removeWindow(win.windowId); } catch (_) {}
  }
}

function onceEvent(tabId, method) {
  return new Promise(function (resolve) {
    function handler(source, evMethod) {
      if (source.tabId === tabId && evMethod === method) {
        chrome.debugger.onEvent.removeListener(handler);
        resolve();
      }
    }
    chrome.debugger.onEvent.addListener(handler);
  });
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
      await new Promise(function (resolve) {
        requestAnimationFrame(function () { requestAnimationFrame(resolve); });
      });
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
