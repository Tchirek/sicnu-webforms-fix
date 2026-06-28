# 川师教务顶栏与准考证下载修复

这个插件修复两个问题：

- `http://202.115.194.60/Index.aspx` 上顶栏无法切换。
- “考试 / 自助打印”相关页面的“打印 / 导出PDF”按钮依赖 LODOP 等古旧本地组件，在现代浏览器和 macOS 上无法工作。

## 问题原因

教务系统顶栏链接被写成 `javascript:__doPostBack(...)`，但当前页面没有定义 `__doPostBack`，同时 ASP.NET 菜单脚本依赖的若干 `WebForm_*` 函数也缺失。浏览器点击顶栏时找不到这些函数，所以不会提交切换模块的请求。

考试和自助打印页面的打印按钮会调用 `JS/LodopFuncs.js`，并依赖本机 LODOP 打印控件或 Windows 的 “Microsoft Print to PDF” 虚拟打印机。插件会接管这些按钮，从页面里的 `divContent` 生成可打印文档。

扩展版和用户脚本版都使用浏览器原生打印对话框，因此不需要 `debugger` 权限。导出 PDF 时选择“另存为 PDF / Save as PDF”；插件会把打印页标题设置为建议文件名，但最终保存框是否采用该文件名由浏览器决定。

本插件只在 `http://202.115.194.60/Index.aspx*`、`http://202.115.194.60/ExamManage/*` 和 `http://202.115.194.60/SelfPrint/*` 页面注入兼容函数，不读取账号密码，不上传任何数据。PDF 在浏览器本地生成。

扩展不申请 `debugger`、`downloads` 等高权限。
