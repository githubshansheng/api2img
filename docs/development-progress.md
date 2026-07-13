# AI 图片生成与编辑工作台开发进度

## 当前摘要

| 项目 | 状态 |
| --- | --- |
| 当前里程碑 | M1-M5 已完成；一致性套图与 AI 修图工作台已完成实现和验收，功能分支待审核 |
| 当前任务 | DEV-EDIT-001 AI 修图工作台 |
| 更新时间 | 2026-07-14 |
| 总体状态 | 已完成脚手架、领域类型、模型配置、真实上游生成链路、设置与模型映射、端点切换、结果工作台、错误映射、历史、批量生成、模板库、zip 下载、素材模板、模型对比、真实图片识别与推理测试、高级存储配置、运营检查入口和 `GPT-Image2-Studio` 迁移；一致性套图工作台支持主视觉锚点、共享视觉规范、候选图、并发控制、SSE、取消、重试和本地持久化；AI 修图工作台已支持整图、局部蒙版和双版本合并编辑，AI 指令润色与澄清，1-4 个候选及连续多轮，OpenAI 原生 multipart `image + mask`、Responses `previous_response_id` 与 Gemini `contents` 上下文延续，画笔、橡皮、矩形、套索、魔棒和近似主体六种选区工具及蒙版组合、反选、扩缩和羽化；版本 DAG、分支、评论、审核、发布、品牌素材、成本配额、生命周期、指标、熔断和 `view/comment/edit` 分享权限已落地；新增直接父子版本技术质量检查，可持久化改变像素比例、选区覆盖、选区外漂移、保护区一致性、边缘融合、告警与差异热力图，界面明确其不代表审美、创意或语义评分；修图会话与资产持久化到 SQLite 和本地目录，运行时凭证不落库，取消、失败和重复提交具备资产回滚，服务重启后未完成任务标记为 `interrupted` |

## 任务进度

| 任务 ID | 状态 | 完成时间 | 验证 | 备注 |
| --- | --- | --- | --- | --- |
| DEV-EDIT-001 | 已完成 | 2026-07-14 | `npm run typecheck`、`npm test -- --pool=threads --maxWorkers=1`、`npm run build`、`git diff --check`；39 个测试文件 191 个用例通过；自动化覆盖连续 5 轮原生上下文复用、过期/模型/端点降级、候选数 1-4、部分成功、幂等提交、服务端多区域蒙版合成、归档/恢复和技术质量评估；API 冒烟覆盖会话创建、清理、GET/SSE 脱敏及 `view/comment/edit` 权限矩阵；CDP 在 1440x900、1366x720、768x1024、390x844 验证归档只读与恢复、首次 SSE 握手失败后重连、真实触控绘制、100%→125% 缩放、局部提交及刷新持久化，均无页面级横向溢出、面板重叠或控制台错误，结束后会话列表为空 | 新增 AI 修图工作台：整图/局部/合并模式，画笔、橡皮、矩形、套索、魔棒、近似主体，多区域蒙版添加/减去/相交、反选、扩缩、羽化和优先级；服务端规范合成全部区域并输出 OpenAI 透明选区 mask；AI 润色、冲突澄清及无 Key 本地降级，1-4 个候选，取消/重试/下载/检出，分支与双父合并；OpenAI 原生 multipart `image + mask`、Responses `previous_response_id` 和 Gemini `contents` 连续上下文已接入；SQLite 保存会话、消息、任务、版本 DAG、分支和 continuation 元数据；评论、审核、发布、品牌素材、成本配额、生命周期、指标、熔断及 `view/comment/edit` 分享权限已交付；版本检查新增改变像素、选区覆盖、区域外漂移、保护区一致性、边缘融合、差异热力图和审计记录。分享令牌动作权限由服务端强制执行；但本项目仍是本地单机应用，没有账号认证、所有者身份、租户隔离或普通本地 API 认证，不能描述为公网级安全 |
| DEV-SUITE-001 | 已完成，待分支审核 | 2026-07-12 | `npm run typecheck`、`npm run test -- --pool=threads --maxWorkers=1`、`npm run build`、`git diff --check`、Playwright 桌面端/390px 移动端端到端验证 | 在 `feature/consistent-image-suite` 实现一致性套图：两套预设、字段级共享视觉规范、2-12 个场景、每场景 1-4 张且总候选不超过 24 张、主视觉人工/自动确认、锚点第一参考图、全局并发 4/单套并发 1-4、SQLite 持久化、SSE、取消/重试/删除、素材归档与下载；补齐凭据脱敏、取消清理以及远程归档 SSRF/DNS 重绑定防护 |
| DOCS-README-001 | 已完成 | 2026-07-11 | `npm run typecheck`、`npm run test -- --pool=threads --maxWorkers=1`、`npm run build` | 已参考成熟开源项目 README 结构，新增根目录 `README.md`，覆盖项目定位、功能亮点、快速开始、上游配置、脚本、API、架构、目录、安全隐私、文档索引和开发约定 |
| PLAN-001 | 已完成 | 2026-07-06 | 人工检查 `docs/development-plan.md` | 已基于里程碑制定开发计划和进度记录规则 |
| DEV-P0-001 | 已完成 | 2026-07-06 | `npm run typecheck`、`npm run build`、`GET /api/config/bootstrap` | 已搭建 Vite React + Express TypeScript 脚手架；7 个导航项可见；配置接口返回成功 |
| DEV-P0-002 | 已完成 | 2026-07-06 | `npm run typecheck`、`npm run build`、`GET /api/config/bootstrap` | 已新增 `src/domain/*.ts`，前后端共用 `BootstrapConfig`、枚举、生成、模型、设置和错误类型 |
| DEV-P0-003 | 已完成 | 2026-07-06 | `npm run typecheck`、`npm run build`、配置模块检查、`GET /api/config/bootstrap` | 已实现 16 个模型配置、默认模型、价格/端点/能力字段和 `gpt-image-2-vip` 临时限制 |
| DEV-P0-004 | 已完成 | 2026-07-06 | `npm run typecheck`、`npm run test`、`npm run build` | 已实现 `resolveModelCapabilities` 和 `createDefaultGenerationParams`，VIP 临时限制可强制 `auto + 1K` 并置灰参数 |
| DEV-P0-005 | 已完成 | 2026-07-06 | `npm run typecheck`、`npm run test`、`npm run build` | 已实现本地设置弹窗、API Key 保存/清除、默认脱敏展示和显式显示真实 Key |
| DEV-P0-006 | 已完成 | 2026-07-06 | `npm run typecheck`、`npm run test`、`npm run build` | 已实现参考图点击/拖拽上传、JPG/PNG、20 MB 和模型数量上限校验 |
| DEV-P0-007 | 已完成 | 2026-07-06 | `npm run typecheck`、`npm run test`、`npm run build`、`POST /api/generations` | 已实现提示词表单、前置校验、费用预览和生成请求创建骨架 |
| DEV-P0-008 | 已完成 | 2026-07-06 | `npm run typecheck`、`npm run test`、`npm run build`、`POST /api/generations` | 已实现 OpenAI/Gemini/Generic 适配器、Mock 响应解析和后端 Mock 出图 |
| DEV-P0-009 | 已完成 | 2026-07-06 | `npm run typecheck`、`npm run test`、`npm run build`、本地服务健康检查 | 已实现 cURL 实时代码、默认占位 Key、显式真实 Key、复制和字段联动 |
| DEV-P0-009A | 已完成 | 2026-07-06 | `npm run typecheck`、`npm run test`、`npm run build`、前后端服务健康检查 | 已在菜单新增设置入口，支持模型 baseUrl、editUrl、模型级 API Key、展示名与实际请求模型名映射；默认模型切换为 `gpt-image-2` |
| DEV-P0-009B | 已完成 | 2026-07-06 | `npm run typecheck`、`npm run test`、`npm run build`、`POST /api/generations` | 已将设置中的 baseUrl 改为前缀配置，按模型自动拼接 OpenAI/Gemini 请求后缀；展示名和请求模型名默认带出并保存到浏览器本地缓存 |
| DEV-P0-009C | 已完成 | 2026-07-06 | `npm run typecheck`、`npm run test`、`npm run build`、真实上游图片生成接口测试、本地服务健康检查 | 已将默认 baseUrl 调整为 `https://ai.heigh.vip`，确认默认模型为 `gpt-image-2`，默认测试提示词为“小金毛在海边晒太阳”；真实接口返回 1 张 base64 图片，测试 Key 未写入仓库 |
| DEV-P0-009D | 已完成 | 2026-07-06 | `rg "mock\|Mock\|MOCK" src server`、`npm run typecheck`、`npm run test`、`npm run build`、无效 Key 本地生成请求复核 | 已移除生产代码中的 Mock 响应工厂和假图常量；`/api/generations` 改为请求真实上游后解析结果；结果区去掉 Mock 文案 |
| DEV-P0-009E | 已完成 | 2026-07-06 | `npm run typecheck`、`npm run test`、`npm run build`、浏览器非法 Key 负向测试、浏览器真实出图测试 | 已修复生成图片时非 ASCII API Key 进入请求头导致的 ByteString 报错；前端提交前拦截非法 Key，后端真实 `fetch` 前兜底校验适配器请求头；真实浏览器生成返回图片 |
| DEV-P0-009F | 已完成 | 2026-07-06 | `npm run typecheck`、`npm run test`、`npm run build`、浏览器端点切换与 cURL 请求体验证 | 已修复 OpenAI 图片模型尺寸/分辨率/质量参数未进入原生请求的问题；支持在设置中切换 `POST /v1/images/generations` 与 `POST /v1/responses`，默认保持 `/v1/images/generations`；生成页明确展示当前 API、完整 URL 和请求字段 |
| DEV-P0-010 | 已完成 | 2026-07-06 | `tsc --noEmit`、`vitest run --pool=threads --maxWorkers=1`、`vite build`、浏览器生成中状态验证 | 已按参考截图重构结果区为深色图片工作台；生成中右侧显示“图片正在生成”加载动画，底部缩略图显示“排队中”，成功/失败/空状态与预览操作区已统一 |
| DEV-P0-011 | 已完成 | 2026-07-06 | `tsc --noEmit`、`vitest run --pool=threads --maxWorkers=1`、`vite build`、`rg "mock\|Mock\|MOCK" src server`、浏览器无效 Key 401 错误面板验证 | 已实现统一错误映射服务，覆盖 400/401/402/403/429/5xx、网络失败、超时、临时 URL 失效和 Gemini 拒绝；右侧失败态展示标题、建议、HTTP 状态、错误码、可重试/可能计费、安全详情与“重试/设置”动作 |
| DEV-P0-012 | 已完成 | 2026-07-06 | `tsc --noEmit`、`vitest run --pool=threads --maxWorkers=1`、`vite build`、`rg "mock\|Mock\|MOCK" src server`、浏览器历史空态与失败记录验证 | 已实现本地基础历史服务，成功/失败/部分成功记录写入 `localStorage`，历史页展示模型、状态、提示词摘要、时间、张数、费用、耗时和复用动作；测试 Key 验证后已清除 |
| DEV-P0-013 | 已完成 | 2026-07-06 | `tsc --noEmit`、`vitest run --pool=threads --maxWorkers=1`、`vite build`、`rg "mock\|Mock\|MOCK" src server`、浏览器 1440/768/375 响应式验证 | 已新增 Design Token 配置并统一 CSS 变量、基础控件状态、工作台/历史页/设置弹窗响应式布局；移动端无横向滚动 |
| DEV-M2-001 | 已完成 | 2026-07-07 | `tsc --noEmit`、`vitest run --pool=threads --maxWorkers=1`、`vite build`、`rg "mock\|Mock\|MOCK" src server`、浏览器设置保存、生成队列、提示词参数、滚轮缩放和详情弹窗验证 | 已完成设置保存即时反馈、图片存放路径默认 Windows 图片目录、生成任务追加排队项、请求提示词追加尺寸/分辨率/质量、图片面板滚轮缩放、时间戳下载文件名和图片详情弹窗；详情支持遮罩与 ESC 关闭 |
| DEV-M2-002 | 已完成 | 2026-07-07 | `tsc --noEmit`、`vitest run --pool=threads --maxWorkers=1`、`vite build`、`rg "mock\|Mock\|MOCK" src server`、本地 BFF 默认上游 401 验证、不可达 baseUrl 502 诊断验证、浏览器生成错误面板验证 | 已定位生成图片 `status=502; type=network; code=UPSTREAM_REQUEST_FAILED; model=gpt-image-2` 来自旧 8787 后端进程/旧状态；重启当前 BFF 后默认上游恢复为真实上游鉴权响应；后端网络异常新增 `source=bff`、目标地址、请求方法、超时和底层 `cause.code/message` 诊断，前端错误摘要同步展示诊断详情 |
| DEV-M2-003 | 已完成 | 2026-07-07 | `tsc --noEmit`、`vitest run --pool=threads --maxWorkers=1`、`vite build`、`rg "mock\|Mock\|MOCK" src server`、浏览器连续点击、左侧插入、批量 10 线程等待队列和控制台错误验证 | 已实现“开始生成”在生成中保持可连续点击；每次新生成任务插入队列最左侧并成为激活项；批量生成页新增批量线程数量配置，支持 1 到 10 个并行生成请求，每个任务显示独立排队等待卡片 |
| DEV-M2-004 | 已完成 | 2026-07-07 | `tsc --noEmit`、`vitest run --pool=threads --maxWorkers=1`、`vite build`、`rg "mock\|Mock\|MOCK" src server`、浏览器 cURL 复制、生成/批量/模板/历史/素材/对比/识图/推理/存储埋点入口验证通过 | 已补齐 cURL 复制、生成、批量、模板、zip、历史详情、素材模板、模型对比、识图、推理和存储测试事件埋点；推理页提供运营统计摘要，便于核对高频入口使用情况 |
| DEV-M2-005 | 已完成 | 2026-07-07 | `tsc --noEmit`、`vitest run --pool=threads --maxWorkers=1`、`vite build`、`rg "mock\|Mock\|MOCK" src server`、浏览器 96 模板库、分类、搜索、使用回填和 zip 打包入口验证通过 | 已新增 8 类 96 条提示词模板库，支持分类、搜索、一键填入提示词；结果区新增成功图片 zip 打包下载，包内包含图片文件和 `manifest.json` 元数据 |
| DEV-M2-006 | 已完成 | 2026-07-07 | `tsc --noEmit`、`vitest run --pool=threads --maxWorkers=1`、`vite build`、`rg "mock\|Mock\|MOCK" src server`、浏览器菜单、空队列、3 线程生成、单项删除和控制台错误验证通过 | 删除按钮改为只删除当前激活图片或任务并自动选中相邻项；空队列不再渲染默认等待缩略卡；独立“批量生成”菜单已移除，线程数量作为“生成图片”页内配置保留，最多 10 个 |
| DEV-INFRA-001 | 已完成 | 2026-07-07 | `tsc --noEmit`、`vite build`、临时 Vite 服务 `Host: api2img1.heigh.vip` 返回 200 | Vite dev server 已允许 `heigh.vip` 根域及所有子域名访问，解决 `api2img1.heigh.vip` 被 `server.allowedHosts` 拦截的问题 |
| DEV-INFRA-002 | 已完成 | 2026-07-11 | `npm run typecheck`、`npm run test -- --pool=threads --maxWorkers=1`、`npm run build`、`GET http://127.0.0.1:8081/` 返回 200 | Vite 主工作台固定为 `8081` 并启用 `strictPort: true`；BFF 与 GPT Studio 分别保持 `8787`/`3600`，所有入口文档已同步更新 |
| DEV-M3-001 | 已完成 | 2026-07-07 | `tsc --noEmit`、`vitest run --pool=threads --maxWorkers=1`、`vite build`、`rg "mock\|Mock\|MOCK" src server`、浏览器历史详情 ESC/遮罩关闭、素材模板保存/复用/删除验证通过 | 已补齐历史详情弹窗，展示请求、参数、错误、图片和复用动作；已新增素材模板页，支持本地保存、删除、标签归一化和一键复用到生成页 |
| DEV-M3-002 | 已完成 | 2026-07-07 | `tsc --noEmit`、`vitest run --pool=threads --maxWorkers=1`、`vite build`、`rg "mock\|Mock\|MOCK" src server`、浏览器模型对比真实失败态、识图草稿空态验证通过 | 已启用模型对比页，支持左右模型、比例和分辨率分别配置并并行生成；已新增图片识别页，支持上传图片、选择识别角色并生成结构化请求草稿，不返回伪造识别结果 |
| DEV-M4-001 | 已完成 | 2026-07-07 | `tsc --noEmit`、`vitest run --pool=threads --maxWorkers=1`、`vite build`、`rg "mock\|Mock\|MOCK" src server`、浏览器高级存储测试/保存反馈、推理草稿和运营统计验证通过 | 已启用高级存储配置，支持默认云存储、R2、OSS 和本地目录模式，提供字段完整性测试和保存反馈；已新增推理测试页，可生成推理请求预览、检查清单和运营事件统计 |
| DEV-M5-001 | 已完成 | 2026-07-07 | `tsc --noEmit`、`vitest run --pool=threads --maxWorkers=1`、`vite build`、`GET 5173/8787/3600`、浏览器菜单与 iframe 验证通过 | 已引入参考项目 `GPT-Image2-Studio` 原生运行时到 `vendor/gpt-image2-studio`，保留 `public`、`lib`、`server.mjs`、脚本、部署配置和静态素材；当前项目新增 `GPT Studio` 菜单并用全尺寸 iframe 承载 `http://127.0.0.1:3600/` |
| DEV-M5-002 | 已完成 | 2026-07-07 | `rg "mock\|Mock\|MOCK" src server vendor\gpt-image2-studio\server.mjs vendor\gpt-image2-studio\lib vendor\gpt-image2-studio\public` | 已去除 vendored 服务端和 Listing Agent 的假数据路径；当前生产代码与 vendored 运行时扫描无命中 |
| DEV-M5-003 | 已完成 | 2026-07-07 | 人工检查 `docs/gpt-image2-studio-migration.md`、浏览器验证 Studio 首屏/资产路由/返回创作页 | 已新增参考项目迁移矩阵，覆盖全局导航、创作模式、资产记录、灯箱、配置、输出目录、部署脚本和 API 通道；进度台账已记录 M5 完成状态 |
| VERIFY-M5-004 | 已完成 | 2026-07-07 | 文件结构比对、功能入口比对、`tsc --noEmit`、`vitest run --pool=threads --maxWorkers=1`、`vite build`、三服务健康检查、浏览器逐页路由验证、假 Key 生成接口冒烟 | 参考项目运行时功能与当前 vendored 版本匹配：`public/lib/examples/scripts` 文件数完全一致，16 个 hash 路由、15 个页面面板和 5 个顶部动作一致；当前项目 9 个菜单页可打开，设置弹窗、生成页、BFF 生成接口和 Studio iframe 均正常；仅未迁入参考项目的非运行时 `docs/openspec/test/node_modules` 与根目录两张说明截图 |
| DEV-UX-002 | 已完成 | 2026-07-07 | `tsc --noEmit`、`vitest run --pool=threads --maxWorkers=1`、`vite build`、`rg "mock\|Mock\|MOCK" src server`、Edge 真浏览器生成数量/设置弹窗/控制台验证 | 高级存储默认切换为本地归档，默认云存储关闭、本地归档开启、图片路径为 `C:\Users\%USERNAME%\Pictures`；设置页保存主 Key、模型配置、图片路径和高级存储后立即关闭；生成页移除“生成线程”和参数区独立“数量”，统一保留“生成数量”，默认值为 1；单次上游请求固定 1 张，生成数量控制前端独立任务数；入口 HTML 补充 favicon，浏览器控制台错误数为 0 |
| DEV-UX-003 | 已完成 | 2026-07-07 | `tsc --noEmit`、`vitest run --pool=threads --maxWorkers=1`、`vite build`、`rg "mock\|Mock\|MOCK" src server`、浏览器预览滚轮/拖拽/适配验证 | 图片预览区滚轮缩放改为非 passive 原生事件拦截，缩放时不再带动外层滚动；预览图支持鼠标拖拽平移，切换图片、删除/清空和适配操作会重置缩放与平移状态；控制台错误数为 0 |
| DEV-UX-004 | 已完成 | 2026-07-07 | `tsc --noEmit`、`vitest run --pool=threads --maxWorkers=1`、`vite build`、浏览器 1440x900 与 1366x720 生成页布局验证 | 生成页桌面端改为贴合屏幕高度，外层页面不再因固定最小高度产生整页滚动；输入面板和结果工作台改为内部滚动；生产参数与生成数量合并为自适应参数组，矮屏下并排展示且完整落在输入面板可视区域内；控制台错误数为 0 |
| DEV-UX-005 | 已完成 | 2026-07-07 | `tsc --noEmit`、`vitest run --pool=threads --maxWorkers=1`、`vite build`、浏览器 1440x900 生成页验证 | 默认 `gpt-image-2` 不再展示“GPT Image 2 通用模型，429 时提示企业分组”；“生成数量”移至“质量”旁并改为 1-10 下拉；进入页面时从模板库随机抽取默认提示词；费用预估区域缩小高度和字体比例；控制台错误数为 0 |
| DEV-UX-009 | 已完成 | 2026-07-09 | `npm run typecheck`、`npm run test -- --pool=threads --maxWorkers=1`、`npm run build`、浏览器模型对比页交互保护验证 | 模型对比结果图禁用浏览器原生图片拖拽并忽略图片本体指针事件，避免拖出图片时浏览器拖放循环导致页面卡顿；开始对比时按模型 id 过滤模型对比页和主生成队列中已在生成的模型，左右选择同一模型或重复点击时只启动未运行的槽位，并提示已跳过重复模型 |
| DEV-API-001 | 已完成 | 2026-07-07 | `tsc --noEmit`、`vitest run --pool=threads --maxWorkers=1`、`vite build`、浏览器参数与 cURL 请求体验证 | 已将 OpenAI 单次生成张数 `n` 与前端批量排队次数拆分；生成页新增“生成张数/批量次数/输出格式/背景/审核/压缩”控件；cURL 和请求体直接使用 `n`、`size`、`quality`、`output_format`、`output_compression`、`background`、`moderation` 原生字段；PNG 自动禁用并移除压缩字段；费用预估按生成张数 × 批量次数计算总张数 |
| DEV-API-004 | 已完成 | 2026-07-07 | `tsc --noEmit`、`vitest run --pool=threads --maxWorkers=1`、`vite build`、真实上游直连、真实 BFF 调用、浏览器端到端生成验证 | OpenAI 图片请求超时提高到 300 秒；使用 `https://ai.heigh.vip`、`POST /v1/images/generations`、`model=gpt-image-2` 和默认提示词真实生成成功，返回 1 张 `1536 x 1024` PNG；测试 Key 已清除且未写入文档 |
| DEV-API-005 | 已完成 | 2026-07-07 | `tsc --noEmit`、`vitest run --pool=threads --maxWorkers=1`、`vite build`、浏览器图生图 cURL 请求体验证 | 图片生成/图生图/识图相关上游等待时间统一固定为 30 分钟；prompt 参数同步不再携带生成数量、审核强度和响应格式；图片预览缩放上限提升至 500%；参考图上传会立即读取为非空 base64 data URL，提交前校验空 data URL，OpenAI `/v1/images/edits` 和 `/v1/responses` 图像输入均优先发送远程 URL，否则发送非空 data URL，避免 `images[0].image_url` 为空导致 400 |
| DEV-API-006 | 已完成 | 2026-07-07 | `rg "mock\|Mock\|MOCK" src server`、`npm run typecheck`、`npm run test -- --pool=threads --maxWorkers=1`、`npm run build`、真实 BFF 推理接口、真实 BFF 识图接口 | 已核对识图/推理不再停留在草稿或 mock 阶段：`/api/recognition/analyze` 转发到 `POST /v1/chat/completions`，`/api/reasoning/test` 按平台转发到 Anthropic `POST /v1/messages`、OpenAI `POST /v1/responses` 或 `POST /v1/chat/completions`、Gemini `POST /v1beta/models/{model}:generateContent`；识图默认模型为 `gpt-5.2`，推理默认模型为 `claude-opus-4-8`，均独立于生图模型 `gpt-image-2`；测试 Key 未写入仓库或文档 |
| DEV-API-007 | 已完成 | 2026-07-08 | `rg "请求草稿\|mock\|Mock\|MOCK" src server`、`npm run typecheck`、`npm run test -- --pool=threads --maxWorkers=1`、`npm run build`、浏览器识图/推理端点与空输入错误态验证 | 根据 `https://imagen.apiyi.com/#reasoning` 的识图与推理工具形态复核本项目功能；识图页去除“请求草稿”误导文案，改为真实请求预览；浏览器确认识图默认 `gpt-5.2` 与 `POST /v1/chat/completions`，推理默认 `claude-opus-4-8` 与 `POST /v1/messages`，OpenAI 可切换 `POST /v1/responses` / `POST /v1/chat/completions`，Gemini 显示 `POST /v1beta/models/gemini-3.1-pro-preview:generateContent`；控制台错误数为 0 |
| DEV-API-008 | 已完成 | 2026-07-08 | `rg "请求草稿\|等待推理预览\|mock\|Mock\|MOCK" src server`、`npm run typecheck`、`npm run test -- --pool=threads --maxWorkers=1`、`npm run build`、浏览器识图空图错误、推理运行/取消和端点切换验证 | 已按参考站工具体验收口识图与推理：前端请求支持 `AbortSignal`，运行中按钮可变为“中止识别/中止推理”；推理新增独立参考图上传/粘贴队列，不再复用生图或识图图片；识图和推理结果区支持复制结果、请求体和原始摘要；浏览器确认识图空图返回真实 `IMAGE_REQUIRED`，推理 OpenAI 可在 `POST /v1/responses` 与 `POST /v1/chat/completions` 间切换，推理请求可中止并显示结构化 `REASONING_ABORTED`；控制台错误数为 0 |

## 变更记录

### 2026-07-14

- 完成 `DEV-EDIT-001`：新增整图、局部蒙版和双版本合并三种修图模式；支持画笔、橡皮、矩形、套索、魔棒、近似主体选区，多区域添加/减去/相交、反选、扩缩、羽化、保护区与优先级。
- 完成连续多轮与 AI 指令处理：支持指令分析、润色、冲突检测和澄清，单轮 1-4 个候选、取消、重试、检出、分支和双父合并；OpenAI Images multipart `image + mask`、Responses `previous_response_id` 与 Gemini `contents` 原生上下文均已接入，原生 continuation 不兼容或过期时自动回退为显式参考图。
- 完成工程化能力：会话、消息、任务、版本 DAG、分支和 continuation 元数据写入 SQLite，图片与蒙版写入本地资产目录；补齐评论、审核、发布、分享权限、品牌素材、成本配额、生命周期清理、指标和供应商熔断，运行时凭证不持久化。
- 完成规范多区域蒙版执行：服务端按区域顺序合成新增、减去、相交语义并生成 OpenAI 透明选区 mask；旧会话继续兼容首个已预合成蒙版，质量检查可重建规范多区域选区。
- 完成会话生命周期与降级体验：归档会话仍可在归档列表读取但禁止编辑，恢复后可继续提交并记录审计；未配置 AI Key 时使用本地指令规则降级，不再弹出设置中心遮挡澄清结果。
- 完成版本技术质量检查：展示改变像素比例、选区覆盖、选区外漂移、保护区一致性、边缘融合、告警和差异热力图；这些结果是可复现的技术代理指标，不代表审美、创意或语义质量判断。
- 完成最终视觉 QA：CDP 在 1440x900、1366x720、768x1024、390x844 四档视口验证无页面级横向溢出或三栏面板重叠；完成归档只读/恢复、首次 SSE 握手失败后的重连、真实 touch 蒙版绘制（20,456 个选中像素）、100%→125% 缩放、局部提交、澄清状态及刷新后轮次/蒙版/SSE 恢复，控制台错误数为 0。
- 完成收尾验证：`npm run typecheck`、`npm run test -- --pool=threads --maxWorkers=1`、`npm run build`、`git diff --check` 均通过，39 个测试文件 191 个用例通过；QA 脚本主动删除临时会话并复查 `GET /api/edit-sessions` 为空。本轮最终回归未调用生产上游 API Key。

### 2026-07-12

- 完成 `DEV-SUITE-001`：在独立分支 `feature/consistent-image-suite` 新增一致性套图工作台，内置“通用同主体 4 张”和“电商产品 5 张”模板；支持主体、风格、配色、光线、镜头、构图、连续性规则和负面提示词等共享规范，以及主体/风格/Logo/构图/背景五类参考图。
- 完成 `DEV-SUITE-001`：实现主视觉候选生成与人工/自动锚点确认，后续场景始终将已选锚点放在第一参考图位置；支持 2-12 个槽位、每槽位 1-4 张候选、总候选最多 24 张、全局并发 4、单套并发 1-4。
- 完成 `DEV-SUITE-001`：新增创建、编辑、开始、锚点确认、取消、失败重试、删除、历史、素材读取与 SSE 实时事件 API；任务、槽位、生成尝试和进度写入 SQLite，参考图与生成结果写入本地素材目录，服务异常退出后未完成任务标记为 `interrupted`。
- 完成安全收口：套图持久化移除 API Key、认证 Header、URL 用户信息和敏感查询参数；取消、删除或结果写入失败时清理已生成素材；远程结果归档逐次校验协议、域名白名单、DNS 公网地址和重定向，并固定解析地址、限制 50 MB、校验内容类型与 PNG/JPEG/WebP 文件签名。
- 完成前端收口：新增响应式科技感套图配置与进度工作台，支持历史切换、实时连接状态、候选预览、单图下载和危险操作确认；桌面端及 390px 移动端无横向溢出。
- 验证 `DEV-SUITE-001`：套图相关单元、服务与接口测试纳入全量测试，覆盖人工/自动锚点、SSE、取消、重试、删除、并发调度、素材归档和安全校验，`npm run test -- --pool=threads --maxWorkers=1` 通过 29 个测试文件 143 个用例；`npm run typecheck`、`npm run build` 和 `git diff --check` 通过；Playwright 在 1440px 桌面端和 390px 移动端完成响应式布局、4 槽位草稿创建、缺少凭据保护及删除流程验证，页面无横向溢出且控制台无错误。

### 2026-07-09

- 复核 `DEV-UX-009`：本轮重新核对 `src/App.tsx` 中 `runningGenerationModelCountsRef`、`runningCompareModelIdsRef` 与 `handleCreateCompare` 的运行态过滤逻辑，确认开始对比前会跳过主生成队列或模型对比页中已在生成的模型；重新核对 `.compare-preview img`、`draggable={false}` 与 `onDragStart.preventDefault()`，确认模型对比结果图禁用浏览器原生图片拖拽。`npm run typecheck`、`npm run test -- --pool=threads --maxWorkers=1` 和 `npm run build` 均通过，20 个测试文件 102 个用例通过；`http://127.0.0.1:5173/` 返回 200，`http://127.0.0.1:8787/api/health` 返回 `status=ok`；本轮内置浏览器新标签连接超时，未完成实时拖拽复测。
- 完成 `DEV-UX-009`：修复模型对比页结果图拖动导致页面卡死的问题；对比结果图片现在通过 `draggable={false}`、`onDragStart.preventDefault()` 和 `.compare-preview img { -webkit-user-drag: none; pointer-events: none; user-select: none; }` 阻止浏览器原生图片拖放。
- 完成 `DEV-UX-009`：开始对比时新增 `runningCompareModelIdsRef` 运行态集合，并结合主生成队列的 `runningGenerationModelCountsRef` 按模型 id 过滤已在生成中的模型；如果左右槽位选择同一个模型，或用户在某个模型未结束时重复点击“开始对比”，只启动未运行的模型并把跳过项写入非阻塞 warning。
- 完成测试范围修正：根项目 `npm run test` 限定为 `vitest run src/tests`，避免 vendored `GPT-Image2-Studio` 的 Node 原生测试文件被 Vitest 误收集；参考项目测试仍由 `vendor/gpt-image2-studio` 自己的 `npm test` 执行。
- 验证 `DEV-UX-009`：`npm run typecheck` 通过；`npm run test -- --pool=threads --maxWorkers=1` 通过，20 个测试文件 102 个用例通过；`npm run build` 通过；本地 `http://127.0.0.1:5173/` 和 `http://127.0.0.1:8787/api/health` 返回正常；浏览器确认“模型对比”页可打开、两个预览槽位存在、“开始对比”按钮未被运行态永久置灰，样式表包含 `.compare-preview img` 的拖拽保护规则。
- 复核 `DEV-UX-009`：重新执行 `npm run typecheck`、`npm run test -- --pool=threads --maxWorkers=1` 和 `npm run build` 均通过；浏览器打开 `http://127.0.0.1:5173/` 后确认“模型对比”页激活正常、开始按钮可用、两个预览槽位存在、控制台错误数为 0。
- 复核 `DEV-UX-009`：再次确认模型对比页卡死原因是生成图触发浏览器原生图片拖拽预览，当前通过 `draggable={false}`、`onDragStart.preventDefault()` 和 `.compare-preview img { -webkit-user-drag: none; pointer-events: none; user-select: none; }` 阻断；确认 `handleCreateCompare` 调用 `planCompareGenerationSlots`，会跳过主生成队列或模型对比页中已在生成的模型，避免连续点击或左右同模型导致重复请求。验证：`npm run typecheck`、`npm run test -- --pool=threads --maxWorkers=1` 和 `npm run build` 均通过，23 个测试文件 109 个用例通过。

### 2026-07-08

- 开始 `DEV-API-007`：根据 `https://imagen.apiyi.com/#reasoning` 继续核对识图和推理测试功能，要求页面不再出现容易被理解为 mock/草稿的文案，并确认识图、推理都通过 BFF 调用真实上游接口。
- 完成 `DEV-API-007`：识图请求预览文案已改为真实识图接口预览；推理空态改为等待真实请求预览；进度台账已修正识图 `POST /v1/chat/completions` 与推理多平台多端点的实际链路，默认工具模型记录为识图 `gpt-5.2`、推理 `claude-opus-4-8`。
- 验证 `DEV-API-007`：`rg "请求草稿|mock|Mock|MOCK" src server` 无命中；`npm run typecheck` 通过；`npm run test -- --pool=threads --maxWorkers=1` 通过，18 个测试文件 94 个用例通过；`npm run build` 通过；浏览器打开 `http://127.0.0.1:5175/`，确认识图页显示真实识图接口、默认 `gpt-5.2`、`POST /v1/chat/completions`，空图片点击开始识别返回 `IMAGE_REQUIRED`；推理页默认 `POST /v1/messages` 与 `claude-opus-4-8`，OpenAI 可切换 `POST /v1/responses` 和 `POST /v1/chat/completions`，Gemini 显示 `POST /v1beta/models/gemini-3.1-pro-preview:generateContent`；浏览器控制台错误数为 0。
- 复核 `DEV-API-007`：本次开发收尾重新执行 `rg "请求草稿|等待推理预览|mock|Mock|MOCK" src server`、`npm run typecheck`、`npm run test -- --pool=threads --maxWorkers=1` 和 `npm run build` 均通过；BFF 健康检查返回 `status=ok`；本地直连 `POST /api/recognition/analyze` 空图返回后端 `IMAGE_REQUIRED`，`POST /api/reasoning/test` 缺 Key 返回后端 `API_KEY_REQUIRED`；浏览器 `http://127.0.0.1:5175/` 再次确认识图真实端点、推理 Anthropic/OpenAI/Gemini 端点切换和控制台错误数为 0。
- 开始 `DEV-API-008`：补齐识图和推理的真实交互体验，要求运行中可取消、推理参考图独立上传、结果/请求/原始摘要可复制，并继续保持无 mock 扫描通过。
- 完成 `DEV-API-008`：`generation-api-service` 已把浏览器 `AbortSignal` 传入识图和推理 BFF 请求；识图/推理运行中按钮改为中止动作并防止晚到响应覆盖新状态；推理页新增独立参考图上传、粘贴、删除和校验；结果区新增复制结果、复制请求体、复制原始摘要，推理思考块单独展示和复制。
- 验证 `DEV-API-008`：`rg "请求草稿|等待推理预览|mock|Mock|MOCK" src server` 无命中；`npm run typecheck` 通过；`npm run test -- --pool=threads --maxWorkers=1` 通过，19 个测试文件 96 个用例通过；`npm run build` 通过；本地 `http://127.0.0.1:5173/` 与 `http://127.0.0.1:8787/api/health` 可访问；浏览器确认识图页显示 `POST /v1/chat/completions`，空图开始识别返回真实 `IMAGE_REQUIRED`；推理页有独立“上传推理参考图”，OpenAI 默认 `POST /v1/responses` 且可切换 `POST /v1/chat/completions`，运行中可中止并显示结构化 `REASONING_ABORTED`；浏览器控制台错误数为 0。

### 2026-07-07

- 开始 `DEV-API-006`：根据里程碑台账复核识图和推理测试，要求把原先只生成请求草稿的能力收口为真实 BFF 调用，并确认生产代码中没有 mock 结果路径。
- 完成 `DEV-API-006`：确认 `POST /api/recognition/analyze` 通过 `responses-api-service` 构造真实 `POST /v1/chat/completions` 视觉请求，`POST /api/reasoning/test` 按平台构造 Anthropic Messages、OpenAI Responses、OpenAI Chat Completions 或 Gemini generateContent 请求；识图、推理相关请求统一使用 30 分钟超时；识图/推理默认请求模型与生图模型配置分离。
- 验证 `DEV-API-006`：`rg "mock|Mock|MOCK" src server` 无生产 mock 命中；`npm run typecheck` 通过；`npm run test -- --pool=threads --maxWorkers=1` 通过；`npm run build` 通过；本地 BFF 健康检查返回 200；识图页面空输入返回结构化 `IMAGE_REQUIRED` 错误，推理页面缺少 Key 返回结构化 `API_KEY_REQUIRED` 错误，均未返回伪造结果；真实 API Key 未写入仓库或进度文档。
- 开始 `DEV-API-001`：根据官方 OpenAI Images 参数语义纠偏当前生成调用，要求 `n` 表示单次 API 生成张数，前端批量只表示排队请求次数，并让输出格式、背景、审核和压缩等原生参数进入真实请求体。
- 完成 `DEV-API-001`：`GenerationParams.count` 不再固定为 1，OpenAI `/v1/images/generations` 请求会按“生成张数”写入 `n`；前端“批量次数”仅创建多条队列任务；生成参数区新增输出格式、背景、审核和压缩控件，JPEG/WebP 才发送 `output_compression`，PNG 自动禁用压缩；Responses 端点的 `image_generation` tool 同步写入 `size`、`quality`、`output_format`、`output_compression` 和 `background`；默认提示词不再拼接尺寸提示，只有 size 受限模型继续用提示词补充。
- 验证 `DEV-API-001`：`tsc --noEmit` 通过；`vitest run --pool=threads --maxWorkers=1` 通过，16 个测试文件 71 个用例通过；`vite build` 通过；浏览器打开 `http://127.0.0.1:5173/`，确认“生成张数”和“批量次数”分离，默认 cURL 显式包含 `"n": 1`；选择生成张数 `3`、批量次数 `2`、`16:9 + 2K + high + WebP + 压缩 80` 后 cURL 包含 `"n": 3`、`"size": "2048x1152"`、`"quality": "high"`、`"output_format": "webp"`、`"output_compression": 80`、`"background": "auto"`、`"moderation": "auto"`，费用预估显示 `6 张`；切回 PNG 后压缩输入禁用且请求体移除 `output_compression`；控制台错误数为 0。
- 开始 `DEV-UX-005`：根据用户反馈收口生成页细节，要求删除默认 `gpt-image-2` 的企业分组提示，将生成数量放到质量旁并改为 1-10 下拉，进入页面随机抽取模板提示词，并压缩费用预估区域。
- 完成 `DEV-UX-005`：默认 `gpt-image-2` 的描述与 429 企业分组提示已移除，仅 `gpt-image-2-vip` 保留企业分组限流提示；生成参数区改为 `generation-parameter-grid`，尺寸、分辨率、质量和生成数量同组展示，生成数量使用 1-10 原生下拉；默认提示词初始化改为从 96 条模板库中随机抽取；费用预估合并说明文案并压缩内边距、间距和字体比例。
- 验证 `DEV-UX-005`：`tsc --noEmit` 通过；`vitest run --pool=threads --maxWorkers=1` 通过，16 个测试文件 71 个用例通过；`vite build` 通过；`rg "GPT Image 2 通用模型|429 时提示企业分组|generation-parameter-stack|batch-control-panel|batch-presets" src` 无命中；浏览器打开 `http://127.0.0.1:5173/`，确认参数标签为“尺寸/分辨率/质量/生成数量”、生成数量下拉包含 1-10 且位于质量旁，连续刷新默认提示词来自模板库且会变化，模型摘要不再展示旧提示，费用预估高度降低，控制台错误数为 0。
- 开始 `DEV-UX-002`：收口用户反馈，要求高级存储默认本地归档、设置页保存后立即关闭，并将“生成线程 3”和“数量 1”合并为单一“生成数量”配置。
- 完成 `DEV-UX-002`：高级存储默认 `local-directory`，默认云存储关闭、本地归档开启；保存主 Key、模型配置、图片路径和高级存储均会在保存后关闭设置弹窗；生成页移除参数区独立“数量”控件，批量入口文案改为“生成数量”，默认值改为 1，单次上游请求固定 `count: 1`，由生成数量创建前端独立任务；入口 HTML 新增内联 favicon，避免浏览器默认图标请求 404。
- 验证 `DEV-UX-002`：`tsc --noEmit` 通过；`vitest run --pool=threads --maxWorkers=1` 通过，16 个测试文件 70 个用例通过；`vite build` 通过；`rg "mock|Mock|MOCK" src server` 无命中；Edge 真浏览器打开 `http://127.0.0.1:5173/`，确认页面无“生成线程”、仅 1 个“生成数量”输入且默认值为 `1`、参数区无独立“数量”字段、快捷按钮 `1` 默认选中；设置弹窗默认存储类型为 `local-directory`、默认云存储未勾选、本地归档已勾选、图片路径为 `C:\Users\%USERNAME%\Pictures`，点击“保存图片路径”后弹窗关闭，控制台错误数为 0。
- 开始 `DEV-UX-003`：根据用户反馈收口图片预览交互，要求滚轮缩放不影响外部滚动条，并支持鼠标拖拽图片平移。
- 完成 `DEV-UX-003`：预览舞台新增非 passive 原生 `wheel` 监听并在捕获阶段阻断默认滚动和事件传播；图片预览使用 `translate3d + scale` 组合变换，支持指针拖拽平移，拖拽时关闭图片过渡；切换图片、删除/清空结果和“适配”会重置缩放与平移状态。
- 验证 `DEV-UX-003`：`tsc --noEmit` 通过；`vitest run --pool=threads --maxWorkers=1` 通过，16 个测试文件 70 个用例通过；`vite build` 通过；`rg "mock|Mock|MOCK" src server` 无命中；浏览器打开 `http://127.0.0.1:5173/`，临时本地上游生成图片后在预览区滚轮缩放从 `100%` 到 `110%` 且 `window.scrollY` 变化为 `0`，拖拽后图片变换为 `translate3d(80px, 60px, 0px) scale(1.1)`，“适配”恢复 `translate3d(0px, 0px, 0px) scale(1)`，控制台错误数为 0；临时 Key、临时端点和本地测试进程已清理。
- 开始 `DEV-UX-004`：根据用户反馈调整生成页高度策略，要求页面固定高度改为适应屏幕高度，并重新排布生产参数区域以适应不同高度。
- 完成 `DEV-UX-004`：生成页增加专属页面 class，桌面端主应用、工作区和生成页 surface 改为按 `100dvh` 约束并隐藏外层滚动，输入面板与结果工作台独立滚动；结果预览行使用 `minmax(0, 1fr)` 释放可用空间；生产参数新增 `generation-parameter-stack`，将尺寸、分辨率、质量和生成数量组成自适应参数组，矮屏桌面下横向排布并压缩标题、间距和提示词高度。
- 验证 `DEV-UX-004`：`tsc --noEmit` 通过；`vitest run --pool=threads --maxWorkers=1` 通过，16 个测试文件 70 个用例通过；`vite build` 通过；浏览器打开 `http://127.0.0.1:5173/`，在 `1440x900` 下确认 `document.scrollHeight=900`、生成页高度贴合视口、左右面板内部滚动；在 `1366x720` 下确认 `document.scrollHeight=720`、生产参数组和生成数量完整显示在输入面板可视区域内、右侧预览区保留可用高度，页面控制台错误数为 0；验证后已恢复默认浏览器视口。
- 开始 `DEV-M5-001`：根据用户要求参考 `K:\开源项目\GPT-Image2-Studio` 和 `aEboli/GPT-Image2-Studio`，将参考项目功能以原生运行时方式像素级迁入当前项目。
- 完成 `DEV-M5-001`：复制参考项目 `public`、`lib`、`server.mjs`、脚本、部署配置、示例和静态素材到 `vendor/gpt-image2-studio`；新增 `pptxgenjs` 依赖、`dev:studio-ref`/`studio-ref` 脚本；当前 `npm run dev` 会同步启动前端、BFF 和参考 Studio；主菜单新增 `GPT Studio`，使用全尺寸 iframe 承载原项目 UI。
- 完成 `DEV-M5-002`：移除 vendored 运行时里的假数据路径，参考服务端和 Listing Agent 均保留真实上游调用；`rg "mock|Mock|MOCK" src server vendor\gpt-image2-studio\server.mjs vendor\gpt-image2-studio\lib vendor\gpt-image2-studio\public` 无命中。
- 完成 `DEV-M5-003`：新增 `docs/gpt-image2-studio-migration.md`，记录参考项目全局导航、提示词生图、风格迁移、融图分析、图片拆解、图片编辑、快速融图、图片压缩、电商套图、写真、文章插图、PPT、画廊、记录、灯箱、输出目录和部署脚本的迁移落点。
- 验证 `DEV-M5`：`tsc --noEmit` 通过；`vitest run --pool=threads --maxWorkers=1` 通过，16 个测试文件 70 个用例通过；`vite build` 通过；前端 `http://127.0.0.1:5173/`、BFF `http://127.0.0.1:8787/api/health`、参考 Studio `http://127.0.0.1:3600/` 均返回 200；浏览器点击 `GPT Studio` 后 iframe 加载原项目 Studio，首屏创作面板、设置面板、画廊/PPT/套图入口和“开始生成”按钮可见；iframe 内部资产路由和返回创作页通过，控制台错误数为 0。
- 完成 `VERIFY-M5-004`：核对参考项目 `K:\开源项目\GPT-Image2-Studio` 与当前 `vendor/gpt-image2-studio`，运行时核心目录 `public` 472 个文件、`lib` 102 个文件、`examples` 3 个文件、`scripts` 4 个文件均无缺失或多余；`server.mjs` API 路由模式一致，文件大小差异来自移除假数据路径；参考项目的 16 个 hash 路由、15 个页面面板和 5 个顶部动作在当前 vendored 版本中一致。
- 验证 `VERIFY-M5-004`：当前项目 `tsc --noEmit` 通过；`vitest run --pool=threads --maxWorkers=1` 通过，16 个测试文件 70 个用例通过；`vite build` 通过；前端、BFF、Studio 三个本地入口均返回 200；浏览器验证主项目 9 个菜单、默认提示词、默认 `/v1/images/generations`、cURL 区、设置弹窗、批量/对比/历史/素材/识图/推理页面均可打开，控制台错误数为 0；使用假 Key 生成接口冒烟返回结构化 `401/auth`，适配器为 `openai-image`；Studio iframe 正常加载，15 个页面面板逐页可见，`#style-transfer` 风格迁移模式可见，控制台错误数为 0。
- 开始 `DEV-M2-001`：根据用户反馈完善设置保存反馈、图片存放路径、生成队列、提示词参数尾缀、图片缩放、下载文件名和详情查看体验。
- 完成 `DEV-M2-001`：设置弹窗中“保存主 Key”“保存模型配置”“保存图片路径”均有即时反馈；新增图片存放路径配置并默认 `C:\Users\%USERNAME%\Pictures`；生成新图片时先在队列追加“排队中”缩略图，成功或失败后替换对应队列项，不覆盖已有结果；请求提示词末尾追加当前尺寸、分辨率和质量；预览舞台支持鼠标滚轮缩放；下载和详情文件名使用时间戳；“详情”按钮打开图片详情弹窗并支持遮罩和 ESC 关闭。
- 验证 `DEV-M2-001`：`tsc --noEmit` 通过；`vitest run --pool=threads --maxWorkers=1` 通过，10 个测试文件 53 个用例通过；`vite build` 通过；`rg "mock|Mock|MOCK" src server` 无命中；浏览器打开 `http://127.0.0.1:5173`，确认保存反馈文案、图片路径默认值、`/v1/images/generations` 当前 API、cURL 和本地上游请求均包含 `参数要求：画幅比例 16:9，分辨率 2K，质量 high`、`size=2048x1152`、`quality=high`；连续生成时队列从 `1 张成功 + 1 张排队中` 变为 `2 张成功`；滚轮缩放从 `100%` 变为 `110%`；详情弹窗展示时间戳文件名和图片存放路径，并可通过遮罩和 ESC 关闭。
- 开始 `DEV-M2-002`：排查用户浏览器生成报错 `status=502; type=network; code=UPSTREAM_REQUEST_FAILED; model=gpt-image-2`，重点核对本地 BFF 进程、默认上游端点和错误诊断可见性。
- 完成 `DEV-M2-002`：重启当前源码对应的 8787 BFF 后，默认 `https://ai.heigh.vip/v1/images/generations` 使用占位 Key 返回上游 `401/auth`，不再返回本地网络 `502`；`sendAdapterHttpRequest` 对 fetch/超时异常补充脱敏诊断 `source=bff`、`target`、`method`、`timeoutMs`、`error.name`、`cause.code` 和 `cause.message`；前端 `summarizeRawBody` 会将 `error.details` 展示到安全摘要中。
- 验证 `DEV-M2-002`：浏览器点击“开始生成”后右侧错误面板显示 `API Key 认证失败`、`HTTP 401`、`status=401; type=auth; model=gpt-image-2`，未出现 `status=502` 或 `UPSTREAM_REQUEST_FAILED`，验证后已清除占位 Key；本地 `POST /api/generations` 默认上游返回 `generationStatus=failed`、`upstreamStatus=401`、`requestUrl=https://ai.heigh.vip/v1/images/generations`；不可达 `baseURL=https://does-not-exist.invalid` 返回 `upstreamStatus=502` 且 `rawExcerpt` 包含 `error.details=source=bff`、`target=does-not-exist.invalid/v1/images/generations`、`cause.code=ENOTFOUND`；`tsc --noEmit`、`vitest run --pool=threads --maxWorkers=1`、`vite build` 均通过，`rg "mock|Mock|MOCK" src server` 无命中。
- 开始 `DEV-M2-003`：根据用户反馈调整生成队列交互，要求“开始生成”支持连续点击、新任务进入队列最左侧，并启用最多 10 个线程的批量生成等待效果。
- 完成 `DEV-M2-003`：生成页提交逻辑改为为每次点击创建独立队列项并异步请求上游，不再因生成中禁用主按钮；队列替换逻辑在结果缺失时保持左侧插入；批量生成页新增线程数量输入和 `1/3/5/10` 快捷按钮，数量强制限制在 `1-10`，每个批量任务独立显示 `排队 x/10` 等待卡片。
- 验证 `DEV-M2-003`：浏览器打开 `http://127.0.0.1:5173`，保存占位 Key 后连续点击“开始生成”两次，确认第一次生成后按钮仍可点击，第二次任务位于缩略图队列最左侧且为激活项；切换“批量生成”后将线程数输入 `99` 自动限制为 `10`，点击“开始生成”立即出现 `排队 1/10` 到 `排队 10/10` 十个等待卡片，并显示 `10 个任务正在调用模型`，按钮仍未置灰；占位 Key 已清除，浏览器控制台错误数为 0。
- 开始 `DEV-M2-004`：核对 cURL 完整联动和运营埋点缺口，要求复制 cURL、生成、批量、模板、zip、历史详情、素材、对比、识图、推理和存储测试均有本地事件记录。
- 完成 `DEV-M2-004`：新增本地埋点服务，事件写入 `localStorage` 并自动截断敏感/过长属性；生成页、批量生成、cURL 复制、模板库、zip 下载、历史详情、素材模板、模型对比、识图、推理和存储测试均已接入；推理页新增运营统计摘要。
- 验证 `DEV-M2-004`：`tsc --noEmit` 通过；`vitest run --pool=threads --maxWorkers=1` 通过，16 个测试文件 70 个用例通过；`vite build` 通过；`rg "mock|Mock|MOCK" src server` 无命中；浏览器复核 cURL 复制、连续生成、批量 10 线程等待、模板使用、历史详情、素材模板、模型对比、识图、推理、存储测试与运营统计入口均通过，控制台错误数为 0。
- 开始 `DEV-M2-005`：补齐模板库和结果打包下载能力，要求模板可分类/搜索/复用，成功图片可按 zip 下载并包含元数据清单。
- 完成 `DEV-M2-005`：新增 8 类 96 条提示词模板，本地模板弹窗支持分类、搜索和一键填入；结果区新增“打包下载”，将成功图片和 `manifest.json` 写入时间戳 zip 文件，并显示进度/失败反馈。
- 验证 `DEV-M2-005`：`tsc --noEmit` 通过；`vitest run --pool=threads --maxWorkers=1` 通过，覆盖模板数量、搜索、zip 文件名、图片内容和 manifest；`vite build` 通过；`rg "mock|Mock|MOCK" src server` 无命中；浏览器复核 96 条模板库、摄影分类 12 条、搜索/分类、模板使用回填和 zip 打包入口均通过。
- 开始 `DEV-M2-006`：根据用户反馈收口结果队列交互，要求删除按钮只删除当前图片或任务、空队列不再显示默认等待结果，并将“批量生成”和“生成图片”两个菜单合并。
- 完成 `DEV-M2-006`：结果区删除按钮改为调用单项删除逻辑，删除后自动激活相邻结果，删除排队项时同步移出运行请求集合；队列为空时不再渲染缩略图条和默认等待卡；前端兜底配置、后端 bootstrap 和 `PageKey` 均移除独立 `batch` 页面，生成页保留“生成线程”控件与 `1/3/5/10` 快捷按钮。
- 验证 `DEV-M2-006`：`tsc --noEmit` 通过；`vitest run --pool=threads --maxWorkers=1` 通过，16 个测试文件 70 个用例通过；`vite build` 通过；`rg "mock|Mock|MOCK" src server` 无命中；浏览器使用 `http://localhost:5173` 临时测试源验证导航仅剩 `GPT Studio/生成图片/模型对比/历史记录/素材模板/识别图片/推理测试/设置` 8 项，初始空队列无等待卡，临时假 Key 触发 3 线程生成后出现 3 个独立失败卡，点击“删除”后仅当前卡被移除并保留 2 个结果，继续删除至空队列后仍无默认等待卡，控制台错误数为 0。
- 完成 `DEV-INFRA-001`：`vite.config.ts` 新增 `server.allowedHosts: [".heigh.vip"]`，允许 `heigh.vip` 根域及所有子域名访问 Vite dev server；`tsc --noEmit` 和 `vite build` 均通过；临时启动 5174 端口 Vite 服务并使用 `Host: api2img1.heigh.vip` 请求返回 200，验证后已关闭临时进程。
- 完成 `DEV-INFRA-002`：`vite.config.ts` 将主工作台端口从 `5173` 固定为 `8081`，并通过 `strictPort: true` 防止端口占用时自动切换；`README.md` 和 Studio 迁移文档的入口地址已同步。验证：`npm run typecheck`、`npm run test -- --pool=threads --maxWorkers=1`（23 个文件、109 个用例）和 `npm run build` 均通过；临时启动前端后，`http://127.0.0.1:8081/` 返回 200、监听地址为 `0.0.0.0:8081`，验证后已停止测试进程。BFF 和 GPT Studio 保持 `8787`、`3600` 不变。
- 开始 `DEV-M3-001`：补齐资产复用能力中的历史详情和素材模板，要求历史可查看完整字段并复用，素材模板可本地沉淀。
- 完成 `DEV-M3-001`：历史页新增详情弹窗，展示请求、参数、错误、图片、耗时和复用动作；素材模板页支持本地保存、删除、标签归一化、引用图数量记录和一键复用到生成页。
- 验证 `DEV-M3-001`：`tsc --noEmit` 通过；`vitest run --pool=threads --maxWorkers=1` 通过，覆盖素材模板保存、更新、删除和本地加载；`vite build` 通过；`rg "mock|Mock|MOCK" src server` 无命中；浏览器复核历史详情字段、复用记录、ESC/遮罩关闭，以及素材模板新增、复用、删除均通过。
- 开始 `DEV-M3-002`：补齐模型对比和图片识别页，要求模型对比可发起真实上游请求，图片识别仅生成请求草稿，不生成伪造识别结论。
- 完成 `DEV-M3-002`：模型对比页支持左右模型、比例和分辨率独立配置并并行生成；识图页支持上传校验、识别角色选择、图片事实清单和结构化请求预览。
- 验证 `DEV-M3-002`：`tsc --noEmit` 通过；`vitest run --pool=threads --maxWorkers=1` 通过，覆盖识图请求草稿和空态；`vite build` 通过；`rg "mock|Mock|MOCK" src server` 无命中；浏览器复核模型对比左右槽位真实请求失败态可收口，识图空态生成 `imageCount: 0` 与 `images: []` 草稿通过。
- 开始 `DEV-M4-001`：补齐灰度能力中的高级存储、推理测试和运营检查入口，要求配置可保存、可测试、可回显。
- 完成 `DEV-M4-001`：设置弹窗新增默认云存储、R2、OSS、本地目录模式，支持字段完整性测试、保存反馈和 lastTestResult 回显；推理测试页支持平台/模型/推理强度/tokens/提示词配置，生成请求预览、检查清单和运营统计。
- 验证 `DEV-M4-001`：`tsc --noEmit` 通过；`vitest run --pool=threads --maxWorkers=1` 通过，覆盖存储配置保存、联合保存、字段完整性测试和推理请求草稿；`vite build` 通过；`rg "mock|Mock|MOCK" src server` 无命中；浏览器复核高级存储测试/保存反馈、推理请求预览、检查项和运营统计增长均通过。
- 已完成浏览器复核：M2/M3/M4/M5 收口入口在 `http://127.0.0.1:5173` 交互可用，控制台错误数为 0，测试 Key 已清理。

### 2026-07-06

- 完成 `PLAN-001`：创建开发计划和进度台账。
- 开始 `DEV-P0-001`：从空仓库搭建前后端 TypeScript 项目。
- 完成 `DEV-P0-001`：新增 `package.json`、`tsconfig.json`、`vite.config.ts`、前端入口、AppShell、基础样式和 Express BFF。
- 验证 `DEV-P0-001`：`npm run typecheck` 通过；`npm run build` 通过；`/api/config/bootstrap` 返回 7 个导航项。
- 开始 `DEV-P0-002`：抽取共享枚举、配置响应和生成领域类型，减少页面内联类型。
- 完成 `DEV-P0-002`：新增 `src/domain/common.ts`、`config.ts`、`model.ts`、`generation.ts`、`settings.ts`、`error.ts` 和统一导出。
- 验证 `DEV-P0-002`：`npm run typecheck` 通过；`npm run build` 通过；`/api/config/bootstrap` 返回 `success=true`、7 个导航项、1 条公告和响应级 `serverTime`。
- 开始 `DEV-P0-003`：实现配置驱动的 16 个模型清单，并接入前后端 bootstrap。
- 完成 `DEV-P0-003`：新增 `src/config/models.ts`，包含 16 个首期模型、`DEFAULT_MODEL_ID`、模型查询函数和完整 `ModelConfig` 字段。
- 验证 `DEV-P0-003`：配置模块返回 16 个启用模型；默认模型为 `nano-banana-pro`；`gpt-image-2-vip` 有 1 条临时限制；`gpt-image-1-5` 输出上限为 4；后端 bootstrap 返回 16 个模型。
- 开始 `DEV-P0-004`：实现 `resolveModelCapabilities`，让临时限制可强制参数、置灰选项并输出提示。
- 完成 `DEV-P0-004`：新增 `src/domain/model-capabilities.ts`，生成页参数控件已读取解析后的模型能力。
- 验证 `DEV-P0-004`：`npm run typecheck` 通过；`npm run test` 通过，3 个能力解析单测通过；`npm run build` 通过。
- 开始 `DEV-P0-005`：实现 API Key 本地设置、默认脱敏展示和显示真实 Key 的显式操作。
- 完成 `DEV-P0-005`：新增 `src/services/settings-service.ts`、设置弹窗、Key 输入、保存、清除、显示/隐藏和脱敏状态展示。
- 验证 `DEV-P0-005`：`npm run typecheck` 通过；`npm run test` 通过，6 个单测通过；`npm run build` 通过。
- 开始 `DEV-P0-006`：实现参考图点击/拖拽上传、JPG/PNG、20 MB 和模型数量上限校验。
- 完成 `DEV-P0-006`：新增上传校验服务、上传单测、参考图上传区、拖拽/选择图片入口、错误提示和缩略图列表。
- 验证 `DEV-P0-006`：`npm run typecheck` 通过；`npm run test` 通过，3 个测试文件 10 个用例通过；`npm run build` 通过。
- 下一步进入 `DEV-P0-007`：实现生成表单和费用区。
- 开始 `DEV-P0-007`：接入提示词受控输入、费用预览、表单级校验和 `/api/generations` 创建请求骨架。
- 完成 `DEV-P0-007`：新增 `generation-form-service`、`generation-api-service`、后端 `POST /api/generations`、费用区和请求创建反馈。
- 验证 `DEV-P0-007`：`npm run typecheck` 通过；`npm run test` 通过，4 个测试文件 15 个用例通过；`npm run build` 通过；临时端口请求 `/api/generations` 返回 `success=true` 和 `status=running`。
- 下一步进入 `DEV-P0-008`：实现 OpenAI/Gemini/Generic 模型适配器与 Mock 响应。
- 开始 `DEV-P0-008`：实现统一图片模型适配器接口、请求草稿构造、路径解析和 Mock 响应闭环。
- 完成 `DEV-P0-008`：新增 `src/adapters`，包含 OpenAI、Gemini、Generic 适配器、通用响应解析、cURL 预留、Mock 响应工厂和后端 `/api/generations` 适配器接入。
- 验证 `DEV-P0-008`：`npm run typecheck` 通过；`npm run test` 通过，5 个测试文件 22 个用例通过；`npm run build` 通过；临时端口请求 `/api/generations` 返回 `success=true`、`status=success`、`adapter=gemini-image`、`imageCount=1`。
- 下一步进入 `DEV-P0-009`：实现 cURL 面板，支持脱敏/显示真实 Key、复制和与当前适配器请求同步。
- 开始 `DEV-P0-009`：实现 cURL 实时预览服务和生成页折叠面板。
- 完成 `DEV-P0-009`：新增 `curl-service`、`CurlState` 类型、cURL 单测和生成页 cURL 面板；默认使用 `sk-YOUR_API_KEY`，仅显式勾选后展示真实 Key；复用适配器请求构造，自动移除不支持的 `response_format` 和临时禁用的 `size` 字段。
- 验证 `DEV-P0-009`：`npm run typecheck` 通过；`npm run test` 通过，6 个测试文件 25 个用例通过；`npm run build` 通过；本地开发服务启动成功，`/api/health` 返回 `ok`。
- 开始 `DEV-P0-009A`：根据用户要求在菜单中新增设置配置，支持模型调用 baseUrl/API Key 和展示名到实际请求模型名映射。
- 完成 `DEV-P0-009A`：侧栏菜单已新增“设置”；设置弹窗扩展为主 API Key 与模型配置两块；本地设置可保存模型展示名、`apiModelName`、`baseURL`、`editURL`、模型级 `apiKey`；模型下拉、cURL 预览和 `/api/generations` 请求均使用覆盖配置；默认模型已切换为 `gpt-image-2`。
- 验证 `DEV-P0-009A`：`npm run typecheck` 通过；`npm run test` 通过，6 个测试文件 29 个用例通过；`npm run build` 通过。
- 启动并复核项目：前端 `http://127.0.0.1:5173` 返回 200；后端 `http://127.0.0.1:8787/api/health` 返回 `ok`；`/api/config/bootstrap` 返回默认模型 `gpt-image-2` 和“设置”菜单项。
- 开始 `DEV-P0-009B`：根据反馈调整模型设置，要求 `baseUrl` 只填写前缀，展示名和实际请求模型名带默认值，并继续缓存到浏览器本地。
- 完成 `DEV-P0-009B`：新增模型端点拼接服务；设置弹窗改为 `baseUrl 前缀`；展示名和请求模型名输入框默认填入当前模型值；保存时会把旧完整端点规范化为前缀并写入 `localStorage`；生成请求和 cURL 会按模型自动拼接 `/v1/images/generations`、`/v1/images/edits` 或 `/v1beta/models/{apiModelName}:generateContent`。
- 验证 `DEV-P0-009B`：`npm run typecheck` 通过；`npm run test` 通过，7 个测试文件 33 个用例通过；`npm run build` 通过；只传 `https://proxy.example` 时 OpenAI 适配器 URL 为 `https://proxy.example/v1/images/generations`；只传 `https://gemini.example` 且模型名为 `gemini-image-real` 时 Gemini 适配器 URL 为 `https://gemini.example/v1beta/models/gemini-image-real:generateContent`。
- 开始 `DEV-P0-009C`：根据用户指定默认值调整默认 baseUrl、默认模型和测试提示词，并使用真实上游接口验证出图链路。
- 完成 `DEV-P0-009C`：默认 baseUrl 已切换为 `https://ai.heigh.vip`；默认模型确认使用 `gpt-image-2`；生成页默认提示词改为“小金毛在海边晒太阳”；OpenAI/Gemini 端点仍按 baseUrl 前缀自动拼接模型后缀。
- 验证 `DEV-P0-009C`：`npm run typecheck` 通过；`npm run test` 通过，7 个测试文件 33 个用例通过；`npm run build` 通过；真实上游 `gpt-image-2` 图片生成测试成功，返回 1 张 base64 图片；真实 API Key 仅用于本次测试，未写入仓库或进度文档；前端 `http://127.0.0.1:5173` 和后端 `http://127.0.0.1:8787/api/health` 均返回 200。
- 开始 `DEV-P0-009D`：根据用户反馈移除代码中的 Mock 功能，避免结果区继续展示 Mock 生成状态。
- 完成 `DEV-P0-009D`：删除生产代码中的 Mock 响应工厂和硬编码假图；后端 `/api/generations` 改为使用适配器构造请求、调用真实上游、解析真实响应；适配器请求摘要移除 `mock` 字段；前端结果区文案改为“生成完成/部分生成完成/生成失败”。
- 验证 `DEV-P0-009D`：`rg "mock|Mock|MOCK" src server` 无命中；`npm run typecheck` 通过；`npm run test` 通过，7 个测试文件 33 个用例通过；`npm run build` 通过；使用无效 Key 请求本地 `/api/generations` 返回 `status=failed`、`imageCount=0`、错误标题“认证失败”，确认接口不再返回假成功图片。
- 开始 `DEV-P0-009E`：解决生成图片时报错 `Cannot convert argument to a ByteString`，定位为 API Key 等请求头值包含中文、换行或其它非法字符时浏览器/Node 在构造 headers 前抛错。
- 完成 `DEV-P0-009E`：新增请求头字符检查服务；生成表单在提交前校验 API Key 只能包含可安全进入请求头的英文、数字和常见符号；后端 `sendAdapterHttpRequest` 在真实 `fetch` 前检查所有适配器请求头，发现非法值时返回可解析的 400 风格上游响应，避免 ByteString 异常泄露到页面。
- 验证 `DEV-P0-009E`：`npm run typecheck` 通过；`npm run test` 通过，8 个测试文件 37 个用例通过；`npm run build` 通过；浏览器中使用包含中文说明的 Key 生成时不再出现 ByteString 报错，并展示友好 API Key 校验提示；浏览器中使用真实 Key 和默认提示词“小金毛在海边晒太阳”生成成功，页面返回 `status=success`、`adapter=openai-image` 且展示图片；真实 API Key 仅用于本次浏览器测试，未写入仓库或进度文档。
- 开始 `DEV-P0-009F`：根据用户反馈处理尺寸、分辨率、质量参数未生效，并要求页面明确展示当前使用的 API 端点且允许在 OpenAI Images 与 Responses 之间切换。
- 完成 `DEV-P0-009F`：新增 OpenAI 端点变体配置和本地持久化；`baseUrl` 仍只保存前缀，按端点自动拼接 `/v1/images/generations` 或 `/v1/responses`；OpenAI 适配器按端点生成不同请求体，`/v1/images/generations` 使用 `prompt + size + quality`，`/v1/responses` 使用 `input + tools[{type:"image_generation",size,quality}] + tool_choice`；生成页新增“当前 API”展示，cURL 与结果摘要同步显示真实端点。
- 验证 `DEV-P0-009F`：`tsc --noEmit` 通过；`vitest run` 通过，8 个测试文件 42 个用例通过；`vite build` 通过；`rg "mock|Mock|MOCK" src server` 无命中；浏览器打开 `http://127.0.0.1:5173` 后确认默认 `POST https://ai.heigh.vip/v1/images/generations`，选择 `16:9 + 2K + high` 后 cURL 包含 `size: "2048x1152"` 和 `quality: "high"`；切换到 `POST /v1/responses` 后页面与 cURL 均显示 `/v1/responses`、`tools`、`image_generation` 和 `tool_choice`，最后已恢复默认 `/v1/images/generations`。
- 开始 `DEV-P0-010`：根据参考截图重构结果区布局，补齐右侧生成等待动画、底部队列缩略图和预览工具栏。
- 完成 `DEV-P0-010`：结果区已改为深色图片工作台，顶部展示模型、时间、请求 ID、分辨率和 API 端点；中部预览舞台支持生成中动画、图片预览、失败态和空态；下方提供缩放、适配、下载、查看、删除和缩略图队列。
- 验证 `DEV-P0-010`：浏览器打开 `http://127.0.0.1:5173`，临时使用本地延迟上游验证生成中状态，确认 `.result-panel.is-generating`、`.generation-loader`、文案“图片正在生成”和底部“排队中”均出现；验证后已停止延迟上游、清除测试 Key，并恢复默认 `https://ai.heigh.vip/v1/images/generations`。
- 开始 `DEV-P0-011`：完善错误映射，让上游失败、认证失败、限流、网络中断和参数错误有更清晰的页面提示。
- 完成 `DEV-P0-011`：新增统一错误映射服务，后端适配器错误统一归一化为结构化 `GenerationError`；前端生成请求保留后端错误结构，右侧结果区失败态升级为错误面板，展示标题、消息、建议、错误类型、HTTP 状态、错误码、可重试、可能计费和安全详情；认证/权限/额度错误提供“设置”动作，可重试错误提供“重试”动作。
- 验证 `DEV-P0-011`：`tsc --noEmit` 通过；`vitest run --pool=threads --maxWorkers=1` 通过，9 个测试文件 47 个用例通过；`vite build` 通过；`rg "mock|Mock|MOCK" src server` 无命中；浏览器打开 `http://127.0.0.1:5173`，使用无效但请求头合法的 Key 触发真实上游失败，确认默认端点为 `https://ai.heigh.vip/v1/images/generations`，右侧 `.stage-error-panel` 展示“API Key 认证失败”、`HTTP 401`、认证失败标签、安全详情和“设置”按钮；验证后已清除测试 Key。
- 下一步进入 `DEV-P0-012`：实现基础历史，成功、失败和部分成功生成均写入本地历史记录，并在历史页展示基础列表。
- 开始 `DEV-P0-012`：实现本地基础历史，沉淀成功、失败和部分成功生成记录，并在历史页展示基础列表。
- 完成 `DEV-P0-012`：新增 `history-service` 和历史单测；生成成功/失败后写入本地历史；历史页展示本地记录数、空态、清空历史、缩略图、模型、状态、提示词摘要、时间、张数、费用、耗时、临时链接标签和复用动作。
- 验证 `DEV-P0-012`：`tsc --noEmit` 通过；`vitest run --pool=threads --maxWorkers=1` 通过，10 个测试文件 50 个用例通过；`vite build` 通过；`rg "mock|Mock|MOCK" src server` 无命中；浏览器打开 `http://127.0.0.1:5173`，确认历史空态显示 `0 本地记录` 和 `0 条记录`，使用无效但请求头合法的 Key 触发真实上游 401 后，历史页显示 1 条失败记录，包含 `GPT Image 2`、失败状态、提示词摘要“小金毛在海边晒太阳”、`0 张`、费用待确认、耗时和“复用”按钮；验证后已清除测试 Key。
- 下一步进入 `DEV-P0-013`：梳理视觉设计系统，统一色彩、间距、控件状态和工作台响应式体验。
- 开始 `DEV-P0-013`：梳理视觉设计系统，统一色彩、间距、圆角、阴影、动效、控件状态和工作台响应式体验。
- 完成 `DEV-P0-013`：新增 `src/config/design-tokens.ts`；在 `src/styles.css` 中落地 CSS Design Token 变量，统一全局背景、文字、按钮、输入框、焦点态、禁用态、导航、页面容器、输入面板、API 端点卡、cURL 面板、结果工作台、历史页和设置弹窗样式；中等屏改为单列工作台，移动端加强长 URL/cURL 换行和弹窗边界保护。
- 验证 `DEV-P0-013`：`tsc --noEmit` 通过；`vitest run --pool=threads --maxWorkers=1` 通过，10 个测试文件 50 个用例通过；`vite build` 通过；`rg "mock|Mock|MOCK" src server` 无命中；浏览器打开 `http://127.0.0.1:5173` 验证 1440x900、768x1024、375x812 三个视口均无页面横向滚动，默认端点显示 `https://ai.heigh.vip/v1/images/generations`，手机设置弹窗完整位于视口内且无内部横向溢出，历史页记录卡片在 375px 宽度下正常收敛；浏览器控制台错误数为 0。
- 下一步进入 `M2 P0/P1 效率能力`：规划批量抽卡、cURL 完整联动、模板库、zip 下载和埋点的开发顺序。

- 完成 `DEV-API-002`：修复 `gpt-image-2` 在 `n > 1` 时多图结果没有拆成多条队列记录的问题；OpenAI 图片请求会发送原生 `n`，请求前将比例、请求分辨率、质量、生成数量、输出格式、背景、审核强度等参数同步追加到 prompt；响应解析支持 `data[]`、`images[]`、`output[].result` 数组和多种 OpenAI 图片字段；前端将 `response.result.images` 映射成多个成功缩略图并保留在图片队列中。
- 验证 `DEV-API-002`：`tsc --noEmit` 通过；`vitest run src\tests\unit\image-adapters.test.ts --pool=threads --maxWorkers=1` 通过，13 个用例通过；`vitest run --pool=threads --maxWorkers=1` 通过，16 个测试文件 72 个用例通过；`vite build` 通过；浏览器打开 `http://127.0.0.1:5173`，配置 `gpt-image-2 + n=2 + 9:16 + 1K + high` 后真实调用 `https://ai.heigh.vip/v1/images/generations`，队列由 1 个排队项替换为 2 个成功缩略图，页面提示“已解析 2 张图片”，两张缩略图均可独立选中；详情弹窗显示“请求分辨率档位 1K”和真实“实际分辨率 941 x 1672”，不再把分辨率档位误显示为实际像素。

- 完成 `DEV-UX-007`：按用户要求移除内置模型 `GPT Image 2 All` 和 `GPT Image 2 VIP`；`src/config/models.ts` 内置模型清单从 16 个调整为 14 个，并移除 `gpt-image-2-vip` 专属临时限制与企业分组提示分支；相关单测不再依赖已删除模型，改为在测试内构造临时模型夹具覆盖限制、提示词和适配器场景。
- 验证 `DEV-UX-007`：`rg "gpt-image-2-all|gpt-image-2-vip|GPT Image 2 All|GPT Image 2 VIP" src server src\tests` 无命中；`tsc --noEmit` 通过；`vitest run --pool=threads --maxWorkers=1` 通过，17 个测试文件 78 个用例通过；`vite build` 通过；浏览器打开 `http://127.0.0.1:5173` 后主模型下拉为 14 个选项，设置弹窗模型管理列表为 14 个内置模型，均不再展示 `GPT Image 2 All` 和 `GPT Image 2 VIP`。

- 完成 `DEV-UX-008`：设置弹窗重排为双 Tab，`API 与模型` 合并主 API Key 与模型映射/模型管理，`存储与图片` 合并图片存放路径与高级存储；移除 `保存主 Key`、`保存模型配置`、`保存图片路径`、`保存高级存储` 等分区保存按钮，弹窗底部全局保留唯一 `保存设置` 入口，任意 Tab 修改后统一保存，保存成功后立即关闭弹窗。
- 验证 `DEV-UX-008`：`tsc --noEmit` 通过；`vitest run --pool=threads --maxWorkers=1` 通过，17 个测试文件 78 个用例通过；`vite build` 通过；浏览器打开 `http://127.0.0.1:5173`，确认设置弹窗标题为 `设置中心`，两个 Tab 切换正常，首个 Tab 仅展示 API 与模型内容，第二个 Tab 展示图片存放路径与高级存储，弹窗内仅有一个保存按钮 `保存设置`，点击后弹窗立即关闭；浏览器控制台错误数为 0。

- 完成 `DEV-API-003`：修复 OpenAI 图片错误详情中 `model=` 使用内部模型 id 导致与 cURL 请求体不一致的问题；错误诊断现在优先展示实际请求模型名 `apiModelName`，当内部模型 id 不同时额外展示 `modelId`，避免误判为未使用模型映射配置；同时将带参考图的 OpenAI 编辑请求字段从 `image` 调整为上游代理兼容的 `images`。
- 验证 `DEV-API-003`：`tsc --noEmit` 通过；`vitest run src\tests\unit\error-service.test.ts src\tests\unit\image-adapters.test.ts --pool=threads --maxWorkers=1` 通过，2 个测试文件 20 个用例通过；`vitest run --pool=threads --maxWorkers=1` 通过，17 个测试文件 80 个用例通过；`vite build` 通过。
- 开始 `DEV-API-004`：根据真实上游慢请求现象复核 `ai.heigh.vip` 下 `gpt-image-2` 生成链路，排查 BFF 侧超时是否导致成功上游响应被误报为失败。
- 完成 `DEV-API-004`：OpenAI 图片模型请求超时从 120 秒提高到 300 秒；确认实际请求端点为 `https://ai.heigh.vip/v1/images/generations`，请求模型为 `gpt-image-2`；真实直连、BFF 和浏览器按钮链路均能完成生成。
- 验证 `DEV-API-004`：`tsc --noEmit` 通过；`vitest run --pool=threads --maxWorkers=1` 通过，17 个测试文件 80 个用例通过；`vite build` 通过；真实 BFF 返回 `generationStatus=success`、`adapter=openai-image`、`resultImageCount=1`；浏览器打开 `http://127.0.0.1:5173/` 使用默认提示词“小金毛在海边晒太阳”点击生成后展示“生成完成”和“已解析 1 张图片”，实际图片尺寸为 `1536 x 1024`；验证后已清除浏览器中的测试 Key。
- 开始 `DEV-API-005`：根据用户反馈收口图生图请求参数错误，要求等待时间固定最多 30 分钟，prompt 不携带生成数量、审核强度和响应格式，预览缩放最大 500%，并修复 `images[0].image_url` 为空 base64 data URL 导致的 400。
- 完成 `DEV-API-005`：新增图片请求统一超时常量并应用到 OpenAI/Gemini 图片模型；prompt 参数同步仅保留尺寸、分辨率、质量、输出格式、背景和压缩等有助于生成质量的描述，排除生成数量、审核强度和响应格式；参考图上传流程改为异步读取文件 data URL 并保存到队列，表单校验会拦截空 base64；OpenAI 编辑端点和 Responses 图片输入统一通过 `referenceToImageURL` 输出远程 URL 或非空 data URL；图片预览缩放上限调整为 500%。
- 验证 `DEV-API-005`：`tsc --noEmit` 通过；`vitest run --pool=threads --maxWorkers=1` 通过，17 个测试文件 82 个用例通过；`vite build` 通过；浏览器内合成参考图触发上传后 cURL 预览为 `POST https://ai.heigh.vip/v1/images/edits`，请求体包含非空 `images[0].image_url=data:image/png;base64,...`，prompt 中不包含 `生成数量`、`审核强度`、`响应格式`。

- 开始 `DEV-API-006`：排查页面报错 `Failed to execute 'json' on 'Response': Unexpected end of JSON input`，重点检查前端直接调用 `response.json()`、本地 BFF 空响应、代理中断和 `ai.heigh.vip` 真实上游响应格式。
- 完成 `DEV-API-006`：新增统一响应解析服务 `readApiResponse`，前端 API 调用改为先读取 `response.text()` 再解析 JSON；空响应返回结构化 `EMPTY_API_RESPONSE`，非 JSON 返回结构化 `INVALID_API_JSON`，读取失败返回 `API_RESPONSE_READ_FAILED`；`/api/generations`、识图、推理和 bootstrap 配置读取均不再直接调用 `response.json()`；bootstrap 空响应和非 JSON 响应会安全回退到本地配置。
- 验证 `DEV-API-006`：真实直连 `https://ai.heigh.vip/v1/images/generations`，模型 `gpt-image-2`，提示词“小金毛在海边晒太阳”，返回 `200 OK`、`application/json`、`dataCount=1`、`b64_json` 图片；本地 BFF `POST /api/generations` 返回 `202`、`generationStatus=success`、`adapter=openai-image`、`endpoint=https://ai.heigh.vip/v1/images/generations`、`timeoutMs=1800000`、`resultImageCount=1`、实际图片尺寸 `1536 x 1024`；浏览器刷新 `http://127.0.0.1:5173/` 后控制台错误数为 0，未出现 `Unexpected end of JSON input`；真实 API Key 仅用于本地验证，未写入代码、测试或文档。
- 验证命令 `DEV-API-006`：`rg "response\\.json\\(|请求草稿|等待推理预览|mock|Mock|MOCK" src server -S` 无命中；`npm run typecheck` 通过；`npm run test -- --pool=threads --maxWorkers=1` 通过，20 个测试文件 100 个用例通过；`npm run build` 通过。
- 完成 `DEV-API-007`：修复“模型管理中填写的请求模型名”在页面诊断里不够明确的问题；生成链路现在把 `modelOverride.apiModelName` 同步到 cURL 预览、后端 adapter 摘要、右侧结果队列和图片详情弹窗，确保用户能直接看到真实提交给上游的 `model` 值；新增单测覆盖 cURL 与 adapter summary 使用覆盖后的请求模型名。验证：`npm run typecheck`、`npm run test -- --pool=threads --maxWorkers=1`、`npm run build` 均通过。

- 复核 `DEV-UX-009`：定位模型对比页拖动生成图片导致卡死的原因为浏览器对大体积图片/data URL 触发原生拖放和拖拽预览构建，容易造成主线程长时间占用；当前已在对比结果图上通过 `draggable={false}`、`onDragStart.preventDefault()`、`.compare-preview img { pointer-events: none; user-select: none; -webkit-user-drag: none; }` 禁用原生图片拖拽。
- 复核 `DEV-UX-009`：确认 `handleCreateCompare` 会在开始对比前合并主生成队列 `runningGenerationModelCountsRef` 与模型对比页 `runningCompareModelIdsRef`，对已在生成中的模型直接跳过；左右选择同一模型或连续点击开始对比时，只会启动尚未运行的模型槽位，并将跳过项写入非阻塞 warning。
- 验证 `DEV-UX-009`：`npm run typecheck` 通过；`npm run test -- --pool=threads --maxWorkers=1` 通过，21 个测试文件 105 个用例通过；`npm run build` 通过；`http://127.0.0.1:5173/` 返回 200，`http://127.0.0.1:8787/api/health` 返回 `status=ok`。本轮内置浏览器 WebView 连接超时，未完成实时拖拽复测。
- 完成 `VERIFY-M5-005`：修正 `GPT Studio` 路由配置中 `#image-compress` 的顺序，使 `src/config/gpt-studio-routes.ts` 与参考项目 README 和新增路由矩阵单测保持一致；该修正不改变模型对比运行逻辑，仅用于恢复全量测试通过。
- 完成 `DEV-UX-009` 回归加固：新增 `src/services/compare-service.ts`，将模型对比开始前的运行中模型过滤抽为 `planCompareGenerationSlots`；`src/App.tsx` 改为调用该服务，继续同时跳过主生成队列和模型对比页中已运行的模型，并避免左右槽位选择同一模型时重复请求。新增 `src/tests/unit/compare-service.test.ts` 覆盖主队列运行中、对比页运行中和左右同模型三类跳过场景；新增 `src/tests/unit/compare-preview-style.test.ts` 锁定 `.compare-preview img` 的原生拖拽保护规则。验证：`npm run typecheck` 通过；`npm run test -- --pool=threads --maxWorkers=1` 通过，23 个测试文件 109 个用例通过；`npm run build` 通过。本轮内置浏览器 WebView 两次连接仍在附着阶段超时，未完成实时拖拽复测。
