# 003 访问模式细则 (Access Modes Reference)

## 目的

定义工作区在不同访问权限下的 UI / 交互差异，作为 [`spec.md`](./spec.md) 的主轴文档之一；本文件只定义“哪些能力可见、可触发、如何命名与如何回退”，不定义鉴权、API、cookie、路径安全或数据面契约。

## 范围与边界

范围内：

1. `full-access` 与 `remote-readonly` 两种访问模式的 UI profile。
2. 两种模式下工作区可见能力、不可触发能力与模式回退入口。
3. 访问模式切换对浏览器本地 UI 状态隔离的要求。

范围外：

1. 本地数据面、absolutePath 读取与 mutation 落盘语义（归属 `111-local-file-browser` 及相关专题）。
2. 远程鉴权、会话、发布边界、路径安全与 `/v1/remote/*` 契约（归属 `001-architecture`、`002-contracts`、`005-local-data-contracts`、`006-security` 与相关连接文档）。
3. 宽/窄视口与键盘/触控差异（归属 [`viewport-modes.md`](./viewport-modes.md) 与 [`input-modes.md`](./input-modes.md)）。

## 模式定义

1. `full-access`
   - 本地工作区默认访问模式
   - 表示当前工作区可使用完整的本地浏览、mutation 与工具交互能力
2. `remote-readonly`
   - 远程只读工作区访问模式
   - 表示当前工作区只允许只读浏览与只读增强能力，不允许触发 mutation 或本地工具链

## 用户可见行为契约

1. 访问模式是 UI profile，不是新的工作区 IA。
2. `full-access` 作为本地工作区默认 UI profile；当上游能力可用时，可显示插件工作台、工具调用、回收站、重命名、删除、标注写入与人物写操作等入口。
3. `full-access` 的启动页可额外暴露本机专用管理入口，例如“管理已记住设备”；该入口必须打开本机专用全屏管理面板，不引入远程工作区内复用入口。
4. `remote-readonly` 作为远程工作区 UI profile；必须保留以下只读主路径：
   - 目录浏览
   - 搜索、排序、基础筛选
   - 平铺视图
   - 文件预览
   - 收藏与最近访问
   - 标签展示与标签过滤
   - 人物列表、人物详情与来源跳转
5. `remote-readonly` 下必须隐藏或禁用以下不可触发能力：
   - MCP / 插件工作台与工具调用
   - 回收站
   - 重命名、删除、标注写入
   - 人物写操作、人脸纠错、指派、忽略等 mutation UI
6. `remote-readonly` 下预览头部必须采用只读展示态：文件名以静态文本显示，标签只保留只读展示，不得暴露仅用于解释 `full-access` 工具不可用的 unavailable reason 文案、禁用按钮痕迹或 tooltip。
7. `remote-readonly` 下工作区顶部必须提供统一的 `断开/切换` 入口。
8. 当 `remote-readonly` 同时提供“断开/切换”与“忘记此设备”时，两者必须是不同动作：前者只退出当前工作区并结束当前 session，后者还必须撤销当前设备上的持久登录态。
9. 本机 remembered-device 管理页只允许在本机 `full-access` 启动页中暴露；远程同源站点与 `remote-readonly` 工作区不得显示该入口。
10. 当访问模式失效或切换时，系统必须清理该模式的活动工作区 UI 状态，并回到对应入口页或选择页；具体鉴权与 provider 语义由上游专题定义。
11. 浏览器本地收藏、历史与其他本地 UI 状态必须按访问模式与访问源隔离，不得在 `full-access` 与 `remote-readonly` 之间串用。
12. 访问模式差异必须先映射为统一 UI profile，再由工作区壳与预览表现层消费；访问模式文档本身不定义具体组件树。

## 功能需求 (FR)

1. `FR-AM-01` 系统必须固定支持 `full-access | remote-readonly` 两种访问模式。
2. `FR-AM-02` 本地工作区默认访问模式必须为 `full-access`。
3. `FR-AM-03` 远程只读工作区默认访问模式必须为 `remote-readonly`。
4. `FR-AM-04` `full-access` 可见能力必须跟随对应上游能力启用，不得被远程只读规则错误裁剪。
5. `FR-AM-05` `remote-readonly` 必须保留目录浏览、搜索、排序、基础筛选、平铺视图、预览、收藏/历史、标签只读与人物只读主路径。
6. `FR-AM-06` `remote-readonly` 必须隐藏或禁用所有 mutation、MCP 与插件工作台入口。
7. `FR-AM-07` `remote-readonly` 下必须提供统一的 `断开/切换` 入口。
8. `FR-AM-08` 访问模式切换或失效后，系统必须清理该模式的活动工作区 UI 状态，并回到相应模式入口。
9. `FR-AM-09` 浏览器本地收藏、历史与其他本地 UI 状态必须按访问模式与访问源隔离。
10. `FR-AM-10` 运行时必须提供统一访问模式映射入口，使 `full-access | remote-readonly` 能被工作区表现层 profile 直接消费，而不是由各组件自行推导。
11. `FR-AM-11` `remote-readonly` 下预览头部必须隐藏仅用于解释 `full-access` 工具不可用的 unavailable reason 文案，并将文件名收敛为静态只读展示。
12. `FR-AM-12` `remote-readonly` 若提供 remember-device 一类持久登录体验，UI 必须区分“断开/切换”与“忘记此设备”两类动作，不得用单一退出入口同时承载两种语义。
13. `FR-AM-13` 本机 `full-access` 启动页可提供 remembered-device 管理入口，但该入口不得出现在 `remote-readonly` 工作区或远程同源站点中。

## 验收标准 (AC)

1. `AC-AM-01` 本地工作区进入时默认应用 `full-access` UI profile，完整本地能力可按上游专题暴露。
2. `AC-AM-02` 远程工作区进入时默认应用 `remote-readonly` UI profile，目录浏览、搜索、排序、基础筛选、预览、标签与人物只读链路正常。
3. `AC-AM-03` `remote-readonly` 下插件工作台、MCP、回收站、重命名、删除、标注写入与人物 mutation UI 不可见或不可触发。
4. `AC-AM-04` `remote-readonly` 下顶部可见统一的 `断开/切换` 入口。
5. `AC-AM-05` 访问模式切换或失效后，系统会清理对应工作区 UI 状态并返回相应入口页或选择页。
6. `AC-AM-06` 本地模式与远程只读模式的浏览器本地收藏、历史与其他持久化 UI 状态不会串用。
7. `AC-AM-07` 访问模式差异由单一 UI profile 驱动，不会在工具栏、预览、人物面板与结果面板中各自维护不一致的显隐逻辑。
8. `AC-AM-08` `remote-readonly` 下预览头部文件名显示为静态文本，已有标签仍可见，但不会出现“工具上下文不完整”等 full-access 降级提示、禁用按钮痕迹或标签管理不可用 tooltip。
9. `AC-AM-09` `remote-readonly` 若启用 remember-device，用户可区分“仅断开当前会话”与“忘记此设备并撤销持久登录态”。
10. `AC-AM-10` 本机 `full-access` 启动页可见 remembered-device 管理入口；远程同源站点与 `remote-readonly` 工作区看不到该入口。

## 关联文档

- 主规范：[`./spec.md`](./spec.md)
- 视口模式细则：[`./viewport-modes.md`](./viewport-modes.md)
- 输入模式细则：[`./input-modes.md`](./input-modes.md)
- 本地文件浏览器：[`../111-local-file-browser/spec.md`](../111-local-file-browser/spec.md)
- 触控优先紧凑远程只读工作区：[`../126-touch-first-compact-remote-readonly-workspace/spec.md`](../126-touch-first-compact-remote-readonly-workspace/spec.md)
