# 125 Gateway Route Composition 网关路由装配重构规范

> Archived on 2026-03-31. Kept for historical reference.

## 1. 目的 (Purpose)

在不改变 Fauplay Gateway 对外 HTTP / MCP 契约的前提下，收敛 `scripts/gateway/server.mjs` 的路由装配与 `tools/call` 后处理组织方式，降低新增网关端点时的维护成本，并避免“允许访问的路由集合”与“实际执行的路由实现”分叉漂移。

## 2. 范围与非目标 (In Scope / Out of Scope)

范围内：

1. 将 Gateway JSON HTTP 路由的可达判断与实际处理统一到单一注册表或等价单一来源。
2. 抽离 `tools/call` 结果的网关后处理逻辑，减少主请求分支内联复杂度。
3. 保持现有 `/v1/*` 路径、方法约束、错误码与响应体结构不变。

范围外：

1. 新增、删除或重命名任何 HTTP / MCP 端点。
2. 修改 `specs/002-contracts/spec.md` 中既有 JSON-RPC 生命周期契约。
3. 调整任何业务处理函数（如 tags、recycle、faces、annotation）的行为语义。

## 3. 用户可见行为契约 (User-visible Contract)

1. `GET /v1/health`、`POST /v1/mcp` 与现有 `/v1/*` JSON HTTP 端点继续保持原有路径与方法约束。
2. JSON HTTP 端点对非法 JSON、非法对象请求体与业务异常继续返回现有错误结构。
3. `tools/call` 仍继续支持分类结果入库与批量重命名后的路径重绑后处理。
4. Gateway 启动日志、MCP 会话头与现有快捷键配置读取行为不变。

## 4. 路由装配契约 (Composition Contract)

1. `FR-GRC-01` JSON HTTP 路由的“支持判断”与“执行处理”必须共享同一份路由定义，不允许分别维护两套独立条件树。
2. `FR-GRC-02` 离线路由（offline endpoint）必须继续返回 `404` 与现有 `Endpoint offline: <pathname>` 错误文案。
3. `FR-GRC-03` `tools/call` 后处理必须拆出独立函数，以便主 MCP 请求分支只保留协议控制流。
4. `FR-GRC-04` 本次重构不得修改网关对外暴露的响应 schema、HTTP 状态码映射与日志来源输出。

## 5. 验收标准 (AC)

1. `AC-GRC-01` 现有 `POST /v1/*` JSON HTTP 路由继续可用，未注册路径仍返回 `404 Not found`。
2. `AC-GRC-02` `POST /v1/mcp` 的 `initialize -> notifications/initialized -> tools/list/tools/call` 生命周期保持不变。
3. `AC-GRC-03` `fs.batchRename` 成功提交后，若返回可重绑映射，仍会触发 `batchRebindPaths` 后处理。
4. `AC-GRC-04` `npm run typecheck` 通过。
5. `AC-GRC-05` `npm run lint` 通过。

## 6. 默认值与一致性约束 (Defaults & Consistency)

1. 本专题属于纯结构性重构，不新增配置文件、环境变量或工具注册来源。
2. `scripts/gateway/server.mjs` 仍可继续作为 Gateway 启动入口模块，不要求本次拆分成多文件。
3. 本专题不涉及快捷键变更，因此 [`src/config/shortcuts.ts`](../../../../src/config/shortcuts.ts) 与 [`docs/shortcuts.md`](../../../../docs/shortcuts.md) 不变。

## 7. 关联主题 (Related Specs)

- MCP 契约：[`../../../002-contracts/spec.md`](../../../002-contracts/spec.md)
- 本地数据契约：[`../../../005-local-data-contracts/spec.md`](../../../005-local-data-contracts/spec.md)
- 开发冷启动性能（已归档）：[`../108-dev-cold-start-performance/spec.md`](../108-dev-cold-start-performance/spec.md)
