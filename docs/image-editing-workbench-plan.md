# AI 修图工作台产品与技术规划

## 1. 产品定位

修图工作台将一次性图生图升级为可持续迭代、可控、可比较、可审核的专业编辑会话。用户围绕同一张图片连续提出修改要求，系统保存原始指令、AI 润色指令、选区、候选、版本关系和供应商上下文，不覆盖原图。

核心闭环：

1. 上传原图并创建修图会话。
2. 选择整图编辑、局部编辑或双版本合并。
3. 输入自然语言指令，AI 提取编辑目标、保护项、风险和冲突。
4. 清晰指令直接执行；模糊或冲突指令先追问。
5. 单轮并行生成 1-4 个候选，用户检出满意版本。
6. 在已检出版本上继续对话，或从历史版本创建分支。
7. 对候选进行比较、评论、审核、分享和发布。

产品原则：

- 非破坏性：原图和历史版本不可变，编辑结果始终创建新版本。
- 可控优先：明确选区、保护项和未编辑区域约束，减少整图漂移。
- 连续但可回退：优先使用供应商原生上下文，失效时回退到当前版本参考图。
- 成本透明：提交前显示候选成本，执行后记录耗时、成功率和使用量。
- 权限最小化：分享链接只开放其权限明确允许的动作。

## 2. 行业方案映射

| 行业实践 | 本项目对应设计 | 状态 |
| --- | --- | --- |
| Adobe Firefly / Photoshop Generative Fill：先选区，再添加、替换或移除内容，并保留生成变体 | 局部编辑使用独立蒙版层；支持多个区域、区域级指令、候选版本和非破坏性版本轨迹 | 已完成 |
| Canva Magic Edit：刷选目标区域并用自然语言描述修改 | 画笔、橡皮、矩形、套索、魔棒、近似主体选择与自然语言指令组合提交 | 已完成 |
| OpenAI Images Edit：输入源图和 mask 执行局部编辑 | 对支持原生 mask 的 OpenAI Images 端点发送 multipart `image` + `mask`；否则使用标注参考图 | 已完成 |
| OpenAI Responses：使用 `previous_response_id` 延续多轮图像生成/编辑 | 保存 response id、兼容键和有效期，下一轮兼容时复用 | 已完成 |
| Gemini：在多轮对话中继续生成和编辑图像 | 保存精简后的 Gemini `contents` 与 interaction metadata，下一轮拼接上下文 | 已完成 |
| 专业创作工具：版本比较、分支、审阅和发布 | 双图滑杆/闪烁对比、版本 DAG、标签、收藏、评论、审核和发布流程 | 已完成 |
| 专业修图质检：用差异视图检查局部编辑范围和边缘衔接 | 对直接父子版本计算像素差异、选区覆盖、选区外漂移、保护区一致性和边缘融合代理指标，并生成差异热力图 | 已完成（技术代理指标） |

官方参考：

- Adobe Firefly Generative Fill: https://helpx.adobe.com/firefly/web/edit-images/generative-fill/add-replace-or-remove-content-with-generative-fill.html
- Adobe Photoshop Generative Fill: https://helpx.adobe.com/photoshop/desktop/create-open-import-images/create-images/generative-fill.html
- Canva AI Photo Editor / Magic Edit: https://www.canva.com/features/ai-photo-editing/
- OpenAI Image Generation: https://platform.openai.com/docs/guides/image-generation
- OpenAI Images API Reference: https://platform.openai.com/docs/api-reference/images
- Gemini Image Generation: https://ai.google.dev/gemini-api/docs/image-generation

## 3. 已交付功能

### 3.1 会话与编辑模式

- 上传 PNG、JPEG、WebP 创建独立修图会话。
- 保存源图、当前版本、当前分支和最近会话。
- 支持会话改名、归档、恢复和删除。
- 支持三种编辑模式：
  - 整图编辑：调色、光线、风格、背景和整体画面调整。
  - 局部编辑：源图、一个或多个区域蒙版、全局指令和区域指令。
  - 版本合并：以一个版本为主，融合另一个版本的指定内容。
- 模型能力决定可用模式、区域数、候选数和参考图数量。

### 3.2 AI 指令润色与追问

每轮同时保存：

- `originalInstruction`：用户原始输入，用于追溯。
- `polishedInstruction`：结构化后的可执行指令，用于上游请求。
- `analysis`：编辑目标、保护元素、冲突、警告、置信度和执行决策。

执行规则：

1. 指令清晰且输入完整时直接排队。
2. 指令冲突、含糊或局部编辑缺少选区时进入追问。
3. 用户回答后重新分析，满足条件再执行。
4. AI 分析不可用时使用本地启发式规则，不阻断工作台。
5. 润色补充保持不变、边缘融合和输出约束，不改变创作意图。

推荐的上游指令结构：

```text
编辑目标：需要改变的对象、属性或环境。
指定区域：区域名称、标记和区域级要求。
保持不变：身份、产品结构、Logo、文字、数量、构图和未选中区域。
视觉要求：材质、光线、透视、色彩和边缘融合。
输出要求：仅返回编辑后的完整图片。
```

### 3.3 高级选区与蒙版

已支持：

- 画笔、橡皮、矩形、套索、魔棒和近似主体选择。
- 新增、减去、相交三种组合方式。
- 服务端按区域顺序组合全部规范蒙版，统一执行新增、减去、相交语义，再输出 OpenAI 所需的透明选区 mask；旧会话仍兼容首个已预合成蒙版。
- 反选、扩张、收缩和羽化。
- 多区域、区域颜色、区域名称、区域指令和优先级。
- 保护人物身份、文字、Logo、构图、产品结构和品牌色等快捷约束。
- 局部版本合并：按当前蒙版从另一个版本取回指定区域。

上游策略：

- `native-mask`：对支持的 OpenAI Images Edit 端点输出透明选区 mask，并使用 multipart 请求。
- `annotated-reference`：对没有原生 mask 的模型，将选区作为标注参考图发送。
- `reference`：不支持局部输入时，退化为当前版本参考图连续编辑。

质量边界：

- 当前“主体选择”是基于图像像素和连通区域的近似选择，不是专用分割模型。
- 魔棒依赖颜色相似度，对复杂纹理、透明物体、毛发和低对比边缘的精度有限。
- 原生 mask 的最终遵循程度仍取决于上游模型，必须通过回归样例评估区域外漂移。

### 3.4 连续多轮上下文

系统按以下顺序保持连续性：

1. 检查源版本是否存在供应商 continuation。
2. 校验供应商、模型、请求模型名、端点、端点类型和参数版本组成的兼容键。
3. 校验上下文是否过期。
4. OpenAI Responses 复用 `previous_response_id`。
5. Gemini 复用精简后的历史 `contents` 和 interaction metadata。
6. 不兼容、过期或缺失时，继续以当前版本图片作为参考图。

上下文不会跨模型、跨供应商或跨不兼容端点误用。运行时 API Key 和认证 Header 不写入 SQLite。

### 3.5 候选、版本与比较

- 单轮候选任务并行，候选上限为 4。
- 候选生成后保持 detached，不自动覆盖当前分支头。
- 用户检出候选后才更新当前版本。
- 任意历史版本可检出或创建新分支。
- 合并版本保存两个父版本，形成可追溯版本 DAG。
- 支持版本标签、收藏、名称、备注、审核状态和批量清理。
- 支持双图滑杆、闪烁对比和对比版本切换。
- 可导出脱敏后的会话清单、指令和版本关系。

### 3.6 技术质量检查

- 可对当前结果版本和其直接父版本运行本地技术质量检查。
- 整图编辑计算改变像素比例，并明确不把变化幅度当作审美质量。
- 局部编辑额外计算选区覆盖率、选区外漂移率、保护区一致性和边缘融合分数。
- 生成差异热力图，帮助人工定位模型修改范围和明显漂移。
- 源图与结果尺寸不一致时，先将结果重采样到基线尺寸，并提示该检查为近似值。
- OpenAI 原生透明选区 mask 在评估时转换为统一的“非零即选中”语义；其他已持久化区域蒙版不重复反转。
- 评估结果写入版本元数据，只允许以该版本的直接父版本作为基线，并记录 `version.quality_evaluated` 审计事件。

质量边界：

- 当前分数是基于像素变化、蒙版范围和边缘差异的技术代理指标。
- 它不能判断画面是否更美、创意是否优秀、指令语义是否正确，也不能替代人物身份、产品结构、Logo 或文字一致性审核。
- 没有局部蒙版时不输出选区外漂移和边缘融合结论。

### 3.7 成本、配额与运行治理

- 提交前按模型、质量、分辨率和候选数预估费用。
- 展示预计费用、最坏费用和失败可能计费风险。
- 工作空间支持：
  - 最大并发候选任务数。
  - 单会话并发轮次策略。
  - 每日候选额度。
  - 本地资产存储额度。
- 记录任务耗时、尝试、错误、使用量和候选检出情况。
- 生命周期策略支持清理过期、未收藏、无标签且未被引用的 detached 版本。
- provider 熔断器在短时间连续失败后暂停请求，冷却后半开探测。
- 服务重启时将未完成任务标记为 `interrupted`，不自动重放，避免重复计费。

### 3.8 协作、审核与运营

- 本地团队空间、成员角色、常用指令模板和品牌素材。
- 版本评论、评论解决状态和审计记录。
- 请求审核、批准、退回修改、发布和重新打开流程。
- 查看、评论、编辑三种分享权限。
- 分享深链：`?page=editing&share=<token>`。
- 分享会话快照和 SSE 事件不返回分享 token 与审计日志。
- 运营面板汇总任务成功率、重试率、候选检出率、费用估算和 provider 健康状态。

## 4. 工作台体验

保持现有安静、工作导向的三栏结构：

- 左栏：会话列表、上传、编辑模式、模型、参数和指令输入。
- 中栏：当前图片、蒙版、缩放、编辑工具、对比和版本轨迹。
- 右栏：对话、版本、协作和运营检查器。

关键交互：

- 工具使用图标按钮并提供 tooltip。
- 画笔大小、羽化和扩张使用稳定尺寸的数值控件。
- 运行中展示轮次与候选进度，可取消。
- 错误展示类型、状态、是否可重试和可能计费风险。
- 长模型名、指令、评论和错误信息允许换行，不改变工具栏尺寸。
- 桌面、平板和手机均不出现页面级横向滚动。

## 5. 分享权限矩阵

| 动作 | 查看 | 评论 | 编辑 | 本地所有者 |
| --- | --- | --- | --- | --- |
| 查看会话、版本和 SSE 更新 | 允许 | 允许 | 允许 | 允许 |
| 创建评论 | 禁止 | 允许 | 允许 | 允许 |
| 修改或解决评论 | 禁止 | 禁止 | 允许 | 允许 |
| 创建轮次、重试、取消、检出、分支、版本编辑 | 禁止 | 禁止 | 允许 | 允许 |
| 导出完整会话清单 | 禁止 | 禁止 | 禁止 | 允许 |
| 删除会话 | 禁止 | 禁止 | 禁止 | 允许 |
| 创建/撤销分享链接 | 禁止 | 禁止 | 禁止 | 允许 |
| 审核、发布和平台配置 | 禁止 | 禁止 | 禁止 | 允许 |
| 查看运营数据、成本和审计 | 禁止 | 禁止 | 禁止 | 允许 |

服务端通过 `X-Edit-Share-Token` 校验 REST 请求，通过 `shareToken` 查询参数校验 SSE。

## 6. 技术架构

### 6.1 前端

- `src/components/image-editing/ImageEditingWorkbench.tsx`
- `src/services/edit-session-api-service.ts`
- `src/services/edit-instruction-service.ts`
- `src/services/edit-mask-service.ts`
- `src/services/edit-quality-service.ts`
- `src/domain/image-editing.ts`

### 6.2 后端

- `server/edit/edit-router.ts`：REST、SSE、分享权限和错误归一化。
- `server/edit/edit-service.ts`：会话状态机、版本治理、协作、配额和生命周期。
- `server/edit/edit-store.ts`：SQLite schema v2、旧数据兼容和工作空间。
- `server/edit/edit-assets.ts`：源图、蒙版、结果和回滚清理。
- `server/edit/edit-analyzer.ts`：指令分析校验和启发式回退。
- `server/edit/edit-mask-compositor.ts`：规范多区域蒙版合成与 OpenAI 透明选区语义转换。
- `server/edit/edit-executor.ts`：参考图、原生 mask、continuation 和 provider 熔断。
- `server/edit/provider-circuit-breaker.ts`：供应商失败窗口和冷却状态。

### 6.3 数据与资产

- 默认目录：`.data/editing`
- SQLite：会话、轮次、消息、任务、尝试、版本、父版本、分支、continuation、工作空间和扩展数据。
- 文件资产：源图、蒙版、标注图和生成结果。
- schema v1 会话读取时补齐工作空间、版本元数据、区域参数、评论、审核和工作流默认值。
- API Key、认证 Header 和运行时凭证只保留在执行内存中。
- 取消、重复提交、数据库失败和晚到结果均执行资产回滚。

## 7. 主要 API

### 会话与实时状态

| 方法 | 路径 | 用途 |
| --- | --- | --- |
| `GET` | `/api/edit-sessions` | 会话列表 |
| `POST` | `/api/edit-sessions` | 创建会话 |
| `GET/PATCH/DELETE` | `/api/edit-sessions/:id` | 读取、更新或删除会话 |
| `GET` | `/api/edit-sessions/:id/events` | SSE 实时事件 |
| `GET` | `/api/edit-sessions/shared/:token` | 读取分享会话 |

### 编辑与版本

| 方法 | 路径 | 用途 |
| --- | --- | --- |
| `POST` | `/api/edit-sessions/:id/turns` | 创建编辑轮次 |
| `POST` | `/api/edit-sessions/:id/turns/:turnId/clarification` | 回答追问 |
| `POST` | `/api/edit-sessions/:id/turns/:turnId/cancel` | 取消轮次 |
| `POST` | `/api/edit-sessions/:id/jobs/:jobId/retry` | 重试候选 |
| `POST` | `/api/edit-sessions/:id/versions/:versionId/checkout` | 检出版本 |
| `PATCH` | `/api/edit-sessions/:id/versions/:versionId` | 更新版本元数据与技术质量评估 |
| `POST` | `/api/edit-sessions/:id/versions/cleanup` | 清理版本 |
| `POST` | `/api/edit-sessions/:id/versions/merge-region` | 创建局部合并版本 |
| `POST/PATCH` | `/api/edit-sessions/:id/branches` | 创建或更新分支 |

### 协作与平台

| 方法 | 路径 | 用途 |
| --- | --- | --- |
| `POST/PATCH` | `/api/edit-sessions/:id/comments` | 创建或更新评论 |
| `POST` | `/api/edit-sessions/:id/approvals` | 创建审核结论 |
| `POST/PATCH` | `/api/edit-sessions/:id/share-links` | 创建或撤销分享 |
| `POST` | `/api/edit-sessions/:id/workflow` | 更新发布流程 |
| `GET/PATCH` | `/api/edit-sessions/platform` | 平台指标和工作空间 |
| `POST` | `/api/edit-sessions/platform/cost-preview` | 费用预估 |
| `POST` | `/api/edit-sessions/platform/lifecycle/cleanup` | 生命周期清理 |

## 8. 状态与异常

编辑轮次：

```text
analyzing
  -> awaiting_clarification
  -> queued
  -> running
  -> persisting
  -> succeeded | partial_success | failed | canceled | interrupted
```

关键策略：

- 重复 `clientTurnId` 返回已有轮次，不重复创建任务。
- 单候选失败时保留其他成功候选，轮次进入 `partial_success`。
- 取消后晚到结果不入库，已落盘临时文件被删除。
- 上下文不兼容或过期时自动回退到参考图连续性。
- 分享 token 失效、撤销、过期或跨会话访问时拒绝请求。
- provider 熔断时返回可重试的 503 风格错误。

## 9. 当前安全边界

当前实现是单机工作台，不是公网多租户权限系统：

- 没有账号登录、会话身份、组织租户隔离和所有者认证。
- 分享 token 请求有服务端动作权限校验，但普通本地 API 仍可被同机客户端直接调用。
- 因此分享权限适合本地演示、受控内网和产品流程验证，不能宣称公网级安全。
- 对外部署前必须增加登录、服务端 session/JWT、资源所有权校验、租户隔离、CSRF/CORS 策略、请求限速、对象存储签名 URL 和密钥托管。
- 本地 SQLite 和资产目录不提供跨设备同步、高可用、灾备和并发写扩展。

## 10. 下一阶段规划

以下 P0-P3 均为路线图，未包含在当前本地 V1 交付中。

### P0：质量评测与稳定性

- 建立 30-50 组固定编辑样例，覆盖换背景、去物、文字保护、人物身份、产品结构、透明物体和复杂边缘。
- 在已交付的像素差异代理指标之外，对每个模型记录指令语义遵循、主体一致性、文字保持和人工边缘质量。
- 为不同编辑类型校准选区外漂移和边缘融合阈值，避免统一阈值误报。
- 增加 continuation 过期、模型切换、端点切换和降级路径的端到端测试。
- 对 SSE 重连、浏览器刷新、长任务取消和服务重启做压力验证。

### P1：精确选区与编辑质量

- 接入专用主体/对象分割模型，替换当前近似主体选择。
- 增加边缘优化、毛发细化、颜色去污染和 mask 预览质量检查。
- 在现有差异热力图上增加阈值调节、连通区域定位和可忽略区域标记。
- 增加身份、产品结构、Logo 和文字的自动一致性评分。
- 支持按区域选择不同提示词强度或不同模型。

### P2：真实团队与云端能力

- 增加账号、团队、角色和资源所有权认证。
- SQLite/本地文件迁移到事务数据库和对象存储。
- 分享链接增加密码、访问次数、IP/域名限制和下载权限。
- 后台任务队列、幂等键、Webhook 和跨实例事件总线。
- 实际账单对账、用户级预算、组织账单和成本归属。

### P3：生产与品牌流程

- 批量商品图修图和品牌规则自动检查。
- 审核清单、多人批注、版本指派和发布渠道集成。
- 组织级模板、品牌素材锁定和合规审计导出。
- 将高通过率编辑沉淀为可复用自动化工作流。

## 11. 验收与指标

功能验收：

- 连续执行至少 5 轮，每轮基于已检出版本。
- OpenAI Responses 与 Gemini 在兼容条件下复用原生上下文。
- 原生 mask 请求包含源图和 mask；不支持时使用标注参考图回退。
- 单轮 1-4 个候选，部分失败不丢失成功结果。
- 版本检出、分支、双父合并、标签、收藏、清理和导出关系正确。
- 技术质量检查只接受直接父版本作为基线，结果可持久化并生成审计记录。
- 局部编辑可显示选区覆盖、选区外漂移、保护区一致性、边缘融合和差异热力图。
- 质量面板明确说明像素指标不代表审美、创意或语义判断。
- 查看、评论、编辑分享权限严格符合矩阵。
- 刷新、取消、重启和上游失败后状态与资产一致。

体验验收：

- 1440x900、1366x720、768x1024、390x844 无横向溢出。
- 工具栏、画布、版本轨迹、对话和检查器不重叠。
- 鼠标和触屏均可完成选区、缩放和提交。
- 分享页清楚展示权限，隐藏无权限运营能力。

需求与证据矩阵：

| 需求 | 主要实现 | 自动化证据 | 状态 |
| --- | --- | --- | --- |
| 以图修图与三种编辑模式 | `ImageEditingWorkbench`、`edit-executor`、OpenAI/Gemini 适配器 | adapter、mask、service 测试 | 已交付 |
| AI 指令润色、冲突识别与追问 | `edit-instruction-service`、`edit-analyzer` | instruction、analyzer 测试 | 已交付 |
| 连续五轮与原生上下文复用 | continuation 兼容键、OpenAI `previous_response_id`、Gemini `contents` | 五轮检出、过期回退、模型/端点切换测试 | 已交付 |
| 1-4 个候选与部分成功 | scheduler、detached candidate、轮次状态机 | 候选数 1-4、部分失败保留成功候选测试 | 已交付 |
| 非破坏性版本、分支与合并 | 版本 DAG、分支头、双父合并 | checkout、branch、merge、cleanup 测试 | 已交付 |
| 局部选区与原生 mask | mask service、服务端多区域 compositor、multipart `image + mask`、标注参考图回退 | mask 工具、`add/subtract/intersect` 合成、全部规范区域进入原生 mask 与 OpenAI multipart 测试 | 已交付 |
| 技术质量检查 | `edit-quality-service`、版本 `qualityAssessment`、差异热力图 | 相同图、选区内修改、外部漂移、硬边缘、重采样、持久化校验测试 | 已交付 |
| 取消、幂等与资产一致性 | `clientTurnId`、任务取消、资产回滚、重启中断恢复 | 重复提交、取消后晚到结果、重启 `interrupted` 测试 | 已交付 |
| 分享权限 | REST/SSE token 校验与动作权限矩阵 | `view/comment/edit` 路由权限与脱敏测试 | 已交付（本地 V1） |
| 语义、身份、文字和品牌自动评分 | 固定评测集、视觉/文字识别评估器 | 尚未建立 | 路线图 P0/P1 |
| 账号、租户与公网部署安全 | 登录、所有权、租户隔离、云存储与任务队列 | 尚未建立 | 路线图 P2 |

最终回归证据（2026-07-14）：

- `npm test -- --pool=threads --maxWorkers=1`：39 个测试文件、191 个用例通过。
- `npm run typecheck`、`npm run build`、`git diff --check` 均通过；构建仅保留既有的大 chunk 提示。
- CDP 自动化在 1440x900、1366x720、768x1024、390x844 四个精确视口验证无页面级横向溢出、无三栏面板重叠、四个检查器 Tab 可见且控制台错误为 0。
- 自动化完成会话归档、归档列表读取、编辑锁定、恢复和审计记录验证。
- 自动化故意让首次 SSE 握手失败，确认界面进入重连态并恢复实时同步；刷新后会话、轮次、局部蒙版语义和 SSE 连接均恢复。
- 自动化发送真实 touch 输入绘制 20,456 个选中像素，将画布从 100% 缩放到 125%，提交局部指令并持久化为 `awaiting_clarification` 与 `selection-alpha`。
- 未配置 AI Key 时，指令分析回退到本地规则，不再弹出全局设置遮挡当前修图流程。
- QA 脚本结束后主动删除临时会话并再次读取确认，`GET /api/edit-sessions` 返回空列表；本轮未调用生产上游 API Key。

建议指标：

| 指标 | 说明 |
| --- | --- |
| 首轮可用率 | 首轮至少一个候选被检出的会话占比 |
| 平均检出轮次 | 得到满意版本前的编辑轮数 |
| 候选检出率 | 生成候选最终被检出的比例 |
| 区域外漂移率 | 当前可自动计算的像素代理指标；需用固定样例校准告警阈值 |
| 主体一致性通过率 | 当前依赖人工抽检；自动身份或产品结构评分属于 P1 |
| 澄清解决率 | 一次追问后转为可执行的比例 |
| 原生上下文命中率 | 使用 provider continuation 的轮次占比 |
| 上下文降级率 | 因过期或不兼容回退到参考图的比例 |
| 单次有效编辑成本 | 总费用除以最终被检出的版本数 |
| 中断恢复率 | `interrupted` 任务经用户重试后成功的比例 |
