# 114 Local Data Plugin 实施计划

## 1. 状态

1. 旧 114（metadata annotation）规范与计划已归档至：`specs/_archive/2026-03-20/114-metadata-annotation/`。
2. 当前主题以 [`spec.md`](./spec.md) 为唯一稳定契约，后续增量按本地数据管理能力推进。
3. `116-rename-driven-rebind` 已归档；其中仍有效的命名分层与改名后统一重绑入口约束已并入当前 `114` 稳定规范。

## 2. 当前收口目标

1. 工具名切换为 `local.data`。
2. HTTP 接口切换到 RESTful 契约（`/v1/file-annotations`、`/v1/files/relative-paths`、`/v1/files/missing/cleanups`）。
3. `file` 表收敛为路径索引，保留批量路径重绑与缺失路径清理能力。
4. 保持标注标签来源 `source=meta.annotation` 不变。

## 3. 后续增量方向

1. 为 `cleanupMissingFiles` 增加分批提交与可选目标过滤能力。
2. 为缺失路径清理补充更细粒度指标（耗时、范围、影响估算）。
3. 补齐自动化集成测试覆盖（重绑 + 清理 + 人脸一致性回归）。
