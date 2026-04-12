# 126 Touch-First Compact Remote-Readonly Workspace 触控优先紧凑远程只读工作区规范

## 1. 目的 (Purpose)

定义 Fauplay 在 `compact + touch-first + remote-readonly` 组合下的工作区集成语义，确保：

1. 同一套远程只读数据面可以被手机浏览器稳定消费，而不引入独立的移动业务域。
2. `003-ui-ux` 定义的三轴能力可在一个真实组合场景中落成一致的工作区壳、预览主路径与次级能力入口。
3. `remote-readonly` 的只读边界在紧凑触控工作区内持续成立，不因窄屏或触摸补位而重新暴露 mutation 或插件能力。
4. 手机浏览器上的主要验收链路固定为：同源 `HTTPS` 远程登录 -> 进入远程 root -> 浏览文件网格 -> 全屏预览 -> 返回工作区。
5. 本专题作为首个完整组合验收主题，要求前端先完成通用 `compact shell + presentation profile` 重构，而不是为 `126` 单独硬编码一套手机壳。
6. 本专题允许在远程登录链路中引入 remember-device 持久登录体验，但该能力只服务于 `remote-readonly` 的接入与回退，不改变三轴组合本身的 UI 主路径定义。

## 2. 关键术语 (Terminology)

- 触控优先（Touch-First）
- 紧凑工作区（Compact Workspace）
- 远程只读工作区（Remote-Readonly Workspace）
- 组合工作区 Profile（Combined Workspace Profile）
- 主预览路径（Primary Preview Path）
- 次级能力面板（Secondary Capability Sheet）
- 全屏预览覆盖层（Fullscreen Preview Overlay）

术语值映射：

1. `compact` 对应 [`../003-ui-ux/viewport-modes.md`](../003-ui-ux/viewport-modes.md) 的 `narrow`。
2. `touch-first` 表示当前工作区必须以 [`../003-ui-ux/input-modes.md`](../003-ui-ux/input-modes.md) 的 `touch` 入口闭环为设计基线；键盘如存在，只视为附加加速器。
3. `remote-readonly` 对应 [`../003-ui-ux/access-modes.md`](../003-ui-ux/access-modes.md) 的只读访问模式。

## 3. 范围与非目标 (In Scope / Out of Scope)

范围内：

1. `compact + touch-first + remote-readonly` 组合工作区的 UI 集成语义。
2. 文件网格、全屏预览、顶部工具区、人物面板与次级能力面板在该组合下的表现态。
3. 图片横滑、显式上一项/下一项按钮、返回工作区与 `断开/切换` 在该组合下的触控补位。
4. 手机浏览器上的真实验收路径与联调要求。

范围外：

1. 远程鉴权、会话 Cookie、路径安全、发布边界与 `/v1/remote/*` HTTP 契约。
2. `full-access` 的紧凑触控工作区，或 `wide + touch` / `wide + remote-readonly` 的其他组合专题。
3. pinch zoom、双指手势、系统返回手势、PWA、safe area 与虚拟键盘避让等更强移动浏览器专题。
4. 新增远程写操作、远程插件工作台或远程人物写操作。

## 4. 上游职责归属 (Upstream Ownership)

1. 远程访问提供者、same-origin 发布形态与 loopback/LAN/dev-only 分层，归属 [`../001-architecture/spec.md`](../001-architecture/spec.md)。
2. `/v1/remote/*` 的公开 HTTP 入口、会话登录交换、`Range/206` 与远程衍生资源请求契约，归属 [`../002-contracts/spec.md`](../002-contracts/spec.md)。
3. `remote-access` 配置链、`rootId + relativePath`、远程 DTO、roots 来源切换与远程共享收藏真源，归属 [`../005-local-data-contracts/spec.md`](../005-local-data-contracts/spec.md)。
4. 鉴权、路径授权、最小暴露面、secret / 日志 / 浏览器持久化最小化，归属 [`../006-security/spec.md`](../006-security/spec.md)。
5. 真实连接步骤、局域网发布与本地 HTTPS 联调，归属 [`../../docs/remote-connection.md`](../../docs/remote-connection.md) 与 [`../../docs/https-dev.md`](../../docs/https-dev.md)。
6. 本专题不再承担“远程接入总规范”角色，只负责把上述上游能力组装成一个可验收的组合工作区。

## 5. 核心语义 (Core Semantics)

### 5.1 组合 Profile 定义

1. 本专题的目标组合固定为：`compact + touch-first + remote-readonly`。
2. 当工作区同时命中：
   - `viewport = narrow`
   - `input = touch`
   - `access = remote-readonly`
   系统必须应用本专题定义的组合工作区 Profile。
3. 该组合 Profile 只改变表现层与入口组织，不改写远程只读数据面、预览状态机或遍历语义。
4. 若未来 `compact + hybrid + remote-readonly` 未另开专题，它可复用本专题的触控优先表现态，但不得反向要求本专题承担 hybrid 专属规则。
5. 本专题依赖 `003-ui-ux` 的三轴真源在运行时落为统一 `presentation profile`，并由 `compact` 主壳承接布局、由 profile 承接触控优先与远程只读差异。

### 5.2 工作区主视图

1. 进入工作区后，文件网格必须作为默认主视图。
2. 在该组合下，工作区不得依赖桌面常驻右侧预览 pane 作为主要预览入口。
3. 顶部工具区必须优先保留：
   - 当前目录语境
   - 搜索入口
   - 返回工作区 / 返回上级
   - 人物入口
   - 筛选入口
   - `断开/切换`
4. 收藏、历史、帮助、平铺视图、缩略图尺寸与其他次级操作可以收敛到临时面板、overflow sheet 或同等一次性容器中，不得长期挤占主视口。
5. 人物面板在该组合下必须转为全屏或覆盖式只读面板，不保留桌面并列侧栏形态。
6. 该组合下的人物面板内部布局必须优先采用窄屏 staged flow：人物列表与人物详情不再并列常驻；进入人物详情后必须存在显式返回人物列表的触控入口。
7. `compact shell` 必须是通用紧凑工作区壳；本专题只要求它首先完整验收 `remote-readonly`，不得把该壳实现成 `126` 私有组件树。

### 5.3 预览主路径

1. 在该组合下，点击文件必须直接进入全屏预览覆盖层，而不是先打开常驻侧栏预览。
2. 图片、视频、文本与不可内嵌预览文件都必须复用同一条“进入全屏预览覆盖层”的主路径。
3. 关闭全屏预览后，系统必须返回文件网格上下文，而不是切换到新的桌面式 pane 状态。
4. 全屏预览覆盖层必须继续复用现有预览状态机、遍历语义、顺序/随机与自动播放设置，不得分叉出新的移动专用状态机。
5. `WorkspaceShell` 与 `compact shell` 之间的职责边界必须明确：前者负责状态与业务门控，后者负责紧凑布局、覆盖式结果面板与全屏预览主路径。

### 5.4 触摸导航与显式控件

1. 在该组合下，全屏媒体预览必须提供显式可点的：
   - `上一项`
   - `下一项`
   - `关闭`
2. 图片全屏预览必须支持水平滑动切换，语义继续固定为：
   - 左滑 = 下一项
   - 右滑 = 上一项
3. 视频全屏预览在本专题中不启用横滑切换；视频只通过显式按钮与既有播放控件完成导航和播放。
4. 轻点、短拖、纵向滚动、工具栏区域拖动与 face overlay 点击不得误触发图片横滑切换。

### 5.5 只读边界与次级能力

1. `remote-readonly` 的只读边界在该组合下继续有效：
   - 不显示插件工作台
   - 不显示 MCP 调用入口
   - 不显示回收站
   - 不显示重命名、删除、标注写入
   - 不显示人物写操作与人脸纠错面板
2. 标签展示、标签过滤、人物浏览、人物详情与来源跳转仍必须可达，但入口可转为覆盖式次级面板。
3. `断开/切换` 在该组合下必须始终可达，不得藏到无法在手机端发现的位置。
4. 该组合下的预览头部必须采用只读展示态：文件名以静态文本显示，已有标签仅保留只读 chips，不显示重命名、标签写入或“工具上下文不完整”等 full-access 降级提示。
5. 该组合下的收藏列表必须消费服务端远程共享收藏，而不是浏览器 localStorage；roots 列表可来自 `manual` 或 `local-browser-sync` 两种上游来源，但当前工作区消费方式保持一致。
6. 该组合下的目录导航与全屏 / 侧栏预览状态必须同步到浏览器 URL 与 History API；在真实手机浏览器上，浏览器 `后退 / 前进` 必须优先回到先前目录或预览态，再离开当前站点。

### 5.6 手机浏览器验收口径

1. 本专题的主要验收环境固定为真实手机浏览器，而不是仅依赖桌面 DevTools 模拟。
2. 手机端验收必须建立在同源 `HTTPS` 远程只读链路已可用的前提上。
3. 桌面窄窗口与移动模拟视口只能作为补充回归环境，不能替代真实手机验收。

### 5.7 远程会话生命周期

1. 远程运行态会话必须同时具备绝对过期与空闲过期。
2. 当前默认口径固定为：
   - 绝对过期：`12h`
   - 空闲过期：`30min`
3. 上述默认值属于当前组合工作区的联调与验收基线；具体 cookie、失效清理与 `401` 回退机制仍以上游专题与连接文档为准。
4. 远程登录页可提供显式“记住此设备”选项；启用后，服务端可为当前浏览器签发长效 remember-device cookie，当前默认目标口径为 `30d`。
5. remember-device 只用于在 session 缺失或 Gateway 重启后自动恢复远程只读登录态，不得把 Bearer token 落到浏览器持久化状态。
6. `断开/切换` 在该组合下默认只结束当前 session 并回到启动页，不得隐式撤销 remembered device。
7. 该组合下必须提供显式“忘记此设备”入口；触发后，系统必须同时清理当前 session、撤销当前 remembered device，并回到远程登录页。
8. 当远程 token 或相关运行时指纹变化时，已有 remembered device 必须失效；手机端后续访问需要重新输入 token。

## 6. 公共接口与引用关系 (Public Interfaces & References)

1. 本专题不新增后端 HTTP API、配置字段或安全契约。
2. 本专题新增的文档级组合 Profile 固定为：`touch-first compact remote-readonly workspace`。
3. 本专题实现时，前端内部可以新增组合态表现层接口，但这些接口不改变上游公开协议。
4. 本专题的所有远程接入、same-origin 发布、配置链与安全规则都必须引用第 4 节中的上游真源，不得在本文件再次复制完整接口契约。
5. 本专题允许前端内部新增：
   - `ViewportMode = 'wide' | 'compact'`
   - `InputMode = 'keyboard' | 'touch' | 'hybrid'`
   - `WorkspacePresentationProfile`
   但它们只作为内部表现层接口，不构成新的后端公开契约。

## 7. 功能需求 (FR)

1. `FR-TCRW-01` 系统必须支持 `compact + touch-first + remote-readonly` 组合工作区 Profile。
2. `FR-TCRW-02` 该组合下的默认主视图必须为文件网格，不得要求用户先通过常驻侧栏进入预览。
3. `FR-TCRW-03` 该组合下点击文件必须直接进入全屏预览覆盖层。
4. `FR-TCRW-04` 图片、视频、文本与不可预览文件都必须复用同一条“点击文件 -> 全屏预览覆盖层”的主路径。
5. `FR-TCRW-05` 该组合下的全屏媒体预览必须提供显式可点的 `上一项 / 下一项 / 关闭` 控件。
6. `FR-TCRW-06` 图片全屏预览必须支持水平滑动切换，并复用既有 `prev/next` 语义。
7. `FR-TCRW-07` 视频全屏预览在本专题中不得启用横滑切换。
8. `FR-TCRW-08` 顶部工具区必须优先保留目录语境、搜索、人物、筛选与 `断开/切换` 入口；次级能力允许转为临时面板。
9. `FR-TCRW-09` 人物浏览在该组合下必须转为只读覆盖式面板，不得重新暴露人物 mutation UI。
10. `FR-TCRW-10` `remote-readonly` 的只读边界在该组合下不得失效；插件工作台、回收站、重命名、删除、标注写入与人物写操作继续隐藏或不可触发。
11. `FR-TCRW-11` 本专题的主要验收必须包含真实手机浏览器上的同源 `HTTPS` 远程只读实测。
12. `FR-TCRW-12` 本专题落地前，前端必须先将工作区主布局拆为 `wide shell` 与 `compact shell`，并通过统一 `presentation profile` 驱动组合态行为。
13. `FR-TCRW-13` `compact shell` 必须复用通用工作区状态与预览状态机；本专题不得新增远程只读专用预览状态机。
14. `FR-TCRW-14` 该组合下的预览头部必须收敛为只读展示态，不得暴露仅服务于 `full-access` 工具链的 unavailable reason 文案、禁用按钮痕迹或标签管理 tooltip。
15. `FR-TCRW-15` 该组合下的人物面板必须采用窄屏 staged flow，列表与详情不得继续并列常驻，且人物详情必须提供显式返回人物列表入口。
16. `FR-TCRW-16` 该组合下的远程登录页必须允许用户显式选择是否“记住此设备”，且 remember-device 不得通过浏览器持久化 Bearer token 实现。
17. `FR-TCRW-17` 该组合下必须同时提供“断开/切换”与“忘记此设备”两类可发现入口；前者只结束当前 session，后者还必须撤销当前设备上的持久登录态。
18. `FR-TCRW-18` 该组合下的远程收藏必须消费服务端共享收藏；roots 列表不得依赖当前手机浏览器自身的本地缓存或收藏状态。
19. `FR-TCRW-19` 该组合下的目录导航与可见预览态必须接入浏览器 URL / History，同一手机浏览器标签页中的 `后退 / 前进` 必须优先恢复工作区内部状态。

## 8. 验收标准 (AC)

1. `AC-TCRW-01` 在 `narrow + touch + remote-readonly` 组合下进入远程工作区时，主视图默认显示文件网格，不出现桌面常驻右侧预览 pane 作为主路径。
2. `AC-TCRW-02` 在该组合下点击图片、视频、文本或不可预览文件时，都会直接进入全屏预览覆盖层。
3. `AC-TCRW-03` 在该组合下关闭全屏预览后，用户回到原文件网格上下文，不会残留桌面式侧栏预览状态。
4. `AC-TCRW-04` 全屏图片预览中可通过可点按钮与左右横滑进入上一项/下一项，且与既有 `prev/next` 结果一致。
5. `AC-TCRW-05` 全屏视频预览中存在可点的 `上一项 / 下一项 / 关闭` 按钮，但左右拖动不会触发上一项/下一项导航。
6. `AC-TCRW-06` 收藏、历史、筛选、帮助、平铺视图、缩略图尺寸等次级能力可通过临时面板进入，不会长期挤占主视口。
7. `AC-TCRW-07` 人物列表与人物详情在该组合下以只读覆盖式面板呈现，且仍支持来源跳转。
8. `AC-TCRW-08` 该组合下插件工作台、回收站、重命名、删除、标注写入、人物写操作与人脸纠错面板均不可见或不可触发。
9. `AC-TCRW-09` 在真实手机浏览器上，通过同源 `HTTPS` 完成远程登录、进入 root、浏览文件、打开预览、图片横滑与 `断开/切换`，整条链路可用。
10. `AC-TCRW-10` `WorkspaceShell`、`wide shell` 与 `compact shell` 的职责边界清晰；三轴组合判断集中在统一 `presentation profile`，不会重新散落到工具栏、预览组件与面板组件中。
11. `AC-TCRW-11` 在该组合下打开预览时，文件名显示为静态文本，已有标签可见但不出现“工具上下文不完整”等 full-access 降级提示，也不保留禁用重命名或标签管理的交互痕迹。
12. `AC-TCRW-12` 在该组合下打开人物面板时，人物列表与人物详情以内聚的全宽 overlay 呈现；点击人物进入详情后，用户可通过显式返回入口回到列表，且人脸网格在手机宽度下仍可有效浏览与来源跳转。
13. `AC-TCRW-13` 在真实手机浏览器上，用户勾选“记住此设备”完成一次 token 登录后，即使当前 session 过期或 Gateway 重启，只要 remember-device 仍有效，重新访问远程站点时仍可自动恢复远程只读登录态。
14. `AC-TCRW-14` 在该组合下触发“断开/切换”时，用户返回启动页但 remembered device 仍保留；触发“忘记此设备”后，当前浏览器上的持久登录态会被撤销，后续访问需要重新输入 token。
15. `AC-TCRW-15` 在该组合下，手机浏览器对远程收藏执行新增/移除后，其他远程设备重新读取同一服务时可看到一致的共享收藏结果；roots 列表既可来自手写 `remote-access.roots[]`，也可来自本机自动发布的已同步 roots。
16. `AC-TCRW-16` 在真实手机浏览器上进入远程工作区后，用户依次进入子目录、打开全屏预览、关闭预览，再使用浏览器 `后退 / 前进` 时，会按先前目录与预览状态逐步回放，而不是直接退回浏览器默认标签页或离开站点。

## 9. 关联主题 (Related Specs)

- 架构边界：[`../001-architecture/spec.md`](../001-architecture/spec.md)
- 协议契约：[`../002-contracts/spec.md`](../002-contracts/spec.md)
- 交互基线：[`../003-ui-ux/spec.md`](../003-ui-ux/spec.md)
- 视口模式：[`../003-ui-ux/viewport-modes.md`](../003-ui-ux/viewport-modes.md)
- 输入模式：[`../003-ui-ux/input-modes.md`](../003-ui-ux/input-modes.md)
- 访问模式：[`../003-ui-ux/access-modes.md`](../003-ui-ux/access-modes.md)
- 触摸交互：[`../003-ui-ux/touch-interactions.md`](../003-ui-ux/touch-interactions.md)
- 本地数据契约：[`../005-local-data-contracts/spec.md`](../005-local-data-contracts/spec.md)
- 安全基线：[`../006-security/spec.md`](../006-security/spec.md)
- 远程连接指引：[`../../docs/remote-connection.md`](../../docs/remote-connection.md)
- 本地 HTTPS 联调：[`../../docs/https-dev.md`](../../docs/https-dev.md)
