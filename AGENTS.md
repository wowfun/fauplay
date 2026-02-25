# AGENTS.md - AI 开发者指南

## 项目概述

Fauplay 是一个纯 Web 端的本地文件浏览器，运行在浏览器中，无需后端服务。使用 File System Access API 让用户选择本地文件夹进行浏览。

## 技术栈

- React 18 + TypeScript
- Vite (构建工具)
- Tailwind CSS (样式)
- shadcn/ui (UI 组件库)

## 关键约束

### 纯 Web 限制

1. **无后端服务** - 所有文件操作通过浏览器 File System Access API
2. **浏览器限制** - 仅支持 Chrome/Edge 94+、Firefox 111+
3. **无缩略图缓存** - 每次打开需重新生成缩略图
4. **单次授权** - 刷新页面后需重新授权文件夹

### 性能考虑

- 避免一次性加载大量文件元数据
- 图片懒加载
- 虚拟列表处理大目录

## 开发规范

### 代码风格

- 使用 TypeScript strict 模式
- 组件使用函数式组件 + Hooks
- CSS 使用 Tailwind CSS
- 避免使用 CSS-in-JS

### 组件设计

- 组件放在 `src/components/` 目录
- 使用 `src/lib/utils.ts` 中的 `cn()` 工具合并 className
- 遵循 shadcn/ui 的组件结构

### Git 提交

- 使用Conventional Commits格式
- 类型: `feat`, `fix`, `refactor`, `docs`, `style`, `test`, `chore`

## 常用命令

```bash
npm install          # 安装依赖
npm run dev          # 启动开发服务器
npm run build        # 构建生产版本
npm run lint         # 代码检查
npm run typecheck   # TypeScript 类型检查
```

## 关键文件

- `src/App.tsx` - 应用入口
- `src/main.tsx` - React 挂载点
- `src/index.css` - 全局样式
- `src/lib/fileSystem.ts` - 文件系统操作封装

## 实现优先级

1. 文件夹选择与授权
2. 文件列表展示（网格视图）
3. 图片/视频预览
4. 搜索与筛选
5. 幻灯片播放
6. 暗色主题
7. 键盘快捷键
