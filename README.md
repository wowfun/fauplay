# Fauplay - 本地文件浏览器

一个运行在浏览器中的本地图片/视频浏览工具。

## 功能特性

- 📁 文件夹浏览 - 选择本地文件夹进行浏览
- 🖼️ 图片预览 - 支持常见图片格式（jpg, png, gif, webp, bmp, svg）
- 🎬 视频播放 - 支持常见视频格式（mp4, webm, mov, avi）
- 🔍 搜索筛选 - 按文件名搜索、按类型筛选
- 🎞️ 幻灯片播放 - 自动播放图片，支持键盘控制
- 🌙 暗色主题 - 护眼设计
- ⌨️ 快捷键支持 - 流畅的键盘操作

## 技术栈

- React 18 + TypeScript
- Vite
- Tailwind CSS
- shadcn/ui

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

## 浏览器兼容性

- Chrome 94+
- Edge 94+
- Firefox 111+
- Opera 80+

> 注意：iOS Safari 暂不支持 File System Access API

## 项目结构

```
src/
├── components/     # UI 组件
├── hooks/          # 自定义 Hooks
├── lib/            # 工具函数
└── types/          # TypeScript 类型定义
```
