# GPT-Image2-Studio 像素级迁移矩阵

## 迁移来源

| 来源 | 用途 |
| --- | --- |
| `K:\开源项目\GPT-Image2-Studio` | 本次迁移的源码基准，复制运行时、前端、共享逻辑和静态素材 |
| `https://github.com/aEboli/GPT-Image2-Studio` | 功能边界核对，版本描述为 `v0.2.0` |

## 当前策略

参考项目是原生 HTML/CSS/ESM + Node HTTP 服务，包含大量 DOM、CSS、动画、静态素材和服务端工作流。为保留像素表现，本项目采用运行时内嵌方式迁移：

1. 将参考项目 `public`、`lib`、`server.mjs`、CLI/部署脚本和必要静态文件复制到 `vendor/gpt-image2-studio`。
2. 在当前 `npm run dev` 中同步启动参考 Studio 服务，默认地址为 `http://127.0.0.1:3600/`。
3. 在当前 React 工作台菜单新增 `GPT Studio`，使用全尺寸 iframe 承载原项目界面。
4. 去除 vendored 运行时代码里的本地假图和假 Listing Agent 路径，只保留真实上游调用。

## 功能覆盖矩阵

| 功能域 | 参考项目入口 | 当前项目落点 | 覆盖状态 |
| --- | --- | --- | --- |
| 全局顶部导航、配置面板、生成日志、Prompt Kit、图片转提示词、输出目录 | `/`、`/#studio` | 菜单 `GPT Studio` iframe，参考服务原生页面 | 已迁移 |
| 提示词生图 | `/#studio` | vendored 原生运行时 | 已迁移 |
| 风格迁移 | `/#style-transfer` | vendored 原生运行时 | 已迁移 |
| 融图/参考图分析 | `/#reference-analysis` | vendored 原生运行时 | 已迁移 |
| 图片拆解 | `/#image-decomposition` | vendored 原生运行时 | 已迁移 |
| 图片编辑与局部蒙版 | `/#image-edit` | vendored 原生运行时 | 已迁移 |
| 快速融图 | `/#quick-blend` | vendored 原生运行时 | 已迁移 |
| 图片压缩 | `/#image-compress` | vendored 原生运行时，浏览器本地处理 | 已迁移 |
| 电商套图、类目模板、SKU、Logo、Listing Agent | `/#creation` | vendored 原生运行时 | 已迁移 |
| 写真模式、动作/服装/地点资产 | `/#portrait` | vendored 原生运行时，静态资产已复制 | 已迁移 |
| 文章插图 | `/#article-illustration` | vendored 原生运行时 | 已迁移 |
| PPT 生成、逐页补图、PPTX 导出 | `/#ppt` | vendored 原生运行时，依赖 `pptxgenjs` 已加入当前项目 | 已迁移 |
| 瀑布画廊 | `/#gallery` | vendored 原生运行时 | 已迁移 |
| 文章插图记录 | `/#article-record` | vendored 原生运行时 | 已迁移 |
| 套图记录 | `/#creation-record` | vendored 原生运行时 | 已迁移 |
| 写真记录 | `/#portrait-record` | vendored 原生运行时 | 已迁移 |
| PPT 记录 | `/#ppt-record` | vendored 原生运行时 | 已迁移 |
| 图片详情灯箱、缩放、适配、平移、下载、参数复盘 | 各图片预览入口 | vendored 原生运行时 | 已迁移 |
| PPT 单页编辑器 | PPT 结果页 | vendored 原生运行时 | 已迁移 |
| 写真搭配库 | 写真模式 | vendored 原生运行时，素材已复制 | 已迁移 |
| Logo 素材库 | 套图模式 | vendored 原生运行时 | 已迁移 |
| 模型选择器与模型列表拉取 | 配置面板 | vendored 原生运行时 | 已迁移 |
| 本地输出目录与记录索引 | `%USERPROFILE%\Pictures`、`.local/config.json` | 参考服务保持原项目默认策略 | 已迁移 |
| Cloudflare/Vercel/Windows 安装相关脚本 | `scripts`、`wrangler*.jsonc`、`vercel.json` | vendored 目录保留 | 已迁移 |

## 验收口径

| 检查项 | 命令或方式 | 预期 |
| --- | --- | --- |
| 当前项目类型检查 | `.\node_modules\.bin\tsc.cmd --noEmit` | 通过 |
| 当前项目单测 | `.\node_modules\.bin\vitest.cmd run --pool=threads --maxWorkers=1` | 通过 |
| 当前项目构建 | `.\node_modules\.bin\vite.cmd build` | 通过 |
| 当前生产源码无假数据关键词 | `rg "mock\|Mock\|MOCK" src server vendor\gpt-image2-studio\server.mjs vendor\gpt-image2-studio\lib vendor\gpt-image2-studio\public` | 无命中 |
| 当前 BFF 健康检查 | `GET http://127.0.0.1:8787/api/health` | 200 |
| 参考 Studio 健康检查 | `GET http://127.0.0.1:3600/` | 200 |
| 菜单入口 | 浏览器打开 `http://127.0.0.1:8081/` 点击 `GPT Studio` | iframe 中出现原项目 Studio UI |
