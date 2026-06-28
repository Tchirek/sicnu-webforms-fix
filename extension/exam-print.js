/*
 * 川师教务 · LODOP 打印接管（world:MAIN，运行在页面上下文）
 *
 * 旧页面的“打印 / 导出PDF / 打印预览”按钮依赖本机 LODOP / CLodop 控件，现代浏览器不可用。
 * 本脚本只替换点击行为，不改原按钮的文字、尺寸、class、title、位置和外观。
 *
 * 打印预览：生成与导出同源的 PDF，并在浏览器 PDF 查看器中打开。
 * 打印：在隐藏 iframe 中渲染同一份排版文档，直接调起浏览器打印对话框。
 * 导出PDF：用浏览器 PDF 引擎直接取得 PDF 文件。
 */
(function () {
  "use strict";

  if (!/\/(?:ExamManage|SelfPrint)\//i.test(location.pathname)) return;
  if (window.__sicnuExamPrint) return;
  window.__sicnuExamPrint = true;

  var VERSION = "3.6.3";
  var BUTTON_RE = /打印|导出\s*PDF|下载|doprint/i;

  window.__sicnuExamPrintVersion = VERSION;
  try { document.documentElement.setAttribute("data-sicnu-print", VERSION); } catch (e) {}

  function printable() {
    return document.getElementById("divContent") ||
      document.querySelector(".PrintTableStyle") ||
      largestTable() ||
      document.body;
  }

  function largestTable() {
    var best = null;
    var max = -1;
    Array.prototype.forEach.call(document.querySelectorAll("table"), function (table) {
      var score = (table.innerText || table.textContent || "").length;
      if (score > max) {
        max = score;
        best = table;
      }
    });
    return best;
  }

  function isLandscape(el) {
    var explicit = explicitPageOrientation();
    if (explicit) return explicit === "landscape";
    var clue = (location.pathname + " " + (el.innerText || el.textContent || "")).toLowerCase();
    return /schedule|日程安排表|mutliexamarrangeresultforschedule/.test(clue) ||
      el.scrollWidth > el.scrollHeight * 1.2;
  }

  function fileName(el) {
    var text = (el.innerText || el.textContent || "").replace(/\s+/g, " ");
    var base = selfPrintName() ||
      (/准考证/.test(text) ? "川师教务-我的准考证"
      : /日程安排表/.test(text) ? "川师教务-考试日程安排表"
      : /考试安排/.test(text) ? "川师教务-我的考试安排"
      : /成绩/.test(text) ? "川师教务-成绩证明"
      : /学籍|在读/.test(text) ? "川师教务-学籍证明"
      : "川师教务打印材料");
    var d = new Date();
    var p = function (n) { return String(n).padStart(2, "0"); };
    return base + "-" + d.getFullYear() + p(d.getMonth() + 1) + p(d.getDate()) + p(d.getHours()) + p(d.getMinutes()) + ".pdf";
  }

  function styleTags() {
    return Array.prototype.map.call(
      document.querySelectorAll('link[rel~="stylesheet"], style'),
      function (node) { return node.outerHTML; }
    ).join("");
  }

  function cloneContent(el) {
    var clone = el.cloneNode(true);
    Array.prototype.forEach.call(clone.querySelectorAll("script"), function (node) {
      node.remove();
    });
    Array.prototype.forEach.call(clone.querySelectorAll("td,th"), function (cell) {
      if (cell.querySelector("img")) {
        cell.classList.add("sicnu-img-cell");
      }
    });
    return clone.outerHTML;
  }

  function docHtml(el, autoPrint) {
    var orientation = isLandscape(el) ? "landscape" : "portrait";
    var area = printArea();
    var fitPolicy = selfPrintFitPolicy();
    var layoutMode = printLayoutMode(fitPolicy);
    var watermark = watermarkHref(el);
    var preload = watermark
      ? '<link rel="preload" as="image" href="' + escapeAttribute(watermark) + '">'
      : "";
    var hiddenPreload = watermark
      ? '<img class="sicnu-watermark-preload" src="' + escapeAttribute(watermark) + '" alt="">'
      : "";

    return '<!doctype html><html><head><meta charset="utf-8">' +
      '<base href="' + escapeAttribute(location.href) + '">' +
      '<title>' + escapeHtml(document.title || "考试信息") + '</title>' +
      preload + styleTags() +
      '<style>' + printCss(orientation, watermark, area, fitPolicy) + '</style></head>' +
      '<body><div class="sicnu-print-sheet" data-fit-policy="' + fitPolicy + '" data-layout-mode="' + layoutMode + '">' + hiddenPreload +
      '<div class="sicnu-print-content"><div class="sicnu-print-inner">' + cloneContent(el) + '</div></div></div>' +
      fitScript(fitPolicy) +
      (autoPrint ? '<script>onload=function(){focus();print()};onafterprint=function(){close()}<\/script>' : "") +
      '</body></html>';
  }

  function printCss(orientation, watermark, area, fitPolicy) {
    var sheetSize = orientation === "landscape"
      ? "width:297mm;height:210mm;"
      : "width:210mm;height:297mm;";
    var mappedArea = pageAreaCss(area, orientation);
    var flowMode = printLayoutMode(fitPolicy) === "flow";
    var watermarkCss = watermark
      ? ".sicnu-print-sheet:before{content:\"\";position:fixed;inset:0;background:" + cssUrl(watermark) + " center center / 72% auto no-repeat;z-index:0;pointer-events:none;}"
      : "";
    if (flowMode) {
      return [
        "@page{size:A4 " + orientation + ";margin:" + mappedArea.top + " " + mappedArea.right + " " + mappedArea.bottom + " " + mappedArea.left + "}",
        "html,body{margin:0!important;padding:0!important;background:#fff!important;color:#000!important;-webkit-print-color-adjust:exact!important;print-color-adjust:exact!important}",
        "body{font-family:SimSun,'Songti SC','STSong',serif;}",
        ".sicnu-print-sheet{box-sizing:border-box;position:static;width:auto;min-height:0;padding:0;background:#fff;color:#000;overflow:visible;}",
        watermarkCss,
        ".sicnu-print-content{position:relative;z-index:1;box-sizing:border-box;width:100%;height:auto;overflow:visible;}",
        ".sicnu-print-inner{box-sizing:border-box;transform-origin:top left;}",
        ".sicnu-print-inner>#divContent{box-sizing:border-box;max-width:100%;}",
        ".sicnu-print-content input,.sicnu-print-content button,.sicnu-print-content select,.sicnu-print-content textarea,.sicnu-print-content .btn_bg2{display:none!important}",
        ".sicnu-print-content table{page-break-inside:auto;}",
        ".sicnu-print-content tr{page-break-inside:avoid;break-inside:avoid;page-break-after:auto;}",
        ".sicnu-print-content td,.sicnu-print-content th{-webkit-print-color-adjust:exact!important;print-color-adjust:exact!important;}",
        ".sicnu-print-content .sicnu-img-cell{position:relative!important;overflow:hidden!important;}",
        ".sicnu-print-content .sicnu-img-cell img{max-width:calc(100% - 2px)!important;max-height:calc(100% - 2px)!important;object-fit:contain!important;box-sizing:border-box!important;vertical-align:middle!important;position:relative!important;z-index:0!important;}",
        ".sicnu-print-content .sicnu-img-cell:after{content:\"\";position:absolute;inset:0;border:inherit;pointer-events:none;z-index:2;}",
        ".sicnu-watermark-preload{position:absolute!important;width:1px!important;height:1px!important;opacity:0!important;left:-9999px!important;top:-9999px!important;pointer-events:none!important;}"
      ].join("");
    }
    return [
      "@page{size:A4 " + orientation + ";margin:0}",
      "html,body{margin:0!important;padding:0!important;background:#fff!important;color:#000!important;-webkit-print-color-adjust:exact!important;print-color-adjust:exact!important}",
      "body{font-family:SimSun,'Songti SC','STSong',serif;}",
      ".sicnu-print-sheet{box-sizing:border-box;position:relative;" + sheetSize + "padding:0;background:#fff;color:#000;overflow:visible;}",
      watermarkCss,
      ".sicnu-print-content{position:absolute;z-index:1;box-sizing:border-box;top:" + mappedArea.top + ";left:" + mappedArea.left + ";width:" + mappedArea.width + ";height:" + mappedArea.height + ";overflow:visible;}",
      ".sicnu-print-inner{box-sizing:border-box;transform-origin:top left;}",
      ".sicnu-print-inner>#divContent{box-sizing:border-box;max-width:100%;}",
      ".sicnu-print-content input,.sicnu-print-content button,.sicnu-print-content select,.sicnu-print-content textarea,.sicnu-print-content .btn_bg2{display:none!important}",
      ".sicnu-print-content table{page-break-inside:auto;}",
      ".sicnu-print-content tr{page-break-inside:avoid;break-inside:avoid;page-break-after:auto;}",
      ".sicnu-print-content td,.sicnu-print-content th{-webkit-print-color-adjust:exact!important;print-color-adjust:exact!important;}",
      ".sicnu-print-content .sicnu-img-cell{position:relative!important;overflow:hidden!important;}",
      ".sicnu-print-content .sicnu-img-cell img{max-width:calc(100% - 2px)!important;max-height:calc(100% - 2px)!important;object-fit:contain!important;box-sizing:border-box!important;vertical-align:middle!important;position:relative!important;z-index:0!important;}",
      ".sicnu-print-content .sicnu-img-cell:after{content:\"\";position:absolute;inset:0;border:inherit;pointer-events:none;z-index:2;}",
      ".sicnu-watermark-preload{position:absolute!important;width:1px!important;height:1px!important;opacity:0!important;left:-9999px!important;top:-9999px!important;pointer-events:none!important;}"
    ].join("");
  }

  function printLayoutMode(fitPolicy) {
    return fitPolicy === "none" && /\/SelfPrint\//i.test(location.pathname) ? "flow" : "fixed";
  }

  function pageAreaCss(area, orientation) {
    var page = orientation === "landscape"
      ? { width: 297, height: 210 }
      : { width: 210, height: 297 };
    return {
      top: cssLengthForAxis(area.top, page.height),
      left: cssLengthForAxis(area.left, page.width),
      width: cssLengthForAxis(area.width, page.width),
      height: cssLengthForAxis(area.height, page.height),
      right: cssRemainderForAxis(area.left, area.width, page.width),
      bottom: cssRemainderForAxis(area.top, area.height, page.height)
    };
  }

  function cssLengthForAxis(value, axisMm) {
    var raw = String(value || "").trim();
    var percent = raw.match(/^(-?\d+(?:\.\d+)?)%$/);
    if (percent) return roundMm(parseFloat(percent[1]) * axisMm / 100);
    return raw;
  }

  function cssRemainderForAxis(start, size, axisMm) {
    var a = String(start || "").trim().match(/^(-?\d+(?:\.\d+)?)%$/);
    var b = String(size || "").trim().match(/^(-?\d+(?:\.\d+)?)%$/);
    if (a && b) {
      return roundMm(Math.max(0, (100 - parseFloat(a[1]) - parseFloat(b[1])) * axisMm / 100));
    }
    return "calc(100% - " + cssLengthForAxis(start, axisMm) + " - " + cssLengthForAxis(size, axisMm) + ")";
  }

  function roundMm(value) {
    return (Math.round(value * 1000) / 1000) + "mm";
  }

  function fitScript(policy) {
    if (policy === "none") return "";
    return '<script>(' + function () {
      var policy = document.querySelector(".sicnu-print-sheet").getAttribute("data-fit-policy") || "none";
      if (policy === "none") return;

      function px(value, fallback) {
        var n = parseFloat(value);
        return isFinite(n) && n > 0 ? n : fallback;
      }

      function contentBounds(content) {
        var rect = content.getBoundingClientRect();
        var style = getComputedStyle(content);
        return {
          width: px(style.width, rect.width),
          height: px(style.height, rect.height)
        };
      }

      function fitOnce() {
        var content = document.querySelector(".sicnu-print-content");
        var inner = document.querySelector(".sicnu-print-inner");
        if (!content || !inner) return;

        content.style.overflow = "visible";
        inner.style.transform = "";
        inner.style.width = "";

        var target = contentBounds(content);
        if (!target.width || !target.height) return;

        var scale = 1;
        for (var i = 0; i < 4; i += 1) {
          inner.style.width = scale < 1 ? (target.width / scale) + "px" : "";

          var naturalWidth = Math.max(inner.scrollWidth, inner.getBoundingClientRect().width);
          var naturalHeight = Math.max(inner.scrollHeight, inner.getBoundingClientRect().height);
          var next = Math.min(1, target.width / naturalWidth, target.height / naturalHeight);

          if (!(next < scale - 0.002)) break;
          scale = next;
        }

        var minScale = policy === "force-one-page" ? 0.88 : 0.76;
        if (scale < 0.999 && scale >= minScale) {
          inner.style.width = (target.width / scale) + "px";
          inner.style.transform = "scale(" + scale + ")";
          content.style.overflow = "hidden";
          content.setAttribute("data-sicnu-fit-scale", scale.toFixed(4));
        } else {
          inner.style.width = "";
          inner.style.transform = "";
          content.style.overflow = "visible";
          content.setAttribute("data-sicnu-fit-scale", "1");
        }
        content.setAttribute("data-sicnu-fit-done", "1");
      }

      function schedule() {
        fitOnce();
        setTimeout(fitOnce, 60);
        setTimeout(fitOnce, 180);
      }

      if (document.readyState === "loading") {
        document.addEventListener("DOMContentLoaded", schedule, { once: true });
      } else {
        schedule();
      }
      window.addEventListener("load", schedule, { once: true });
      if (document.fonts && document.fonts.ready) {
        document.fonts.ready.then(schedule).catch(function () {});
      }
    } + ')();<\/script>';
  }

  function selfPrintFitPolicy() {
    if (!/\/SelfPrint\//i.test(location.pathname)) return "none";
    var onePage = /^(?:wp_zdzm|wp_byszdzm|wp_jd|wp_ywzd|wp_ywjd|wp_byzm|wp_xl|wp_ywbyz|wp_ywxwz)\.aspx$/i;
    var name = location.pathname.split("/").pop();
    return onePage.test(name) ? "force-one-page" : "none";
  }

  function scriptCorpus() {
    return Array.prototype.map.call(document.scripts, function (script) {
      return (script.src || "") + "\n" + (script.textContent || "");
    }).join("\n");
  }

  function lodopCalls() {
    var corpus = scriptCorpus();
    var names = [
      "PRINT_INIT",
      "SET_PRINT_PAGESIZE",
      "ADD_PRINT_SETUP_BKIMG",
      "SET_SHOW_MODE",
      "SET_PRINT_MODE",
      "ADD_PRINT_TABLE",
      "ADD_PRINT_HTM",
      "ADD_PRINT_HTML",
      "SET_PRINT_STYLEA",
      "PREVIEW",
      "PRINT",
      "PRINTA"
    ];
    return names.reduce(function (items, name) {
      var re = new RegExp(name + "\\s*\\(([^;]*)\\)", "ig");
      var match;
      while ((match = re.exec(corpus))) {
        items.push({ name: name, args: match[1].replace(/\s+/g, " ").trim() });
      }
      return items;
    }, []);
  }

  function lodopModel() {
    var page = lodopCalls().filter(function (call) { return call.name === "SET_PRINT_PAGESIZE"; })[0] || null;
    var table = lodopCalls().filter(function (call) { return /^ADD_PRINT_(?:TABLE|HTM|HTML)$/.test(call.name); })[0] || null;
    var mode = page && page.args.match(/^\s*([012])/);
    var pageMode = mode ? mode[1] : "";
    var orientation = pageMode === "1" ? "portrait" : pageMode === "2" ? "landscape" : pageMode === "0" ? "default/auto" : "";
    var effectiveOrientation = isLandscape(printable()) ? "landscape" : "portrait";
    var area = printArea();
    return {
      version: VERSION,
      path: location.pathname,
      title: document.title || "",
      pageSizeArgs: page ? page.args : "",
      pageSizeMode: pageMode,
      declaredOrientation: orientation || "unspecified",
      effectiveOrientation: effectiveOrientation,
      printAreaArgs: table ? table.args : "",
      printArea: area,
      layoutMode: printLayoutMode(selfPrintFitPolicy()),
      fitPolicy: selfPrintFitPolicy(),
      fullHeightForOverflow: lodopCalls().some(function (call) {
        return call.name === "SET_PRINT_MODE" && /FULL_HEIGHT_FOR_OVERFLOW/i.test(call.args);
      }),
      calls: lodopCalls()
    };
  }

  function explicitPageOrientation() {
    var match = scriptCorpus().match(/SET_PRINT_PAGESIZE\s*\(\s*([012])/i);
    if (!match) return "";
    if (match[1] === "1") return "portrait";
    if (match[1] === "2") return "landscape";
    return "";
  }

  function printArea() {
    var fallback = { top: "2%", left: "2%", width: "96%", height: "96%" };
    var match = scriptCorpus().match(/ADD_PRINT_(?:TABLE|HTM|HTML)\s*\(\s*([^,]+)\s*,\s*([^,]+)\s*,\s*([^,]+)\s*,\s*([^,]+)\s*,/i);
    if (!match) return fallback;
    return {
      top: cssMeasure(match[1], fallback.top),
      left: cssMeasure(match[2], fallback.left),
      width: cssMeasure(match[3], fallback.width),
      height: cssMeasure(match[4], fallback.height)
    };
  }

  function cssMeasure(value, fallback) {
    var raw = String(value || "").trim()
      .replace(/^['"]|['"]$/g, "")
      .replace(/&quot;/g, "")
      .trim();
    if (!raw || /^auto$/i.test(raw)) return fallback;
    if (/^-?\d+(?:\.\d+)?(?:%|px|pt|mm|cm|in|em|rem|vh|vw)$/i.test(raw)) return raw;
    if (/^-?\d+(?:\.\d+)?$/.test(raw)) return raw + "px";
    return fallback;
  }

  function selfPrintName() {
    var map = {
      "wp_zdzm.aspx": "川师教务-学籍证明普通版",
      "wp_byszdzm.aspx": "川师教务-学籍证明毕业版",
      "wp_xsscore.aspx": "川师教务-成绩证明",
      "wp_jd.aspx": "川师教务-绩点算法证明",
      "wp_yw.aspx": "川师教务-成绩证明英文版",
      "wp_ywzd.aspx": "川师教务-学籍证明英文版",
      "wp_ywjd.aspx": "川师教务-绩点证明英文版",
      "wp_byzm.aspx": "川师教务-推免生证明",
      "wp_xl.aspx": "川师教务-学历证明中英文",
      "wp_ywbyz.aspx": "川师教务-毕业证明",
      "wp_ywxwz.aspx": "川师教务-学位证明"
    };
    var name = location.pathname.split("/").pop().toLowerCase();
    return map[name] || "";
  }

  function watermarkHref(el) {
    if (!pageUsesLodopWatermark() || contentAlreadyHasWatermark(el)) {
      return "";
    }
    try {
      return new URL("../images/WaterMark.jpg", location.href).href;
    } catch (e) {
      return "../images/WaterMark.jpg";
    }
  }

  function pageUsesLodopWatermark() {
    return /ADD_PRINT_SETUP_BKIMG|WaterMark\.jpg/i.test(scriptCorpus());
  }

  function contentAlreadyHasWatermark(el) {
    var html = el.outerHTML || "";
    if (/background(?:-image)?\s*:[^"'<>;]*WaterMark\.jpg/i.test(html)) {
      return true;
    }
    var nodes = [el].concat(Array.prototype.slice.call(el.querySelectorAll("*"), 0, 400));
    return nodes.some(function (node) {
      try {
        return /WaterMark\.jpg/i.test(getComputedStyle(node).backgroundImage || "");
      } catch (e) {
        return false;
      }
    });
  }

  function requestPdf(previewMode) {
    var el = printable();
    if (!el) return;

    if (!document.documentElement.getAttribute("data-sicnu-bridge")) {
      previewMode ? openWindow(el, false) : printInFrame(el);
      return;
    }

    var toast = showToast(previewMode ? "正在生成 PDF 预览..." : "正在生成 PDF...");
    var requestId = "sicnu-" + Date.now() + "-" + Math.random().toString(16).slice(2);
    var finished = false;
    var timer = setTimeout(function () {
      cleanup();
      previewMode ? openWindow(el, false) : printInFrame(el);
    }, 45000);

    function cleanup() {
      if (finished) return;
      finished = true;
      clearTimeout(timer);
      window.removeEventListener("sicnu-pdf-response", onResponse);
      toast.remove();
    }

    function onResponse(e) {
      if (!e.detail || e.detail.requestId !== requestId) return;
      var r = e.detail.response;
      var failed = e.detail.error || !r || !r.ok;
      cleanup();
      if (failed) {
        previewMode ? openWindow(el, false) : printInFrame(el);
      }
    }

    window.addEventListener("sicnu-pdf-response", onResponse);
    window.dispatchEvent(new CustomEvent("sicnu-pdf-request", {
      detail: {
        requestId: requestId,
        payload: {
          html: docHtml(el, false),
          filename: fileName(el),
          orientation: isLandscape(el) ? "landscape" : "portrait",
          origin: location.origin,
          preview: !!previewMode
        }
      }
    }));
  }

  function preview() {
    requestPdf(true);
  }

  function downloadPdf() {
    requestPdf(false);
  }

  function printPage() {
    var el = printable();
    if (el) printInFrame(el);
  }

  function openWindow(el, autoPrint) {
    var win = window.open("", "_blank");
    if (!win) return;
    win.document.write(docHtml(el, autoPrint));
    win.document.close();
  }

  function printInFrame(el) {
    var iframe = document.createElement("iframe");
    var cleanupTimer;

    function cleanup() {
      clearTimeout(cleanupTimer);
      try { iframe.remove(); } catch (e) {}
    }

    iframe.setAttribute("aria-hidden", "true");
    iframe.style.cssText = "position:fixed;right:0;bottom:0;width:0;height:0;border:0;opacity:0;pointer-events:none";
    document.body.appendChild(iframe);

    var doc = iframe.contentDocument || iframe.contentWindow.document;
    doc.open();
    doc.write(docHtml(el, false));
    doc.close();

    waitForPrintFrame(iframe).then(function () {
      var win = iframe.contentWindow;
      win.onafterprint = cleanup;
      win.focus();
      win.print();
      cleanupTimer = setTimeout(cleanup, 60000);
    }).catch(function () {
      cleanup();
      openWindow(el, true);
    });
  }

  function waitForPrintFrame(iframe) {
    return new Promise(function (resolve) {
      var win = iframe.contentWindow;
      var doc = iframe.contentDocument || win.document;
      function ready() {
        var fontPromise = doc.fonts && doc.fonts.ready ? doc.fonts.ready.catch(function () {}) : Promise.resolve();
        fontPromise.then(function () {
          var images = Array.prototype.slice.call(doc.images || []);
          return Promise.all(images.map(function (img) {
            if (img.complete) return Promise.resolve();
            if (img.decode) return img.decode().catch(function () {});
            return new Promise(function (done) {
              img.addEventListener("load", done, { once: true });
              img.addEventListener("error", done, { once: true });
              setTimeout(done, 3000);
            });
          }));
        }).then(function () { setTimeout(resolve, 80); });
      }
      if (doc.readyState === "complete") {
        ready();
      } else {
        win.addEventListener("load", ready, { once: true });
      }
    });
  }

  function actionFor(label) {
    if (/预览/.test(label)) return preview;
    if (/导出|下载/.test(label)) return downloadPdf;
    return printPage;
  }

  function intercept(e) {
    e.preventDefault();
    e.stopImmediatePropagation();
    var c = e.currentTarget;
    actionFor((c.value || "") + (c.textContent || "") + (c.getAttribute("onclick") || "") + (c.title || ""))();
  }

  var lodop = new Proxy({}, {
    get: function (_target, key) {
      if (key === "PRINT" || key === "PRINTA") return printPage;
      if (key === "PREVIEW") return preview;
      return function () { return lodop; };
    }
  });

  function takeover() {
    window.doprint = function (how) {
      how = String(how);
      (how === "1" ? preview : how === "3" ? downloadPdf : printPage)();
      return false;
    };
    window.getLodop = window.getCLodop = function () { return lodop; };
    window.CLODOP = lodop;

    Array.prototype.forEach.call(document.querySelectorAll("input[type=button],input[type=submit],button,a"), function (control) {
      if (control.__sicnuPatched) return;
      var label = (control.value || "") + (control.textContent || "") + (control.getAttribute("onclick") || "") + (control.title || "");
      if (!BUTTON_RE.test(label)) return;
      control.__sicnuPatched = true;
      control.addEventListener("click", intercept, true);
    });
  }

  function showToast(message) {
    var t = document.createElement("div");
    t.textContent = message;
    t.style.cssText = "position:fixed;right:16px;bottom:16px;z-index:2147483647;padding:8px 12px;" +
      "background:rgba(0,0,0,.78);color:#fff;font:13px system-ui,-apple-system,'Segoe UI',sans-serif;border-radius:4px";
    document.body.appendChild(t);
    return t;
  }

  function cssUrl(value) {
    return "url(" + JSON.stringify(String(value)) + ")";
  }

  function escapeHtml(value) {
    return String(value).replace(/[&<>"]/g, function (char) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;" }[char];
    });
  }

  function escapeAttribute(value) {
    return escapeHtml(value).replace(/'/g, "&#39;");
  }

  window.__sicnuExamPrintDebug = {
    buildHtml: function () {
      var el = printable();
      return el ? docHtml(el, false) : "";
    },
    lodopModel: lodopModel,
    printArea: printArea,
    fitPolicy: selfPrintFitPolicy,
    version: VERSION
  };

  takeover();
  document.addEventListener("DOMContentLoaded", takeover);
  window.addEventListener("load", takeover);
  setTimeout(takeover, 0);
  setTimeout(takeover, 500);
  setTimeout(takeover, 1500);
})();
