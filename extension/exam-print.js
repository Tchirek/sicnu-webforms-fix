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

  // 诊断标记：把当前运行的版本盖在 <html data-sicnu-print> 上，方便确认热加载是否生效。
  var VERSION = "3.4.3";
  window.__sicnuExamPrintVersion = VERSION;
  try { document.documentElement.setAttribute("data-sicnu-print", VERSION); } catch (e) {}

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

  // 水印垫在 body::before（z-index:0），内容整体抬到上层。
  // 另：页面给 #divContent 设了平铺的屏幕水印(background-image)，但原版 LODOP 打印用的是
  // innerHTML（不含该背景），只额外叠一张【居中】水印。这里去掉平铺背景，只保留居中水印，
  // 避免平铺水印满铺一片、与居中水印叠加。
  function watermarkCss() {
    var href = watermarkHref();
    if (!href) return "";
    return "#divContent{background-image:none!important}" +
      ".sicnu-sheet::before{content:'';position:fixed;inset:0;z-index:0;" +
      "background:url('" + href + "') center/72% no-repeat}";
  }

  // 打印文档结构【与 v1 完全一致——这是用户实测最忠实于原页的版本】：
  // 内容直接放进 <body>，只加 A4＋12mm 页边距，绝不用额外的包裹层 / width:100% / padding
  // 去“矫正”排版——任何包裹都可能打断页面自己的选择器与表格宽度，反而降低还原度。
  function docHtml(el, autoPrint) {
    return '<!doctype html><html><head><meta charset="utf-8"><base href="' + location.href + '">' +
      "<title>" + (document.title || "考试信息") + "</title>" + styleTags() +
      "<style>" +
        "@page{size:A4 " + (isLandscape(el) ? "landscape" : "portrait") + ";margin:12mm}" +
        "html,body{margin:0;background:#fff;-webkit-print-color-adjust:exact;print-color-adjust:exact}" +
        ".sicnu-sheet>*{position:relative;z-index:1}" +
        "input,button,select{display:none!important}" +
        "tr{break-inside:avoid}" +
        watermarkCss() +
      "</style></head>" +
      '<body class="sicnu-sheet">' + el.outerHTML +
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
    // 后台拿到的就是预览/打印用的【同一份】文档（docHtml），由后台以同源身份加载并 printToPDF，
    // 因此样式表/图片/水印都能带 Cookie 取到，导出与预览/打印逐像素一致。origin 用于拼占位 URL。
    window.dispatchEvent(new CustomEvent("sicnu-pdf-request", {
      detail: {
        requestId: requestId,
        payload: {
          html: docHtml(el, false),
          filename: fileName(el),
          orientation: isLandscape(el) ? "landscape" : "portrait",
          origin: location.origin
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

  // 页面用 doprint('1'|'2'|'3') 区分三个按钮：1=打印预览，2=打印，3=导出PDF。按此映射。
  function takeover() {
    window.doprint = function (how) {
      how = String(how);
      (how === "1" ? preview : how === "3" ? download : print)();
      return false;
    };
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
