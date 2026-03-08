# Specs Index

本目录用于维护 Fauplay 的规范文档，采用主题分组 + 以下结构：

- `spec.md`：稳定规范（长期有效）
- `plan.md`：阶段实施方案（可迭代）
- `tasks.md`：执行清单与状态跟踪
- `*.md`：额外补充文件（自由命名），必须在 `spec.md` 或 `plan.md` 里有链接入口

## 术语表达规则

- 重要概念为避免歧义，首次出现时使用“中文 + 英文”并列（例如：本地优先（Local-First））
- 若英文术语已是行业标准且更清晰，可直接使用英文（例如：`MCP Host`、`JSON-RPC`）
- 同一文档内概念命名应保持一致，不混用多个同义写法

## 增量规范 (Delta)

- 增量规范定义在各主题的 `plan.md` 中，建议使用固定章节名：`增量规范 (Delta)`
- `spec.md` 仅维护当前有效的稳定规范，不放执行态条目
- `tasks.md` 的执行项应关联对应 Delta 条目，确保“规范变更 -> 执行任务”可追踪
- 当 Delta 验收完成后，先合并回 `spec.md`
- 合并后在 `plan.md` 中将对应 Delta 标记为 `done` 或 `archived`
- 在 `tasks.md` 关闭对应执行项，并保留 Delta 关联关系
- 同步在 [`CHANGELOG.md`](./CHANGELOG.md) 记录主要变更

## CHANGELOG

- 全局变更日志文件固定为 [`CHANGELOG.md`](./CHANGELOG.md)
- `CHANGELOG.md` 为低频日志，仅记录主要变更，不记录 `plan.md`、`tasks.md` 的迭代细化
- 在日期块 `## YYYY-MM-DD` 下记录（倒序排序），块内按 Added/Changed/Fixed/... 分组
- 对已有小节追加内容，不重复创建同名小节

## 编号与归档规则

- 基础主题使用 `000-099`
- 功能专题使用 `100+`（例如 `100-*`）
- 功能专题建议使用“能力域 + 行为”命名（例如：`100-preview-playback`、`101-thumbnail-pipeline`）
- 历史规范归档在 [`_archive/`](./_archive/) 下，归档内容默认只读

## 当前专题入口（示例）

- 地址栏导航专题：[`102-address-bar-navigation/spec.md`](./102-address-bar-navigation/spec.md)
