/*
 * 川师教务 · 考试页打印接管（world:MAIN，运行在页面上下文）
 *
 * 旧页面的“打印 / 导出PDF / 打印预览”按钮依赖本机 LODOP / CLodop 控件，现代浏览器不可用。
 * 这里把三个按钮接管成三种真正不同的功能：
 *
 *   · 打印预览 → 新标签页打开排好版的内容，不弹任何框，纯看。
 *   · 打印     → 打开同源窗口并调用浏览器原生打印对话框，选打印机或另存。
 *   · 导出PDF  → 真·下载：经后台用浏览器打印引擎静默生成 PDF 直接落入下载夹。
 *                （仅 Chrome/Edge 扩展具备此能力；无后台桥时退回打印对话框，由用户另存。）
 *
 * document_start / DOMContentLoaded / load 各跑一次接管，既覆盖早期调用，
 * 又能在页面脚本重定义 getLodop/doprint 后抢回，无需常驻 MutationObserver。
 */
(function () {
  "use strict";

  if (!/\/ExamManage\//i.test(location.pathname)) return;
  if (window.__sicnuExamPrint) return;
  window.__sicnuExamPrint = true;

  var BUTTON_RE = /打印|导出\s*PDF|下载|doprint/i;

  // ---- 内容定位与排版判断 ----

  function printable() {
    var el = document.querySelector("#divContent, .PrintTableStyle");
    if (el) return el;
    var best = null, max = -1;
    document.querySelectorAll("table").forEach(function (t) {
      var n = (t.innerText || "").length;
      if (n > max) { max = n; best = t; }
    });
    return best;
  }

  function isLandscape(el) {
    return /schedule|日程安排表/i.test(location.pathname + (el.innerText || "")) ||
      el.scrollWidth > el.scrollHeight * 1.2;
  }

  function usesWatermark() {
    return Array.prototype.some.call(document.scripts, function (s) {
      return /ADD_PRINT_SETUP_BKIMG|WaterMark\.jpg/i.test(s.textContent || "");
    });
  }

  function watermarkHref() {
    return usesWatermark() ? new URL("../images/WaterMark.jpg", location.href).href : "";
  }

  function fileName(el) {
    var text = el.innerText || "";
    var base = /准考证/.test(text) ? "川师教务-我的准考证"
      : /日程安排表/.test(text) ? "川师教务-考试日程安排表"
      : /考试安排/.test(text) ? "川师教务-我的考试安排"
      : "川师教务考试信息";
    var d = new Date(), p = function (n) { return String(n).padStart(2, "0"); };
    return base + "-" + d.getFullYear() + p(d.getMonth() + 1) + p(d.getDate()) + p(d.getHours()) + p(d.getMinutes()) + ".pdf";
  }

  // ---- 打印文档（预览/打印用，在新窗口内渲染） ----

  function styleTags() {
    return Array.prototype.map.call(
      document.querySelectorAll('link[rel~="stylesheet"], style'),
      function (n) { return n.outerHTML; }
    ).join("");
  }

  // 打印文档结构（与旧版导出方法完全一致——经验证最忠实于原页）：A4 页、零页边距，
  // 内容铺满纸张宽度(width:100% + 2% 内边距)，让浏览器用页面自己的样式表自然排版；
  // 绝不锁宽度、不搬继承样式、不改媒体类型——任何“矫正”都只会让它偏离原页。
  // 图层：水印 :before 垫底(z-index:0)，内容整套 .sicnu-print-content 抬到上层(z-index:1)。
  function sheetCss(orientation, wm) {
    return "@page{size:A4 " + orientation + ";margin:0}" +
      "html,body{margin:0!important;padding:0!important;background:#fff!important;color:#000!important}" +
      "body{-webkit-print-color-adjust:exact!important;print-color-adjust:exact!important}" +
      ".sicnu-print-sheet{box-sizing:border-box;position:relative;width:100%;min-height:100vh;padding:2%;background:#fff;color:#000}" +
      ".sicnu-print-content{position:relative;z-index:1}" +
      "input,button,select,textarea,.btn_bg2{display:none!important}" +
      "table{page-break-inside:auto}tr{page-break-inside:avoid;page-break-after:auto}" +
      "td,th{-webkit-print-color-adjust:exact!important;print-color-adjust:exact!important}" +
      (wm ? ".sicnu-print-sheet:before{content:'';position:fixed;inset:0;background:url('" + wm + "') center center/72% auto no-repeat;z-index:0;pointer-events:none}" : "");
  }

  function docHtml(el, autoPrint) {
    return '<!doctype html><html><head><meta charset="utf-8"><base href="' + location.href + '">' +
      "<title>" + (document.title || "考试信息") + "</title>" + styleTags() +
      "<style>" + sheetCss(isLandscape(el) ? "landscape" : "portrait", watermarkHref()) + "</style></head>" +
      '<body><div class="sicnu-print-sheet"><div class="sicnu-print-content">' + el.outerHTML + "</div></div>" +
      (autoPrint ? "<script>onload=function(){focus();print()};onafterprint=function(){close()}<\/script>" : "") +
      "</body></html>";
  }

  function openWindow(el, autoPrint) {
    var win = window.open("", "_blank");
    if (!win) return; // 仅在弹窗被拦截时发生，再点一次即可
    win.document.write(docHtml(el, autoPrint));
    win.document.close();
  }

  // ---- 三种功能 ----

  function preview() { var el = printable(); if (el) openWindow(el, false); }
  function print() { var el = printable(); if (el) openWindow(el, true); }

  function download() {
    var el = printable();
    if (!el) return;
    // 无扩展后台桥（用户脚本 / 不支持 debugger 的浏览器）：退回打印对话框，由用户另存为 PDF。
    if (!document.documentElement.getAttribute("data-sicnu-bridge")) { openWindow(el, true); return; }

    var toast = showToast("正在导出 PDF…");
    var requestId = "sicnu-" + Date.now() + "-" + Math.random().toString(16).slice(2);
    function onResponse(e) {
      if (!e.detail || e.detail.requestId !== requestId) return;
      window.removeEventListener("sicnu-pdf-response", onResponse);
      toast.remove();
      var r = e.detail.response;
      if (e.detail.error || !r || !r.ok) openWindow(el, true); // 后台不可用则退回对话框
    }
    window.addEventListener("sicnu-pdf-response", onResponse);
    window.dispatchEvent(new CustomEvent("sicnu-pdf-request", {
      detail: {
        requestId: requestId,
        payload: {
          title: document.title || "考试信息",
          filename: fileName(el),
          orientation: isLandscape(el) ? "landscape" : "portrait",
          baseHref: location.href,
          watermarkHref: watermarkHref(),
          contentHtml: el.outerHTML,
          stylesheetHrefs: Array.prototype.map.call(document.querySelectorAll('link[rel~="stylesheet"]'), function (l) { return l.href; }).filter(Boolean),
          inlineStyles: Array.prototype.map.call(document.querySelectorAll("style"), function (s) { return s.textContent || ""; })
        }
      }
    }));
  }

  // ---- 接管入口 ----

  function actionFor(label) {
    if (/预览/.test(label)) return preview;
    if (/导出|下载/.test(label)) return download;
    return print;
  }

  function intercept(e) {
    e.preventDefault();
    e.stopImmediatePropagation();
    var c = e.currentTarget;
    actionFor((c.value || "") + (c.textContent || "") + (c.getAttribute("onclick") || ""))();
  }

  // 任意 LODOP 方法都返回可链式调用的空操作，PRINT/PREVIEW 走对应功能；绝不抛错、不弹安装提示。
  var lodop = new Proxy({}, {
    get: function (_t, k) { return k === "PRINT" ? print : k === "PREVIEW" ? preview : function () { return lodop; }; }
  });

  function takeover() {
    window.doprint = function (how) { (String(how) === "1" ? preview : print)(); return false; };
    window.getLodop = window.getCLodop = function () { return lodop; };
    window.CLODOP = lodop;
    document.querySelectorAll("input[type=button],button,a").forEach(function (c) {
      if (c.__sicnuPatched) return;
      if (!BUTTON_RE.test((c.value || "") + (c.textContent || "") + (c.getAttribute("onclick") || ""))) return;
      c.__sicnuPatched = true;
      c.addEventListener("click", intercept, true);
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

  takeover();
  document.addEventListener("DOMContentLoaded", takeover);
  window.addEventListener("load", takeover);
})();
