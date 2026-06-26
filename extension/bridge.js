/*
 * 川师教务 · 内容脚本桥（world:ISOLATED）
 *
 * world:MAIN 的页面脚本拿不到 chrome.* API，所以由这个隔离世界的内容脚本中转：
 *   1. 在 documentElement 上打标记，让 MAIN 脚本知道“真下载”后台可用；
 *   2. 把 MAIN 脚本派发的导出请求转发给后台，再把结果回传。
 * 用户脚本环境没有本文件，也就没有标记，MAIN 脚本会自动退回打印对话框。
 */
document.documentElement.setAttribute("data-sicnu-bridge", "1");

window.addEventListener("sicnu-pdf-request", function (event) {
  var detail = event.detail || {};
  var done = false;
  var timer = setTimeout(function () {
    reply(null, "后台 PDF 通道超时。");
  }, 40000);

  function reply(response, error) {
    if (done) return;
    done = true;
    clearTimeout(timer);
    window.dispatchEvent(new CustomEvent("sicnu-pdf-response", {
      detail: {
        requestId: detail.requestId,
        response: response || null,
        error: error || null
      }
    }));
  }

  try {
    chrome.runtime.sendMessage(
      { type: "sicnu-pdf", payload: detail.payload },
      function (response) {
        reply(response, chrome.runtime.lastError ? chrome.runtime.lastError.message : null);
      }
    );
  } catch (error) {
    reply(null, error && error.message ? error.message : String(error));
  }
});
