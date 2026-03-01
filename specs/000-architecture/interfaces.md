---
updated: 2026-03-01
---

# 000 架构接口契约

## 1. 文档目标

本文定义 Web App 与本地能力网关（Local Capability Gateway）的 HTTP 契约，以及网关与后端插件（Backend Plugin）的运行契约。  
本文件是首版实现边界，不描述具体业务 UI。

## 2. 网关 API（Gateway API）v1

### 2.1 健康检查（Health Check）

- `GET /v1/health`
- 用途：前端判断网关是否可用。
- 成功响应示例：

```json
{
  "ok": true,
  "data": {
    "service": "fauplay-local-gateway",
    "version": "0.1.0"
  }
}
```

### 2.2 能力发现（Capability Discovery）

- `GET /v1/capabilities`
- 用途：前端动态获取动作清单（Action List）与插件信息。
- 成功响应示例：

```json
{
  "ok": true,
  "data": {
    "actions": [
      {
        "actionId": "system.reveal",
        "title": "在文件资源管理器中显示",
        "mutation": false,
        "scopes": ["file"]
      },
      {
        "actionId": "system.openDefault",
        "title": "用系统默认应用打开",
        "mutation": false,
        "scopes": ["file"]
      }
    ],
    "plugins": [
      {
        "id": "builtin.reveal",
        "name": "Builtin Reveal Plugin",
        "version": "0.1.0"
      }
    ]
  }
}
```

### 2.3 非变更动作执行（Execute Action）

- `POST /v1/actions/execute`
- 用途：执行不修改文件状态的动作，如 reveal/open。
- 请求体示例：

```json
{
  "actionId": "system.reveal",
  "context": {
    "workspaceId": "ws-main",
    "currentPath": "albums",
    "selectedPaths": ["albums/a.jpg"]
  },
  "payload": {}
}
```

### 2.4 变更预演（Mutation Plan）

- `POST /v1/mutations/plan`
- 用途：生成变更计划（dry-run），返回冲突与预览结果。

### 2.5 变更提交（Mutation Commit）

- `POST /v1/mutations/commit`
- 用途：确认执行已生成计划（confirm）。

## 3. 统一响应结构（Response Envelope）

成功：

```json
{
  "ok": true,
  "data": {}
}
```

失败：

```json
{
  "ok": false,
  "error": {
    "code": "PLUGIN_NOT_FOUND",
    "message": "plugin not found"
  }
}
```

## 4. 插件运行契约（Plugin Runtime Contract）

### 4.1 插件清单（Plugin Manifest）

```ts
type PluginManifest = {
  id: string
  name: string
  version: string
  actions: Array<{
    actionId: string
    title: string
    mutation: boolean
    scopes: Array<'file' | 'directory' | 'multi'>
  }>
}
```

### 4.2 插件生命周期（Plugin Lifecycle）

- `activate(ctx)`：插件初始化。
- `execute(req)`：执行非变更动作。
- `plan(req)`：可选，生成变更计划。
- `commit(planId)`：可选，提交执行计划。
- `deactivate()`：可选，插件下线时释放资源。

## 5. 安全校验约束

1. 所有输入路径必须是相对路径（Relative Path），禁止绝对路径直传 UI。
2. 网关内进行路径归一化（Path Normalization），阻断越界访问。
3. 所有 mutation 操作必须经过 `plan -> commit`。
4. 插件必须通过白名单加载，且 actionId 全局唯一。

## 6. 首版必须支持的接口

1. `/v1/health`
2. `/v1/capabilities`
3. `/v1/actions/execute`
4. `/v1/mutations/plan`
5. `/v1/mutations/commit`

## 7. 当前实现状态（2026-03-01）

1. 已实现：
   - `GET /v1/health`
   - `GET /v1/capabilities`
   - `POST /v1/actions/execute`
2. 已预留（当前返回 `501 NOT_IMPLEMENTED`）：
   - `POST /v1/mutations/plan`
   - `POST /v1/mutations/commit`
3. 已移除旧版兼容路由（Legacy Routes），网关仅保留 `/v1/*` 契约接口。
