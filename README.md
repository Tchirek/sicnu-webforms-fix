# 川师教务顶栏与准考证下载修复

这个插件修复两个问题：

- `http://202.115.194.60/Index.aspx` 上顶栏无法切换。
- “考试”模块下部分页面的“打印 / 导出PDF”按钮依赖 LODOP 等古旧本地组件，在现代浏览器和 macOS 上无法工作。

## 问题原因

教务系统顶栏链接被写成 `javascript:__doPostBack(...)`，但当前页面没有定义 `__doPostBack`，同时 ASP.NET 菜单脚本依赖的若干 `WebForm_*` 函数也缺失。浏览器点击顶栏时找不到这些函数，所以不会提交切换模块的请求。

考试页面的打印按钮会调用 `JS/LodopFuncs.js`，并依赖本机 LODOP 打印控件或 Windows 的 “Microsoft Print to PDF” 虚拟打印机。插件会接管这些按钮，从页面里的 `divContent` 直接在浏览器本地生成 PDF 文件。

Chrome / Edge 扩展版会调用浏览器自己的 `Page.printToPDF` 打印排版引擎，因此会尽量保留页面的尺寸、字体、表格、比例、图片、水印和打印分页。用户脚本版没有浏览器后台打印权限，会使用兼容回退方案，适合应急保存，但保真度不如 Chrome / Edge 扩展版。

本插件只在 `http://202.115.194.60/Index.aspx*` 和 `http://202.115.194.60/ExamManage/*` 页面注入兼容函数，不读取账号密码，不上传任何数据。PDF 在浏览器本地生成。

Chrome / Edge 安装时会看到 `debugger` 权限提示，这是为了调用浏览器内置的 PDF 打印接口；插件只在生成考试 PDF 时创建临时打印页并调用该接口。
