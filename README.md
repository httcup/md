# 小胡的笔记本 MarkDownPad

零依赖、纯本地运行的 Markdown 笔记本。

## 功能

- 多本笔记：新建、搜索（标题 + 内容）、自动按更新时间排序
- 实时预览：标题、粗斜体、列表、待办、引用、表格、代码块（自研渲染器，先转义再拼 HTML，防 XSS）
- 自动保存：写入浏览器 localStorage，关掉再开还在
- 一键导出：单篇「下载 .md」、「备份全部」合成一份、「导入 .md」批量读回
- 书签小窗：把页顶书签图标拖到书签栏，点一下弹出 600×600 小窗随手记（与主窗口共用同一份笔记）
- 深浅色跟随系统；PWA 可安装

## 与旧版的关系

旧版（v4.x）基于 Vue 2 + EasyMDE + highlight.js + Font Awesome。
本版按零依赖方案用原生 HTML/CSS/JS 重写，无任何第三方库、无网络请求。

## 本地预览

```sh
python3 -m http.server 8000
# 打开 http://localhost:8000/
```

线上地址：<https://httcup.github.io/md/>
