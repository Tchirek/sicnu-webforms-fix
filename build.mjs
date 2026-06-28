/*
 * 构建脚本：从扩展的两个内容脚本生成用户脚本（Tampermonkey 等）。
 * 扩展里的 webforms-patch.js / exam-print.js 是唯一真源；用户脚本由本脚本生成，
 * 不再手工抄写，从根本上杜绝两份代码漂移。
 *
 * 版本号也只有一个真源：以 manifest.json 为准，构建时同步写回 exam-print.js。
 * 读取时统一把 CRLF 规整成 LF，使产物与平台、工作区行尾设置无关——构建可复现，
 * `node build.mjs` 之后 `git diff` 必为空。
 *
 * 用法： node build.mjs
 */
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const root = dirname(fileURLToPath(import.meta.url));
const read = (p) => readFileSync(join(root, p), "utf8").replace(/\r\n/g, "\n");
const write = (p, text) => writeFileSync(join(root, p), text);

const VERSION = JSON.parse(read("extension/manifest.json")).version;

// 版本单一真源：把 exam-print.js 里的 VERSION 常量对齐到 manifest，并写回（LF）。
const examPath = "extension/exam-print.js";
const exam = read(examPath).replace(/(var VERSION = ")[^"]*(";)/, `$1${VERSION}$2`);
write(examPath, exam);

const webforms = read("extension/webforms-patch.js");

const header = [
  "// ==UserScript==",
  "// @name         川师教务顶栏与考试打印修复",
  "// @namespace    local.sicnu.webforms.fix",
  `// @version      ${VERSION}`,
  "// @description  修复四川师范大学教务系统顶栏无法切换，以及考试/打印页面旧式 LODOP 打印按钮失效的问题。",
  "// @match        http://202.115.194.60/Index.aspx*",
  "// @match        http://202.115.194.60/ExamManage/*",
  "// @match        http://202.115.194.60/SelfPrint/*",
  "// @run-at       document-start",
  "// @grant        none",
  "// ==/UserScript==",
];

// 用户脚本管理器的沙箱不保证能直接改写页面全局，因此把真源代码注入为页面内 <script>，
// 确保它运行在页面上下文，与扩展 world:MAIN 的行为一致。JSON.stringify 负责安全转义。
const out = `${header.join("\n")}

(function () {
  function inject(code) {
    var s = document.createElement("script");
    s.textContent = code;
    (document.head || document.documentElement).appendChild(s);
    s.remove();
  }
  var path = location.pathname.toLowerCase();
  if (path.indexOf("/index.aspx") !== -1) inject(${JSON.stringify(webforms)});
  if (path.indexOf("/exammanage/") !== -1 || path.indexOf("/selfprint/") !== -1) inject(${JSON.stringify(exam)});
})();
`;

const target = "userscript/sicnu-webforms-fix.user.js";
write(target, out);
console.log(`userscript 已生成 v${VERSION}：${join(root, target)} (${out.length} 字符)`);
