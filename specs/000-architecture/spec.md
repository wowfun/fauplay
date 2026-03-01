---
updated: 2026-03-01
---

# 000 架构总览规范

## 1. 文档目的

本文定义 Fauplay 下一阶段的目标架构，作为后续功能扩展的长期基线。  
架构采用三层：Web 应用（Web App）、本地能力网关（Local Capability Gateway）、后端插件（Backend Plugins）。

## 2. 当前状态（As-Is）

- 应用核心为纯前端（Pure Web），基于 File System Access API 读取本地目录。
- 已提供本地能力网关（`scripts/gateway`）骨架，支持能力发现与动作执行。
- 系统级动作已通过内置插件（Builtin Plugin）承载：`system.reveal`、`system.openDefault`。
- 前端已接入能力发现（Capability Discovery），预览动作按钮可按能力动态显示并保留降级路径。

## 3. 目标状态（To-Be）

### 3.1 Web App 边界

- 保留目录授权、浏览、过滤、预览等前端核心体验。
- 引入网关客户端（Gateway Client）进行能力发现（Capability Discovery）与动作调用。
- 通过动作分发器（Action Dispatcher）触发后端能力，而不是在组件中硬编码具体 helper。
- 网关离线时自动降级，浏览/预览能力保持可用。

### 3.2 Local Capability Gateway 边界

- 作为本地服务运行，监听 `127.0.0.1`，不直接暴露公网。
- 统一承载系统集成、批处理编排、插件生命周期与动作路由。
- 对变更类操作执行预演（dry-run）与确认（confirm）流程。
- 统一输出错误码（Error Code）与结构化响应。

### 3.3 Backend Plugins 边界

- 插件实现具体能力，不直接耦合前端 UI。
- 首期采用官方内置 + 白名单（Allowlist）策略，不开放任意第三方插件加载。
- `reveal-helper` 能力迁移为内置插件动作（如 `system.reveal`、`system.openDefault`）。
- 新增文件管理插件承接批量重命名、移动、删除等任务。

## 4. 设计原则

1. 本地优先（Local-First）：核心浏览能力不依赖远程服务。
2. 可降级（Graceful Degradation）：网关不可用不阻断核心流程。
3. 扩展优先（Extension-Ready）：新增能力优先以插件方式接入。
4. 安全默认（Secure by Default）：路径校验、白名单、变更前预演为默认策略。
5. 契约先行（Contract-First）：接口与类型先定义，再实现。

## 5. 安全与风险控制

- 路径必须基于工作区根（Workspace Root）做归一化，禁止 `..` 越界访问。
- 所有变更类能力必须先 `plan` 再 `commit`，不提供直接危险执行入口。
- 插件加载仅允许白名单标识，默认关闭动态任意加载。
- 网关仅监听回环地址，避免局域网未授权访问。

## 6. 非目标（Non-Goals）

- 本阶段不引入云端账户体系与远程同步。
- 本阶段不引入复杂持久化数据库作为硬依赖。
- 本阶段不做插件市场（Plugin Marketplace）。

## 7. 关联文档

- 接口契约：`specs/000-architecture/interfaces.md`
- 演进路线：`specs/000-architecture/roadmap.md`
- 架构待办：`specs/000-architecture/todo.md`
- UI/UX 治理：`specs/002-ui-ux-governance/spec.md`
