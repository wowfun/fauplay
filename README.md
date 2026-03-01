# Fauplay - 本地文件浏览器

一个运行在浏览器中的本地图片/视频浏览工具。

## 功能特性

- 文件夹授权与浏览（基于 File System Access API）
- 网格视图 + 虚拟列表（`react-window`）
- 图片/视频缩略图生成（无持久化缓存，刷新后重新生成）
- 搜索、类型筛选、排序（名称/日期/大小）
- 默认隐藏空文件夹（可在工具栏切换）
- 工具栏筛选按钮展示项目计数（封顶 `99+`）
- 底部状态栏显示可见数量与当前选中项的大小/修改时间
- 文件夹图标显示直接子项数量（懒加载，`99+` 上限展示）
- 目录导航（进入子目录、返回上级）
- 右侧预览窗格（单击文件，左侧纵向图标按钮）
- 预览媒体按比例完整显示（`object-contain`），最大高度限制为 `85vh`，避免超出可见范围
- 全屏预览弹窗（双击文件），与右侧预览复用同一套媒体 UI/交互逻辑
- 预览切换采用统一快捷键（`[` / `]`）与自动播放逻辑，不提供鼠标导航热区
- 预览遍历模式（顺序/随机）统一作用于手动上/下一个与自动播放切换逻辑
- 预览自动播放（侧边与全屏一致）：图片按间隔切换、视频播放结束后切换、末尾循环
- 键盘导航与预览快捷键（方向键、W/A/S/D、PageUp/PageDown、Enter、Esc、P、R、[、]）
- 快捷键配置集中管理（`src/config/shortcuts.ts`）
- 可选本地集成：通过本地能力网关在 Windows 文件资源管理器中定位/打开文件（兼容旧 helper 路由）

## 技术栈

- React 18 + TypeScript
- Vite
- Tailwind CSS
- react-window
- lucide-react
- clsx + tailwind-merge（`cn`）

## 快速开始

### 安装依赖

```bash
npm install
```

### 开发模式

```bash
npm run dev
```

### 启动本地能力网关（可选）

```bash
npm run gateway
```

### 启动资源管理器定位 helper（兼容命令）

```bash
npm run reveal-helper
```

### 启动旧版 helper（仅排障时使用）

```bash
npm run reveal-helper:legacy
```

### 构建生产版本

```bash
npm run build
```

## 使用说明

1. 点击页面上的"选择文件夹"按钮
2. 在浏览器弹出的授权窗口中选择要浏览的文件夹
3. 开始浏览图片和视频
4. 快捷键列表见 [`docs/shortcuts.md`](docs/shortcuts.md)
5. 常见问题排查见 [`docs/troubleshooting.md`](docs/troubleshooting.md)
6. 若需“在文件资源管理器中显示”：
   - 在 WSL 中启动 `npm run gateway`（或兼容命令 `npm run reveal-helper`）
   - 在预览面板点击“在文件资源管理器中显示”
   - 首次使用时输入当前已选目录的系统绝对路径（按目录名称保存到浏览器本地存储）

## 网关自测

```bash
curl -s http://127.0.0.1:3210/v1/health
curl -s http://127.0.0.1:3210/v1/capabilities
```

## 浏览器兼容性

- Chrome / Edge / Opera（推荐，支持 `showDirectoryPicker`）
- Firefox / Safari：兼容性受限，部分能力不可用

> 注意：本项目依赖 File System Access API，移动端浏览器支持普遍较弱。

## 当前未实现

- 更多快捷键动作扩展（当前已支持配置驱动的核心导航与预览快捷键）
- 主题切换 UI（仅提供样式变量基础）

## 架构文档

- 架构总览：[`specs/000-architecture/spec.md`](specs/000-architecture/spec.md)
- 接口契约：[`specs/000-architecture/interfaces.md`](specs/000-architecture/interfaces.md)
- 演进路线：[`specs/000-architecture/roadmap.md`](specs/000-architecture/roadmap.md)
- 架构待办：[`specs/000-architecture/todo.md`](specs/000-architecture/todo.md)

## UI/UX 规范文档

- 治理总规范：[`specs/002-ui-ux-governance/spec.md`](specs/002-ui-ux-governance/spec.md)
- 命名与分层：[`specs/002-ui-ux-governance/naming.md`](specs/002-ui-ux-governance/naming.md)
- 迁移映射：[`specs/002-ui-ux-governance/mapping.md`](specs/002-ui-ux-governance/mapping.md)
- 评审清单：[`specs/002-ui-ux-governance/checklist.md`](specs/002-ui-ux-governance/checklist.md)
- 功能分区：[`specs/002-ui-ux-governance/areas.md`](specs/002-ui-ux-governance/areas.md)

## 项目结构

```
src/
├── config/         # 配置（含快捷键）
├── features/       # 业务分层组件（explorer/preview）
├── hooks/          # 自定义 Hooks
├── layouts/        # 页面布局骨架
├── lib/            # 工具函数
├── types/          # TypeScript 类型定义
└── ui/             # 通用基础组件
```
