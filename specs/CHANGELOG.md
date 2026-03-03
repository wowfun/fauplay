# CHANGELOG

## 2026-03-03

### Added

- 新增 `specs/000-foundation/spec.md` 首版基线规范（产品定位、技术栈、兼容性、持久化、性能与降级原则）。
- 新增 `specs/001-architecture/spec.md` 首版架构规范（三层边界、依赖方向、降级策略与演进规则）。
- 新增 `specs/002-contracts/spec.md` 首版契约规范（网关入口、JSON-RPC、响应封装、错误码与插件运行契约）。
- 新增 `specs/003-ui-ux/areas.md` 作为 UI 分区引用细则，补充分区职责、预览子分区映射、状态矩阵与扩展落位规则。
- 新增 `specs/100-preview-playback/spec.md` 首版预览播放规范（自动播放、顺序/随机遍历、快捷键与侧栏/全屏一致性契约）。

### Changed

- 建立新主题编号与命名体系：`000-foundation`、`001-architecture`、`002-contracts`、`003-ui-ux`。
- 统一活动主题骨架为 `spec.md`、`plan.md`、`tasks.md`。
- 调整 `000-foundation` 安全基线：系统集成能力不强制确认，显式确认仅要求文件变更类能力。
- 新增术语表达规则：重要概念使用“中英文并列”或标准英文表达，并同步修订 `000` 与 `001` 规范术语。
- 架构对齐修复：预览组件不再硬编码 `system.*` 工具名；系统动作调用路径统一收敛到 `actionDispatcher`。
- MCP 落地改造：网关 `/v1/mcp` 改为 JSON-RPC 标准响应，增加 `initialize/notifications/initialized` 生命周期，`tools/list` 移除顶层 `plugins` 返回。
- MCP 契约收敛：`tools/list` 不再返回非标准来源字段。
- 外部 MCP Server 注册入口迁移为 `.fauplay/mcp.json`，移除 env allowlist 路径与相关兼容残留。
- 内置 MCP Server 彻底 stdio 化：`reveal` 剥离为独立 CLI，并通过 `.fauplay/mcp.json` 以 `stdio` 方式注册，不再存在 inproc 路径。
- 落盘 `specs/003-ui-ux/spec.md` 首版交互规范，明确 Functional Zone、Panel-Fullscreen Relation、State、Keyboard、Capability & Degradation 等契约。
- 调整 `003-ui-ux` 可访问性条款，移除“所有可操作控件必须可键盘触达”要求。
- 修正文档一致性：`docs/shortcuts.md` 移除未实现的 `Shift + D`，与 `src/config/shortcuts.ts` 对齐。
- 收敛 `specs/100-preview-playback/spec.md` 表达方式：移除代码片段与实现路径引用，统一为行为契约与语义定义。
- 进一步收敛 `specs/100-preview-playback/spec.md` 术语写法：英文值集中到术语章节，正文统一使用中文名称。

### Archived

- 旧规范文件已整体归档到 `specs/_archive/2026-03-02/`。
