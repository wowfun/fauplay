# Fauplay - 本地文件浏览器

一个运行在浏览器中的本地图片/视频浏览工具。

## 功能特性

- 文件夹授权与浏览（基于 File System Access API）
- 网格视图 + 虚拟列表（`react-window`）
- 图片/视频缩略图生成（无持久化缓存，刷新后重新生成）
- 搜索、类型筛选、排序（名称/日期/大小）
- 默认隐藏空文件夹（可在工具栏切换）
- 文件夹图标显示直接子项数量（懒加载，`99+` 上限展示）
- 目录导航（进入子目录、返回上级）
- 右侧预览面板（单击文件）
- 全屏预览弹窗（双击文件）
- 键盘导航（方向键、PageUp/PageDown、Enter、Esc）

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

### 构建生产版本

```bash
npm run build
```

## 使用说明

1. 点击页面上的"选择文件夹"按钮
2. 在浏览器弹出的授权窗口中选择要浏览的文件夹
3. 开始浏览图片和视频
4. 快捷键列表见 [`docs/shortcuts.md`](docs/shortcuts.md)

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
