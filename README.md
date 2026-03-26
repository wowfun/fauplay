# Fauplay - 本地文件浏览器

Fauplay 是一个本地优先（Local-First）的浏览器本地文件浏览工具，核心浏览链路纯 Web 可用；本地能力网关（Gateway）用于可选的系统集成增强能力。

## 项目定位

项目聚焦“本地目录浏览 + 预览体验”：默认不依赖后端服务，优先保障目录授权、筛选排序、预览浏览与快捷键操作；系统级动作（例如在资源管理器中显示）通过可选网关增强，不作为核心流程前置条件。

## 快速开始

### 安装依赖

```bash
npm install
```

### 启动开发环境

```bash
npm run dev
```

### 构建生产版本

```bash
npm run build
```

## 常用脚本

- `npm run dev`：启动前端开发服务（Vite）
- `npm run gateway`：启动本地能力网关（可选）
- `npm run build`：执行 TypeScript 构建检查并打包
- `npm run typecheck`：执行 TypeScript 无输出类型检查
- `npm run lint`：执行 ESLint 校验

## 核心能力（概览）

- 文件夹授权与目录浏览（File System Access API）
- 网格浏览与虚拟列表渲染（`react-window`）
- 全文件类型浏览（图片/视频/文本/压缩包等）
- 图片/视频缩略图加载（运行时缓存，刷新后重建）
- 按能力预览（媒体内嵌预览、文本预览、不可预览文件信息面板）
- 搜索、类型筛选、排序（名称/日期/大小）
- 侧栏预览与全屏预览（共享同一预览语义）
- 预览遍历与自动播放（顺序/随机，快捷键驱动）
- 可选网关集成：在 Windows 文件资源管理器定位/打开文件

## 使用流程

1. 点击“选择文件夹”，在浏览器授权窗口中选择要浏览的目录。
2. 在主内容区浏览目录与文件，按需使用搜索、筛选和排序。
3. 单击文件打开侧栏预览，双击文件进入全屏预览。
4. 使用快捷键提升浏览效率，快捷键清单见 [`docs/shortcuts.md`](docs/shortcuts.md)。
5. 若需“在文件资源管理器中显示”，先启动 `npm run gateway`，再在预览面板触发对应动作。
6. 网关自测与常见故障排查见 [`docs/troubleshooting.md`](docs/troubleshooting.md)。

## 浏览器兼容性

- Chrome / Edge / Opera（推荐，支持 `showDirectoryPicker`）
- Firefox / Safari：兼容性受限，部分能力不可用

> 注意：本项目依赖 File System Access API，移动端浏览器支持普遍较弱。

## 文档索引

- 快捷键文档：[`docs/shortcuts.md`](docs/shortcuts.md)
- 排障与网关自测：[`docs/troubleshooting.md`](docs/troubleshooting.md)
- 规范总索引：[`specs/README.md`](specs/README.md)
- 基线规范：[`specs/000-foundation/spec.md`](specs/000-foundation/spec.md)
- 架构规范：[`specs/001-architecture/spec.md`](specs/001-architecture/spec.md)
- 契约规范：[`specs/002-contracts/spec.md`](specs/002-contracts/spec.md)
- UI/UX 规范：[`specs/003-ui-ux/spec.md`](specs/003-ui-ux/spec.md)
- 预览播放专题：[`specs/100-preview-playback/spec.md`](specs/100-preview-playback/spec.md)
- 缩略图管线专题：[`specs/101-thumbnail-pipeline/spec.md`](specs/101-thumbnail-pipeline/spec.md)
- 地址栏导航专题：[`specs/102-address-bar-navigation/spec.md`](specs/102-address-bar-navigation/spec.md)
- 本地文件浏览器专题（含底部结果面板）：[`specs/111-local-file-browser/spec.md`](specs/111-local-file-browser/spec.md)
- 规范变更日志：[`specs/CHANGELOG.md`](specs/CHANGELOG.md)

## 项目结构

```text
src/
├── config/         # 配置（含快捷键）
├── features/       # 业务分层组件（explorer/preview）
├── hooks/          # 自定义 Hooks
├── layouts/        # 页面布局骨架
├── lib/            # 工具函数
├── types/          # TypeScript 类型定义
└── ui/             # 通用基础组件
```
