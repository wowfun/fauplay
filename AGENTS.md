# AGENTS.md - AI 开发者指南

## 项目概述

Fauplay 是一个纯 Web 端的本地文件浏览器，运行在浏览器中，无需后端服务。使用 File System Access API 让用户选择本地文件夹进行浏览。

## 技术栈

- React 18 + TypeScript
- Vite (构建工具)
- Tailwind CSS (样式)
- react-window (虚拟列表)
- Lucide React (图标)
- `cn()` 工具（`clsx` + `tailwind-merge`）

## 关键约束

### 纯 Web 限制

1. **无后端服务** - 所有文件操作通过浏览器 File System Access API
2. **浏览器限制** - 依赖 `window.showDirectoryPicker`，当前以 Chromium 内核浏览器为主（Chrome/Edge/Opera）；Firefox/Safari 兼容性受限
3. **无持久化缩略图缓存** - 不使用 IndexedDB/SQLite；刷新页面后需重新生成
4. **单次授权** - 刷新页面后需重新授权文件夹
5. **系统资源管理器定位（可选）** - 需单独启动本地 helper（`npm run reveal-helper`），前端默认不依赖该能力

### 性能考虑

- 避免一次性加载大量文件元数据
- 图片懒加载
- 虚拟列表处理大目录
- 文件夹附加信息（如 item 数）按可见区域懒加载

### 缩略图生成策略

**无持久化缓存设计** - 不使用 IndexedDB/SQLite；当前仅使用运行时内存缓存（`Map`）。

**优化策略：**

1. **虚拟列表** - 只渲染可见区域的缩略图
   - 已使用 `react-window` 的 `FixedSizeGrid`
   - 只渲染当前视口内的文件项

2. **懒加载** - 进入可见区域时才触发缩略图生成
   - 当前依赖虚拟列表挂载时机实现“近似懒加载”
   - 尚未引入 `IntersectionObserver` 作为精细触发条件

3. **渐进加载** - 先显示占位符，后台生成缩略图
   - 灰色占位符 → 生成中 → 显示缩略图
   - 用户无感知等待

4. **限制并发** - 同时只生成 N 个缩略图
   - 并发数建议 2-4 个（待实现）
   - 建议使用队列控制，避免阻塞 UI

## 开发规范

### 代码风格

- 使用 TypeScript strict 模式
- 组件使用函数式组件 + Hooks
- CSS 使用 Tailwind CSS
- 避免使用 CSS-in-JS

### 组件设计

- 组件放在 `src/components/` 目录
- 使用 `src/lib/utils.ts` 中的 `cn()` 工具合并 className
- 保持函数式组件 + Hooks，按功能拆分（网格、卡片、工具栏、预览）

### Git 提交

- 使用Conventional Commits格式
- 类型: `feat`, `fix`, `refactor`, `docs`, `style`, `test`, `chore`

## 常用命令

```bash
npm install          # 安装依赖
npm run dev          # 启动开发服务器
npm run reveal-helper # 启动资源管理器定位 helper（可选）
npm run build        # 构建生产版本
npm run lint         # 代码检查
npm run typecheck   # TypeScript 类型检查
```

## 关键文件

- `src/App.tsx` - 应用入口
- `src/main.tsx` - React 挂载点
- `src/index.css` - 全局样式
- `src/lib/fileSystem.ts` - 文件系统操作封装
- `src/lib/thumbnail.ts` - 缩略图生成与媒体类型判断
- `src/hooks/useFileSystem.ts` - 文件夹授权、目录读取、导航与过滤状态
- `src/components/VirtualGrid.tsx` - 虚拟网格渲染
- `src/components/FileItemCard.tsx` - 文件卡片与缩略图加载
- `src/components/PreviewPane.tsx` - 侧边预览面板
- `docs/shortcuts.md` - 快捷键说明文档
- `docs/troubleshooting.md` - 常见问题排查

## 实现优先级

1. 文件夹选择与授权
2. 文件列表展示（网格视图）
3. 图片/视频预览
4. 搜索与筛选
5. 性能增强（缩略图并发队列、精细懒加载）
6. 键盘快捷键完善（当前已支持方向键、PageUp/PageDown、Enter、Esc、Ctrl/Cmd+O）
7. 幻灯片播放
8. 暗色主题切换能力

## UI 设计

### 布局

```
┌─────────────────────────────────────────────────────────┐
│  Toolbar                                                │
├────────────────────────────────────┬────────────────────┤
│                                    │                    │
│         文件网格区域                │    预览窗格        │
│         (虚拟列表)                 │    (可拖拽调整宽度) │
│                                    │                    │
└────────────────────────────────────┴────────────────────┘
```
