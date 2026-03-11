# 110 Folder Favorites 收藏夹目录规范

## 1. 目的 (Purpose)

定义 Fauplay 收藏夹目录（Folder Favorites）能力契约，统一“收藏当前目录、收藏列表回访、跨根目录恢复、失败降级与容量上限配置”语义，作为实现与回归验收依据。

## 2. 关键术语 (Terminology)

- 收藏夹目录（Favorite Folder）
- 收藏切换（Favorite Toggle）
- 收藏列表（Favorites List）
- 跨根回访（Cross-root Favorite Open）
- 收藏容量上限（Favorites Capacity Limit）

术语值映射：

1. 收藏键：`rootId + relativePath`。
2. 存储键：`localStorage.fauplay:favorite-folders`。
3. 配置键：`src/config/app.json -> favorites.maxItems`。

## 3. 范围与非目标 (In Scope / Out of Scope)

范围内：

1. 当前目录一键收藏/取消收藏。
2. 收藏列表展示、打开、移除。
3. 收藏项跨根目录回访（自动切根后跳转）。
4. 收藏数据本地持久化、去重与容量截断。
5. 收藏容量上限配置化（默认 `100`）。

范围外：

1. 收藏别名编辑。
2. 收藏项手动拖拽排序。
3. 收藏相关全局快捷键设计。

## 4. 用户可见行为契约 (User-visible Contract)

1. 系统必须支持对当前目录执行“收藏/取消收藏”切换。
2. 收藏列表必须提供打开与移除操作。
3. 收藏列表默认按最近收藏优先（`favoritedAt` 倒序）。
4. 收藏项打开命中非当前根目录时，系统必须先切换到收藏所属根目录，再导航到收藏路径。
5. 收藏目标失效（缓存缺失、权限失效、路径不存在）时，系统必须给出可见错误提示，且收藏项默认保留。
6. 收藏项显示文案默认为 `<rootName>` 或 `<rootName>/<relativePath>`。
7. 页面刷新后收藏列表必须可恢复（localStorage 生效）。

## 5. 跨组件共享语义定义 (Shared Semantics)

1. 收藏模型
   - 数据模型：`Array<{ rootId: string; rootName: string; path: string; favoritedAt: number }>`。
2. 去重与排序
   - 去重口径：`rootId + normalizedPath`。
   - 同键重复写入时，仅保留时间戳更新后的最新项。
   - 排序口径：`favoritedAt` 倒序。
3. 路径归一化
   - 收藏与比较前必须执行相对路径归一化：按 `/` 分段并移除空段。
4. 容量上限
   - 收藏列表最大保留条数由 `favorites.maxItems` 决定。
   - 超出上限时按排序结果从尾部截断。
5. 配置降级
   - `favorites.maxItems` 非法（非整数、`<=0`、`NaN`）时必须回退默认值 `100`。
   - 配置读取失败时不得阻断核心浏览能力。

## 6. 功能需求 (FR)

1. `FR-FF-01` 系统必须支持当前目录收藏切换能力。
2. `FR-FF-02` 系统必须提供收藏列表入口，并支持打开与移除收藏项。
3. `FR-FF-03` 收藏数据必须持久化到 `localStorage.fauplay:favorite-folders`。
4. `FR-FF-04` 收藏写入必须按 `rootId + normalizedPath` 去重并按 `favoritedAt` 倒序排序。
5. `FR-FF-05` 收藏容量必须由配置文件 `src/config/app.json` 的 `favorites.maxItems` 控制。
6. `FR-FF-06` 当 `favorites.maxItems` 无效时，系统必须回退默认容量 `100`。
7. `FR-FF-07` 收藏打开必须支持跨根目录自动切换后导航。
8. `FR-FF-08` 收藏目标不可访问时，系统必须提供可见错误并保留收藏项。
9. `FR-FF-09` 本专题不得新增全局快捷键契约，`src/config/shortcuts.ts` 与 `docs/shortcuts.md` 保持不变。

## 7. 验收标准 (AC)

1. `AC-FF-01` 点击星标可收藏当前目录，再次点击可取消收藏。
2. `AC-FF-02` 同根同路径重复收藏不产生重复项，仅更新时间并置顶。
3. `AC-FF-03` 收藏列表按 `favoritedAt` 倒序展示。
4. `AC-FF-04` 收藏列表打开同根目录项可直接跳转。
5. `AC-FF-05` 收藏列表打开异根目录项会自动切根后跳转。
6. `AC-FF-06` 收藏目标失效时错误可见，收藏项仍保留。
7. `AC-FF-07` `favorites.maxItems` 未配置或配置无效时，收藏容量上限回退为 `100`。
8. `AC-FF-08` `favorites.maxItems=100` 时，收藏数超过上限后仅保留最近 `100` 条。
9. `AC-FF-09` 页面刷新后收藏项可恢复。
10. `AC-FF-10` 本专题交付后 `src/config/shortcuts.ts` 与 `docs/shortcuts.md` 无新增条目。

## 8. 失败与降级行为 (Failure & Degradation)

1. localStorage 不可用或读写失败时，系统应降级为会话内收藏状态，不影响核心浏览流程。
2. 收藏打开时若根目录缓存缺失或权限失效，系统应提示错误并引导用户重新选择目录。
3. 配置文件字段缺失、类型非法或值越界时，系统必须使用默认值并继续运行。

## 9. 公共接口与类型影响 (Public Interfaces & Types)

1. 必须新增收藏模型类型：`FavoriteFolderEntry`。
2. 必须新增收藏操作能力入口（例如 `toggleCurrentFolderFavorite`、`openFavoriteFolder`、`removeFavoriteFolder`）。
3. 收藏上限配置必须通过应用配置对象暴露（例如 `appConfig.favorites.maxItems`）。

## 10. 默认值与一致性约束 (Defaults & Consistency)

1. 专题目录固定为 `110-folder-favorites`。
2. 收藏容量默认值固定为 `100`。
3. 收藏容量推荐安全范围：`1..1000`。
4. 收藏显示名称默认使用 `<rootName>/<relativePath>`（根目录仅 `<rootName>`）。

## 11. 关联主题 (Related Specs)

- 上游基线：[`../000-foundation/spec.md`](../000-foundation/spec.md)
- 交互基线：[`../003-ui-ux/spec.md`](../003-ui-ux/spec.md)
- 地址栏导航：[`../102-address-bar-navigation/spec.md`](../102-address-bar-navigation/spec.md)
