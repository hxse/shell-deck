# Execution Plan

## Phase 0: Current State Audit

* 读取 `.016` 后的 Macro editor 组件边界：`MacroEditorShell`、`MacroStepList`、`MacroActionPalette`、`MacroRunDock`。
* 确认现有 Actions/Flow 常驻栏入口、node tree mutation 位置、default node factory。
* 列出需要保留的 `.014/.015` layout invariants。

Gate：只读审计，不改行为。

## Phase 1: Insertion Command Layer

* 新增 path-based insertion command / reducer。
* 把 `before`、`after`、`inside if/elif/else/for` 转换为纯数据操作。
* 保证 node id 唯一。
* 给 command 层加 unit tests：正确 body path、取消无 mutation、移动不跨 body、remove confirmation flow 可被 UI 调用。

Gate：unit tests 覆盖 reducer，不依赖 DOM。

## Phase 2: Node Menu and Floating Palette

* 在每个 node header 增加 node menu。
* 删除常驻右侧 Actions/Flow palette 的目标实现，替换为 transient floating insertion palette。
* Palette 按 anchor context 过滤可插入节点：root/common/for scope。
* Runner controls 保持在 Macro run dock。
* `Esc`、Cancel、stale anchor 关闭 palette。

Gate：Playwright 覆盖 add before/after、cancel、palette context filtering。

## Phase 3: Control-Flow Body Insertion

* `if` group 支持 `Add inside if`、`Add elif`、`Add inside elif`、`Add else`、`Add inside else`。
* `for` 支持 `Add inside for`。
* `finish` / `break` / `continue` 支持 action-only body insertion；palette 在此模式下隐藏 Flow section，并且 move existing 只能移动普通 action node。
* `for` editor 支持 `count` / `forever` range selector。
* `extract_text` editor 的 `onEmpty` 支持 `continue`。
* Terminal target editor 改为一行一个 terminal，合并显示 index/alias/id，并提供 hover title。
* 折叠 branch 上插入时自动展开目标 body。
* `break` / `continue` 仅在 for scope 中可选。

Gate：Playwright 覆盖 if/elif/else/for/control-terminal 插入和 JSON body path；unit/integration 覆盖 for forever 和 control terminal action body runtime。

## Phase 4: Visual Nesting Polish

* 增加 Py-like vertical scope guide 与 branch label。
* Empty body 显示局部 add affordance。
* 处理 1080px / 常规桌面宽度下 palette 不溢出。
* 保证 editor 与 floating palette 各自滚动边界清楚。

Gate：focused e2e 检查无横向溢出，必要时增加 screenshot 或 bounding-box assertions。

## Phase 5: Close Gate

必须通过：

* `just check`
* `just test-unit`
* `just test-e2e`
* focused `.017` e2e recipe（实现时新增，例如 `just test-017`）
* `git diff --check`

Manual smoke 推迟到整体 macro UX 稳定后；`.017` 只要求自动化证明插入路径和 layout invariant。

## Non-Regression List

实现过程中不得回归：

* Flow V2 schema validation，包括 `.017` 新增的 `for` range 和 control terminal action-only body。
* `.016` send/capture/extract/input/if/parallel_send_capture semantics。
* `.014` Macro/Prompt/Trace workbench layout。
* Template CRUD / import / export。
* Run log realtime update。
