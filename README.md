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
- 全屏预览弹窗（双击文件）
- 键盘导航（方向键、W/A/S/D、PageUp/PageDown、Enter、Esc）
- 可选本地集成：在 Windows 文件资源管理器中定位当前文件（WSL helper）

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

### 启动资源管理器定位 helper（可选）

```bash
npm run reveal-helper
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
   - 在 WSL 中启动 `npm run reveal-helper`
   - 在预览面板点击“在文件资源管理器中显示”
   - 首次使用时输入当前已选目录的系统绝对路径（按目录名称保存到浏览器本地存储）

## 浏览器兼容性

- Chrome / Edge / Opera（推荐，支持 `showDirectoryPicker`）
- Firefox / Safari：兼容性受限，部分能力不可用

> 注意：本项目依赖 File System Access API，移动端浏览器支持普遍较弱。

## 当前未实现

- 幻灯片播放
- 完整键盘快捷键体系（当前已支持核心导航与预览快捷键）
- 主题切换 UI（仅提供样式变量基础）

## 项目结构

```
src/
├── components/     # UI 组件
├── hooks/          # 自定义 Hooks
├── lib/            # 工具函数
└── types/          # TypeScript 类型定义
```
