/*
 * 川师教务 · 考试页打印接管（world:MAIN，运行在页面上下文）
 *
 * 旧页面的“打印 / 导出PDF / 打印预览”按钮依赖本机 LODOP / CLodop 控件，现代浏览器不可用。
 * 本脚本只替换点击行为，不改原按钮的文字、尺寸、class、title、位置和外观。
 *
 * 打印预览：生成与导出同源的 PDF，并在浏览器 PDF 查看器中打开。
 * 打印 / 导出PDF：走同一套 PDF 生成路径，直接取得 PDF 文件。
 */
(function () {
  "use strict";

  if (!/\/ExamManage\//i.test(location.pathname)) return;
  if (window.__sicnuExamPrint) return;
  window.__sicnuExamPrint = true;

  var VERSION = "3.5.0";
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
    var clue = (location.pathname + " " + (el.innerText || el.textContent || "")).toLowerCase();
    return /schedule|日程安排表|mutliexamarrangeresultforschedule/.test(clue) ||
      el.scrollWidth > el.scrollHeight * 1.2;
  }

  function fileName(el) {
    var text = (el.innerText || el.textContent || "").replace(/\s+/g, " ");
    var base = /准考证/.test(text) ? "川师教务-我的准考证"
      : /日程安排表/.test(text) ? "川师教务-考试日程安排表"
      : /考试安排/.test(text) ? "川师教务-我的考试安排"
      : "川师教务考试信息";
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
      '<style>' + printCss(orientation, watermark) + '</style></head>' +
      '<body><div class="sicnu-print-sheet">' + hiddenPreload +
      '<div class="sicnu-print-content">' + cloneContent(el) + '</div></div>' +
      (autoPrint ? '<script>onload=function(){focus();print()};onafterprint=function(){close()}<\/script>' : "") +
      '</body></html>';
  }

  function printCss(orientation, watermark) {
    var watermarkCss = watermark
      ? ".sicnu-print-sheet:before{content:\"\";position:fixed;inset:0;background:" + cssUrl(watermark) + " center center / 72% auto no-repeat;z-index:0;pointer-events:none;}"
      : "";
    return [
      "@page{size:A4 " + orientation + ";margin:0}",
      "html,body{margin:0!important;padding:0!important;background:#fff!important;color:#000!important;-webkit-print-color-adjust:exact!important;print-color-adjust:exact!important}",
      "body{font-family:SimSun,'Songti SC','STSong',serif}",
      ".sicnu-print-sheet{box-sizing:border-box;position:relative;width:100%;min-height:100vh;padding:2%;background:#fff;color:#000;}",
      watermarkCss,
      ".sicnu-print-content{position:relative;z-index:1;}",
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
    return Array.prototype.some.call(document.scripts, function (script) {
      return /ADD_PRINT_SETUP_BKIMG|WaterMark\.jpg/i.test((script.textContent || "") + " " + (script.src || ""));
    });
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
      openWindow(el, previewMode ? false : true);
      return;
    }

    var toast = showToast(previewMode ? "正在生成 PDF 预览..." : "正在生成 PDF...");
    var requestId = "sicnu-" + Date.now() + "-" + Math.random().toString(16).slice(2);
    var finished = false;
    var timer = setTimeout(function () {
      cleanup();
      openWindow(el, previewMode ? false : true);
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
        openWindow(el, previewMode ? false : true);
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

  function printOrDownload() {
    requestPdf(false);
  }

  function openWindow(el, autoPrint) {
    var win = window.open("", "_blank");
    if (!win) return;
    win.document.write(docHtml(el, autoPrint));
    win.document.close();
  }

  function actionFor(label) {
    return /预览/.test(label) ? preview : printOrDownload;
  }

  function intercept(e) {
    e.preventDefault();
    e.stopImmediatePropagation();
    var c = e.currentTarget;
    actionFor((c.value || "") + (c.textContent || "") + (c.getAttribute("onclick") || "") + (c.title || ""))();
  }

  var lodop = new Proxy({}, {
    get: function (_target, key) {
      if (key === "PRINT" || key === "PRINTA") return printOrDownload;
      if (key === "PREVIEW") return preview;
      return function () { return lodop; };
    }
  });

  function takeover() {
    window.doprint = function (how) {
      how = String(how);
      (how === "1" ? preview : printOrDownload)();
      return false;
    };
    window.getLodop = window.getCLodop = function () { return lodop; };
    window.CLODOP = lodop;

    Array.prototype.forEach.call(document.querySelectorAll("input[type=button],button,a"), function (control) {
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

  takeover();
  document.addEventListener("DOMContentLoaded", takeover);
  window.addEventListener("load", takeover);
  setTimeout(takeover, 0);
  setTimeout(takeover, 500);
  setTimeout(takeover, 1500);
})();
