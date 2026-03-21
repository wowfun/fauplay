# 114 Local Data Plugin 实施计划

## 1. 状态

1. 旧 114（metadata annotation）规范与计划已归档至：`specs/_archive/2026-03-20/114-metadata-annotation/`。
2. 当前主题以 [`spec.md`](./spec.md) 为唯一稳定契约，后续增量按本地数据管理能力推进。

## 2. 当前收口目标

1. 工具名切换为 `local.data`。
2. HTTP 接口切换到 `/v1/local-data/*`。
3. 新增 `file` 表刷新重绑与失效 `fileId` 清理能力。
4. 保持标注标签来源 `source=meta.annotation` 不变。

## 3. 后续增量方向

1. 为 `refresh-file-bindings` 增加更细粒度指标（耗时、候选数量分布、失败分类）。
2. 为 `cleanup-invalid-fileids` 增加分批提交与可选目标过滤能力。
3. 补齐自动化集成测试覆盖（重绑 + 清理 + 人脸一致性回归）。
