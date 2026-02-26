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

### 缩略图生成策略

**无缓存设计** - 不使用 IndexedDB/SQLite，每次打开重新生成。

**优化策略：**

1. **虚拟列表** - 只渲染可见区域的缩略图
   - 使用 react-window 或自定义实现
   - 只渲染当前视口内的文件项

2. **懒加载** - 滚动到时才加载
   - 使用 IntersectionObserver
   - 进入视口才开始生成缩略图

3. **渐进加载** - 先显示占位符，后台生成缩略图
   - 灰色占位符 → 生成中 → 显示缩略图
   - 用户无感知等待

4. **限制并发** - 同时只生成 N 个缩略图
   - 并发数建议 2-4 个
   - 使用队列控制，避免阻塞 UI

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
