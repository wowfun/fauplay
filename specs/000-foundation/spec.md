# 000 Foundation 基线规范

## 目的

定义 Fauplay 的基础约束与默认前提，作为所有后续主题（`001+`）的上游基线。

## 关键术语 (Terminology)

- 本地优先（Local-First）
- 纯 Web（Pure Web）
- 可选网关（Optional Gateway）
- 核心浏览链路（Core Browsing Flow）
- 系统集成能力（System Integration Capability）
- 文件变更类能力（File Mutation Capability）
- 降级模式（Degraded Mode）

## 范围

范围内：

- 产品形态与运行边界（Pure Web + Optional Gateway）。
- 技术栈基线与工程默认约束。
- 浏览器兼容与授权模型约束。
- 持久化与性能相关的基础原则。

范围外：

- 具体功能方案（由 `100+` 功能专题定义）。
- 网关接口细节（由 `001-architecture`、`002-contracts` 定义）。
- 组件命名与交互规范细节（由 `003-ui-ux` 定义）。

## 基础定位

1. Fauplay 是本地优先（Local-First）的浏览器应用。
2. 产品定位为“本地文件浏览器”，媒体预览（图片/视频）属于文件预览能力子集。
3. 核心浏览链路（Core Browsing Flow）默认不依赖后端服务。
4. 本地能力网关（Local Capability Gateway）是可选增强能力，不是核心流程前置条件。

## 技术栈基线

- `React 18`
- `TypeScript`（严格类型检查）
- `Vite`
- `Tailwind CSS`
- `react-window`（虚拟列表）
- `lucide-react`
- `clsx + tailwind-merge`（`cn` 工具）

规则：

1. 新增能力应优先复用当前栈，不引入等价替代框架。
2. 若需引入新基础依赖，必须先在对应主题 `plan.md` 的 Delta 中说明必要性与替代方案比较。

## 平台与兼容性约束

1. 目录访问依赖 File System Access API（`window.showDirectoryPicker`）。
2. 推荐浏览器为 Chromium 内核（Chrome/Edge/Opera）。
3. Firefox/Safari 兼容性受限，允许部分能力降级或不可用。
4. 页面刷新后系统应优先尝试恢复已缓存目录句柄；缓存缺失或句柄失效时降级为重新目录授权。

## 数据与持久化约束

1. 默认不引入后端数据库作为核心能力依赖。
2. 缩略图不做跨刷新持久化缓存（不使用 IndexedDB/SQLite 作为默认方案）。
3. 运行时缓存可使用内存结构（如 `Map`），并接受刷新后失效。
4. 目录句柄缓存允许使用 IndexedDB 持久化；该能力属于可选增强，失效时必须可降级到手动重选目录。

## 性能基线原则

1. 避免一次性全量加载大目录元数据。
2. 优先使用虚拟渲染处理大列表。
3. 缩略图加载以可见区域优先，非可见区域不抢占前台交互资源。
4. 重型任务应可并发受控，避免阻塞主交互线程。

## 安全与降级基线

1. 网关能力默认可关闭，关闭后核心浏览与预览能力必须可用。
2. 文件变更类能力（File Mutation Capability）应具备显式确认与错误可见反馈；系统集成能力（System Integration Capability）默认不强制确认。
3. 任何可选增强能力不可破坏“无网关可用”的基本路径。

## 文档源头契约 (Documentation Source-of-Truth Contract)

1. `README.md` 仅承载项目定位、快速开始、常用命令与文档索引，不承载细粒度行为规范。
2. 具体行为规范只在 `specs/<topic>/spec.md` 维护；`README.md` 仅保留摘要与链接入口。
3. 禁止在 `README.md` 复制粘贴 `specs` 细则，避免双源维护与内容漂移。
4. 规格变更流程固定为：先更新对应 `specs/<topic>/spec.md`，再按需更新 `README.md` 导航链接。

## 非目标

1. 不定义具体 API 字段、错误码枚举、JSON schema。
2. 不定义具体组件命名、布局分区和视觉规范细则。
3. 不定义单个功能的实现步骤与任务拆解。

## 主题依赖关系

1. `000-foundation` 是上游基线主题。
2. `001-architecture`、`002-contracts`、`003-ui-ux` 必须与本规范保持一致。
3. 功能专题（`100+`）若与本规范冲突，应先更新本规范再推进实现。
