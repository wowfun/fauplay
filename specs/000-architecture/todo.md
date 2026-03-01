---
updated: 2026-03-01
---

# 000 架构待办与未决事项

## 1. 进行中（In Progress）

- [x] 定义网关进程目录结构与启动脚本规范。
- [ ] 提取前后端共享类型到 contracts 包。

## 2. 待办（Todo）

- [ ] 设计动作分发器（Action Dispatcher）前端接入点，替换组件内硬编码 helper 调用。
- [ ] 设计插件注册器（Plugin Registry）与 actionId 冲突检测。
- [ ] 定义网关错误码（Error Code）最小集合与文案映射策略。
- [ ] 设计 `workspaceId -> rootPath` 安全映射存储结构。
- [ ] 落地批量重命名的 `plan/commit` 插件与网关接口实现。
- [ ] 增加网关端口配置（Env）并在前端统一读取，避免端口冲突。
- [ ] 补充批量移动、批量删除的预演规则与冲突分类。
- [ ] 设计插件配置（Plugin Config）读写边界与回退策略。

## 3. 未决事项（Open Questions）

- [ ] 插件隔离是否需要在 M4 后引入独立进程（Process Isolation）？
- [ ] 网关配置持久化默认路径是否放在项目目录内，还是用户级目录？
- [ ] 后续是否需要引入插件签名（Plugin Signing）而不只白名单？

## 4. 迁移清单（Migration Checklist）

- [x] 复刻 `reveal-helper` 的 `/reveal` 行为为 `system.reveal` 动作。
- [x] 复刻 `reveal-helper` 的 `/open` 行为为 `system.openDefault` 动作。
- [x] 前端 `PreviewContent` 改用网关动作调用。
- [x] 保留并验证无网关时的降级路径。

## 5. 完成定义（Definition of Done）

- [x] `interfaces.md` 中定义的 v1 接口均有实现对照。
- [ ] 关键路径具备最小自动化测试。
- [x] README 对新架构入口与运行方式有明确说明。
