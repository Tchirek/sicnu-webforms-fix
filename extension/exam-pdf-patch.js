(function () {
  var version = "1.4.0";
  var pagePattern = /\/ExamManage\//i;

  if (!pagePattern.test(location.pathname)) {
    return;
  }

  window.__sicnuExamPdfPatchVersion = version;

  var pageStyles = {
    portrait: { widthPt: 595.28, heightPt: 841.89, cssWidth: 794, marginPt: 24 },
    landscape: { widthPt: 841.89, heightPt: 595.28, cssWidth: 1123, marginPt: 20 }
  };

  function install() {
    if (!shouldActivate()) {
      return;
    }
    patchControls();
    window.doprint = function (how) {
      generateExamPdf({ preview: how === "1" });
      return false;
    };
    window.getLodop = function () {
      return createLodopShim();
    };
    window.CLODOP = createLodopShim();
  }

  function shouldActivate() {
    if (document.getElementById("divContent") || document.querySelector(".PrintTableStyle")) {
      return true;
    }

    var pageText = [
      location.pathname,
      document.body ? document.body.innerText : "",
      Array.prototype.map.call(document.scripts, function (script) {
        return script.src + " " + (script.textContent || "");
      }).join(" "),
      Array.prototype.map.call(document.querySelectorAll("input[type='button'], button, a"), function (control) {
        return [control.value, control.textContent, control.getAttribute("onclick"), control.title].join(" ");
      }).join(" ")
    ].join(" ");

    return /doprint|LODOP|CLodop|CLODOP|LodopFuncs|打印|导出PDF|考试安排|准考证|考试日程/i.test(pageText);
  }

  function patchControls() {
    var controls = document.querySelectorAll("input[type='button'], button, a");
    Array.prototype.forEach.call(controls, function (control) {
      var label = [control.value, control.textContent, control.getAttribute("onclick"), control.title]
        .join(" ");
      if (!/打印|导出PDF|doprint/i.test(label)) {
        return;
      }

      if (control.__sicnuExamPdfPatched) {
        return;
      }

      control.__sicnuExamPdfPatched = true;
      control.onclick = function (event) {
        if (event) {
          event.preventDefault();
          event.stopPropagation();
          if (event.stopImmediatePropagation) {
            event.stopImmediatePropagation();
          }
        }
        generateExamPdf({ preview: /预览/.test(control.value || control.textContent || "") });
        return false;
      };

      control.addEventListener("click", function (event) {
        event.preventDefault();
        event.stopPropagation();
        if (event.stopImmediatePropagation) {
          event.stopImmediatePropagation();
        }
        generateExamPdf({ preview: /预览/.test(control.value || control.textContent || "") });
        return false;
      }, true);
    });
  }

  function createLodopShim() {
    return {
      PRINT_INIT: noop,
      PRINT_INITA: noop,
      SET_PRINT_PAGESIZE: noop,
      SET_SHOW_MODE: noop,
      ADD_PRINT_SETUP_BKIMG: noop,
      ADD_PRINT_TABLE: noop,
      SET_PRINTER_INDEXA: function () { return true; },
      PREVIEW: function () { generateExamPdf({ preview: true }); },
      PRINT: function () { generateExamPdf({ preview: false }); }
    };
  }

  function noop() {}

  function findPrintableElement() {
    return document.getElementById("divContent") ||
      document.querySelector(".PrintTableStyle") ||
      largestTable();
  }

  function largestTable() {
    var tables = Array.prototype.slice.call(document.querySelectorAll("table"));
    tables.sort(function (a, b) {
      return (b.innerText || "").length - (a.innerText || "").length;
    });
    return tables[0] || document.body;
  }

  function isLandscape(element) {
    var clue = (location.pathname + " " + (element.innerText || "")).toLowerCase();
    return /schedule|日程安排表|mutliexamarrangeresultforschedule/.test(clue) ||
      element.scrollWidth > element.scrollHeight * 1.2;
  }

  function fileNameFor(element) {
    var text = (element.innerText || "").replace(/\s+/g, " ");
    var base = "川师教务考试信息";
    if (/准考证/.test(text)) {
      base = "川师教务-我的准考证";
    } else if (/日程安排表/.test(text)) {
      base = "川师教务-考试日程安排表";
    } else if (/考试安排/.test(text)) {
      base = "川师教务-我的考试安排";
    }

    var now = new Date();
    var stamp = [
      now.getFullYear(),
      pad(now.getMonth() + 1),
      pad(now.getDate()),
      pad(now.getHours()),
      pad(now.getMinutes())
    ].join("");
    return base + "-" + stamp + ".pdf";
  }

  function pad(value) {
    return String(value).padStart(2, "0");
  }

  async function generateExamPdf(options) {
    var element = findPrintableElement();
    if (!element) {
      alert("没有找到可导出的考试内容。");
      return;
    }

    var loading = showToast("正在生成 PDF...");
    try {
      var orientation = isLandscape(element) ? "landscape" : "portrait";
      var filename = fileNameFor(element);
      try {
        await requestBrowserPdf(element, orientation, filename, !!(options && options.preview));
        return;
      } catch (nativeError) {
        console.warn("浏览器原生 PDF 生成失败，改用兼容模式。", nativeError);
      }

      loading.textContent = "正在用兼容模式生成 PDF...";
      var style = pageStyles[orientation];
      var rendered = await renderElementToCanvas(element, style.cssWidth);
      var pdfBlob = await canvasToPdf(rendered.canvas, style);

      if (options && options.preview) {
        var previewUrl = URL.createObjectURL(pdfBlob);
        window.open(previewUrl, "_blank");
        setTimeout(function () { URL.revokeObjectURL(previewUrl); }, 60000);
      } else {
        downloadBlob(pdfBlob, filename);
      }
    } catch (error) {
      console.error(error);
      alert("PDF 生成失败：" + (error && error.message ? error.message : error));
    } finally {
      loading.remove();
    }
  }

  function requestBrowserPdf(element, orientation, filename, preview) {
    return new Promise(function (resolve, reject) {
      if (!document.documentElement.getAttribute("data-sicnu-exam-pdf-bridge")) {
        reject(new Error("当前环境没有扩展 PDF 后台通道。"));
        return;
      }

      var requestId = "sicnu-pdf-" + Date.now() + "-" + Math.random().toString(16).slice(2);
      var timeout = setTimeout(function () {
        window.removeEventListener("sicnu-exam-pdf-response", onResponse);
        reject(new Error("浏览器 PDF 通道无响应。"));
      }, 30000);

      function onResponse(event) {
        var detail = event.detail || {};
        if (detail.requestId !== requestId) {
          return;
        }

        clearTimeout(timeout);
        window.removeEventListener("sicnu-exam-pdf-response", onResponse);
        if (detail.error) {
          reject(new Error(detail.error));
          return;
        }
        if (!detail.response || !detail.response.ok) {
          reject(new Error((detail.response && detail.response.error) || "浏览器 PDF 生成失败。"));
          return;
        }
        resolve(detail.response.result || {});
      }

      window.addEventListener("sicnu-exam-pdf-response", onResponse, false);
      window.dispatchEvent(new CustomEvent("sicnu-exam-pdf-request", {
        detail: {
          requestId: requestId,
          payload: buildBrowserPdfPayload(element, orientation, filename, preview)
        }
      }));
    });
  }

  function buildBrowserPdfPayload(element, orientation, filename, preview) {
    return {
      title: document.title || filename.replace(/\.pdf$/i, ""),
      filename: filename,
      orientation: orientation,
      preview: !!preview,
      baseHref: location.href,
      watermarkHref: pageUsesWatermark() ? new URL("../images/WaterMark.jpg", location.href).href : "",
      contentHtml: element.outerHTML,
      stylesheetHrefs: Array.prototype.slice.call(document.querySelectorAll("link[rel~='stylesheet'],link[type='text/css']")).map(function (link) {
        return link.href;
      }).filter(Boolean),
      inlineStyles: Array.prototype.slice.call(document.querySelectorAll("style")).map(function (style) {
        return style.textContent || "";
      })
    };
  }

  function pageUsesWatermark() {
    return Array.prototype.some.call(document.scripts, function (script) {
      return /ADD_PRINT_SETUP_BKIMG|WaterMark\.jpg/i.test(script.textContent || "");
    });
  }

  async function renderElementToCanvas(element, targetWidth) {
    await waitForFonts();

    return renderTablesToCanvas(element, targetWidth);
  }

  function renderTablesToCanvas(element, targetWidth) {
    var rect = element.getBoundingClientRect();
    var sourceWidth = Math.max(rect.width || element.scrollWidth || targetWidth, 320);
    var sourceHeight = Math.max(rect.height || element.scrollHeight || 1, 1);
    var scaleToTarget = targetWidth / sourceWidth;
    var renderScale = Math.max(1.75, Math.min(2.5, window.devicePixelRatio || 2));
    var canvas = document.createElement("canvas");
    canvas.width = Math.ceil(targetWidth * renderScale);
    canvas.height = Math.ceil(sourceHeight * scaleToTarget * renderScale);
    var context = canvas.getContext("2d");

    context.fillStyle = "#fff";
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.setTransform(renderScale * scaleToTarget, 0, 0, renderScale * scaleToTarget, 0, 0);

    var origin = element.getBoundingClientRect();
    var tables = Array.prototype.slice.call(element.querySelectorAll("table"));
    if (element.tagName && element.tagName.toLowerCase() === "table") {
      tables.unshift(element);
    }

    if (!tables.length) {
      drawTextBlock(context, element, origin);
    } else {
      tables.forEach(function (table) {
        drawTable(context, table, origin);
      });
    }

    return { canvas: canvas, width: targetWidth, height: sourceHeight * scaleToTarget, scale: renderScale };
  }

  function drawTable(context, table, origin) {
    var cells = Array.prototype.slice.call(table.querySelectorAll("th,td"));
    cells.forEach(function (cell) {
      if (cell.querySelector("table")) {
        return;
      }
      drawCell(context, cell, origin);
    });
  }

  function drawCell(context, cell, origin) {
    var rect = cell.getBoundingClientRect();
    if (!rect.width || !rect.height) {
      return;
    }

    var style = window.getComputedStyle(cell);
    var x = rect.left - origin.left;
    var y = rect.top - origin.top;
    var width = rect.width;
    var height = rect.height;

    context.save();
    context.fillStyle = colorOr(style.backgroundColor, "#fff");
    context.fillRect(x, y, width, height);
    drawBorders(context, x, y, width, height, style);
    drawCellText(context, cell, style, x, y, width, height);
    context.restore();
  }

  function drawBorders(context, x, y, width, height, style) {
    drawBorder(context, x, y, x + width, y, style.borderTopWidth, style.borderTopColor);
    drawBorder(context, x + width, y, x + width, y + height, style.borderRightWidth, style.borderRightColor);
    drawBorder(context, x, y + height, x + width, y + height, style.borderBottomWidth, style.borderBottomColor);
    drawBorder(context, x, y, x, y + height, style.borderLeftWidth, style.borderLeftColor);
  }

  function drawBorder(context, x1, y1, x2, y2, widthValue, colorValue) {
    var width = parseFloat(widthValue);
    if (!width || width <= 0) {
      width = 0.75;
    }
    context.strokeStyle = colorOr(colorValue, "#333");
    context.lineWidth = width;
    context.beginPath();
    context.moveTo(x1, y1);
    context.lineTo(x2, y2);
    context.stroke();
  }

  function drawCellText(context, cell, style, x, y, width, height) {
    var text = (cell.innerText || cell.textContent || "").replace(/\u00a0/g, " ").trim();
    if (!text) {
      return;
    }

    var fontSize = parseFloat(style.fontSize) || 14;
    var fontFamily = style.fontFamily || "Songti SC, SimSun, serif";
    var fontWeight = style.fontWeight || "normal";
    var fontStyle = style.fontStyle || "normal";
    var lineHeight = parseFloat(style.lineHeight);
    if (!lineHeight || Number.isNaN(lineHeight)) {
      lineHeight = fontSize * 1.35;
    }

    var paddingLeft = parseFloat(style.paddingLeft) || 3;
    var paddingRight = parseFloat(style.paddingRight) || 3;
    var paddingTop = parseFloat(style.paddingTop) || 3;
    var paddingBottom = parseFloat(style.paddingBottom) || 3;
    var maxWidth = Math.max(1, width - paddingLeft - paddingRight);
    var maxHeight = Math.max(1, height - paddingTop - paddingBottom);

    context.font = fontStyle + " " + fontWeight + " " + fontSize + "px " + fontFamily;
    context.fillStyle = colorOr(style.color, "#000");
    context.textBaseline = "top";

    var lines = wrapText(context, text, maxWidth);
    var allowedLines = Math.max(1, Math.floor(maxHeight / lineHeight));
    lines = lines.slice(0, allowedLines);

    var textHeight = lines.length * lineHeight;
    var startY = y + paddingTop;
    if (style.verticalAlign === "middle") {
      startY = y + Math.max(paddingTop, (height - textHeight) / 2);
    } else if (style.verticalAlign === "bottom") {
      startY = y + height - paddingBottom - textHeight;
    }

    lines.forEach(function (line, index) {
      var textWidth = context.measureText(line).width;
      var textX = x + paddingLeft;
      if (style.textAlign === "center") {
        textX = x + (width - textWidth) / 2;
      } else if (style.textAlign === "right") {
        textX = x + width - paddingRight - textWidth;
      }
      context.fillText(line, textX, startY + index * lineHeight);
    });
  }

  function drawTextBlock(context, element, origin) {
    var rect = element.getBoundingClientRect();
    var fakeStyle = window.getComputedStyle(element);
    drawCellText(context, element, fakeStyle, rect.left - origin.left, rect.top - origin.top, rect.width, rect.height);
  }

  function wrapText(context, text, maxWidth) {
    var result = [];
    var paragraphs = text.split(/\n+/);
    paragraphs.forEach(function (paragraph) {
      var tokens = tokenize(paragraph);
      var line = "";
      tokens.forEach(function (token) {
        var next = line + token;
        if (line && context.measureText(next).width > maxWidth) {
          result.push(line);
          line = token.trimStart();
        } else {
          line = next;
        }
      });
      if (line) {
        result.push(line);
      }
    });
    return result.length ? result : [text];
  }

  function tokenize(text) {
    var tokens = [];
    var current = "";
    for (var i = 0; i < text.length; i++) {
      var char = text.charAt(i);
      if (/\s/.test(char)) {
        if (current) {
          tokens.push(current);
          current = "";
        }
        tokens.push(char);
      } else if (/[\u3400-\u9fff\uff00-\uffef]/.test(char)) {
        if (current) {
          tokens.push(current);
          current = "";
        }
        tokens.push(char);
      } else {
        current += char;
      }
    }
    if (current) {
      tokens.push(current);
    }
    return tokens;
  }

  function colorOr(value, fallback) {
    if (!value || value === "transparent" || value === "rgba(0, 0, 0, 0)") {
      return fallback;
    }
    return value;
  }

  function waitForFonts() {
    if (document.fonts && document.fonts.ready) {
      return document.fonts.ready.catch(function () {});
    }
    return Promise.resolve();
  }

  async function canvasToPdf(sourceCanvas, style) {
    var pageWidth = style.widthPt;
    var pageHeight = style.heightPt;
    var margin = style.marginPt;
    var contentWidth = pageWidth - margin * 2;
    var contentHeight = pageHeight - margin * 2;
    var pagePixelHeight = Math.floor(sourceCanvas.width * contentHeight / contentWidth);
    var images = [];

    for (var y = 0; y < sourceCanvas.height; y += pagePixelHeight) {
      var sliceHeight = Math.min(pagePixelHeight, sourceCanvas.height - y);
      var pageCanvas = document.createElement("canvas");
      pageCanvas.width = sourceCanvas.width;
      pageCanvas.height = sliceHeight;
      var context = pageCanvas.getContext("2d");
      context.fillStyle = "#fff";
      context.fillRect(0, 0, pageCanvas.width, pageCanvas.height);
      context.drawImage(sourceCanvas, 0, y, sourceCanvas.width, sliceHeight, 0, 0, sourceCanvas.width, sliceHeight);
      images.push({
        bytes: dataUrlToBytes(pageCanvas.toDataURL("image/jpeg", 0.92)),
        width: pageCanvas.width,
        height: pageCanvas.height,
        drawHeight: contentWidth * sliceHeight / sourceCanvas.width
      });
    }

    return buildPdf(images, {
      pageWidth: pageWidth,
      pageHeight: pageHeight,
      margin: margin,
      contentWidth: contentWidth,
      contentHeight: contentHeight
    });
  }

  function dataUrlToBytes(dataUrl) {
    var base64 = dataUrl.split(",")[1];
    var binary = atob(base64);
    var bytes = new Uint8Array(binary.length);
    for (var i = 0; i < binary.length; i++) {
      bytes[i] = binary.charCodeAt(i);
    }
    return bytes;
  }

  function buildPdf(images, page) {
    var encoder = new TextEncoder();
    var chunks = [];
    var offsets = [0];
    var objectCount = 2 + images.length * 3;

    function addText(text) {
      var bytes = encoder.encode(text);
      chunks.push(bytes);
    }

    function addBytes(bytes) {
      chunks.push(bytes);
    }

    function length() {
      return chunks.reduce(function (sum, chunk) { return sum + chunk.length; }, 0);
    }

    function object(id, bodyWriter) {
      offsets[id] = length();
      addText(id + " 0 obj\n");
      bodyWriter();
      addText("\nendobj\n");
    }

    addText("%PDF-1.4\n%âãÏÓ\n");

    object(1, function () {
      addText("<< /Type /Catalog /Pages 2 0 R >>");
    });

    var pageObjectIds = images.map(function (_, index) {
      return 3 + index * 3;
    });

    object(2, function () {
      addText("<< /Type /Pages /Kids [" + pageObjectIds.map(function (id) { return id + " 0 R"; }).join(" ") + "] /Count " + pageObjectIds.length + " >>");
    });

    images.forEach(function (image, index) {
      var pageId = 3 + index * 3;
      var contentId = pageId + 1;
      var imageId = pageId + 2;

      object(pageId, function () {
        addText("<< /Type /Page /Parent 2 0 R /MediaBox [0 0 " + num(page.pageWidth) + " " + num(page.pageHeight) + "] /Resources << /XObject << /Im" + index + " " + imageId + " 0 R >> >> /Contents " + contentId + " 0 R >>");
      });

      var drawHeight = Math.min(page.contentHeight, image.drawHeight);
      var y = page.pageHeight - page.margin - drawHeight;
      var content = "q\n" + num(page.contentWidth) + " 0 0 " + num(drawHeight) + " " + num(page.margin) + " " + num(y) + " cm\n/Im" + index + " Do\nQ\n";
      object(contentId, function () {
        addText("<< /Length " + encoder.encode(content).length + " >>\nstream\n" + content + "endstream");
      });

      object(imageId, function () {
        addText("<< /Type /XObject /Subtype /Image /Width " + image.width + " /Height " + image.height + " /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length " + image.bytes.length + " >>\nstream\n");
        addBytes(image.bytes);
        addText("\nendstream");
      });
    });

    var xrefOffset = length();
    addText("xref\n0 " + (objectCount + 1) + "\n0000000000 65535 f \n");
    for (var j = 1; j <= objectCount; j++) {
      addText(String(offsets[j]).padStart(10, "0") + " 00000 n \n");
    }
    addText("trailer\n<< /Size " + (objectCount + 1) + " /Root 1 0 R >>\nstartxref\n" + xrefOffset + "\n%%EOF");

    return new Blob(chunks, { type: "application/pdf" });
  }

  function num(value) {
    return Number(value).toFixed(2).replace(/\.00$/, "");
  }

  function downloadBlob(blob, filename) {
    var url = URL.createObjectURL(blob);
    var link = document.createElement("a");
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(function () { URL.revokeObjectURL(url); }, 60000);
  }

  function showToast(message) {
    var toast = document.createElement("div");
    toast.textContent = message;
    toast.style.position = "fixed";
    toast.style.right = "16px";
    toast.style.bottom = "16px";
    toast.style.zIndex = "2147483647";
    toast.style.padding = "8px 12px";
    toast.style.background = "rgba(0,0,0,0.78)";
    toast.style.color = "#fff";
    toast.style.fontSize = "13px";
    toast.style.borderRadius = "4px";
    toast.style.fontFamily = "system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif";
    document.body.appendChild(toast);
    return toast;
  }

  install();
  document.addEventListener("DOMContentLoaded", install, false);
  window.addEventListener("load", install, false);
  setTimeout(install, 0);
  setTimeout(install, 500);
  setTimeout(install, 1500);
  setTimeout(install, 3000);
  if (window.MutationObserver) {
    new MutationObserver(function () {
      install();
    }).observe(document.documentElement, { childList: true, subtree: true });
  }
})();
