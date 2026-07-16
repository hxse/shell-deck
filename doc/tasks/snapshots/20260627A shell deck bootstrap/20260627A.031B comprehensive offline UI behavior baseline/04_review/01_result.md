# Review Result

## 当前状态

Implementation complete，Document / Implementation Gate 通过。

`.031B` 已建立一条从空 terminal deck 开始、完全通过 UI 创建 terminal、Prompt 和复杂 Macro，再实际运行与核验多 terminal 结果的离线 baseline。测试没有通过 API、fixture、seed terminal 或手写导入 JSON 预置核心对象。

## 覆盖结果

### Source inventory

* 冻结 `.031A` 非 Codex interactive source signatures：`202`。
* 排序后 digest：`7de9ac2946db94a2134e22539477094c04cc95caef6f44afce0738ff388fec19`。
* source 新增、删除、identity 漂移或未归属 control 会由 `tests/unit/uiBehaviorInventory031B.test.ts` 直接失败并打印实际清单。

### Runtime inventory

* required semantic control ids：`239`。
* 最终浏览器事件 evidence 缺失：`0`。
* 明确 exclusion：`4`，仅为 root/parallel 的 Codex `agent-event` Agent/Mode controls。
* evidence collector 覆盖 click、input、change、double-click、keydown、pointerdown、mouseover、dragstart 和 drop，并沿真实 event target 的 ancestor chain 记录，能够覆盖 SVG icon button、hover help 和复合 button。

### 完整用户旅程

单一 Playwright test 从没有 terminal、没有 Macro、没有 Prompt 的 isolated config 开始，经 UI 完成：

* 创建并操作 fake、real shell、text terminal，覆盖 rename Enter/Escape/blur、keyboard select、drag reorder、close cancel/accept、真实 shell fixed command、Text 多行/行号滚动/Copy；
* Prompt project/global New、Save、search、scope filter/move、select、Copy、Delete cancel/accept；
* 从 visual editor 零开始构建包含 send、wait、capture-source、extract_text、if/elif/else、for text-list/template、notify、input、break、continue、parallel lanes 和 finish 的复杂 Macro；
* 操作 node/branch/item/part/lane 的 collapse、move、add、remove、confirm、insertion Cancel/scrim、Move existing，以及 terminal capability repair；
* 覆盖 Macro New/Save/search/select/Export/Import/Duplicate/Delete 和 JSON Copy/Edit/malformed/schema-invalid/Cancel/valid Save；
* 真实执行 Start、Pause、Resume、runtime Input Submit、Stop 和 completed run；
* 在两个 fake terminal 与一个 Text terminal 分别核验 send/capture/parallel/input 结果；
* 在 Trace 中核验 run、node log、artifact preview、AI Trace Copy、debug controls；
* 拦截所有非 loopback request，最终 unexpected external request 数量为 `0`；
* 使用 browser-local Notification/Audio mock，不发送 Telegram、不运行 Codex。

## Finding

### F1：Escape rename 被卸载 blur 二次提交

* 级别：P2 / L1。
* 状态：已修复。
* 复现：双击 terminal title，输入新 alias，按 Escape；输入框卸载时触发 `blur`，旧实现继续调用 commit，导致本应取消的 alias 被保存。
* 根因：`onkeydown(Escape)` 先清除 `editingTerminalId`，但 input unmount 的 `onblur` 没有复核 rename 是否仍 active。
* 修复：`TerminalTabBar.svelte` 只在 `editingTerminalId` 仍等于当前 terminal id 时允许 blur commit。
* contract 依据：`.031A` active terminal deck contract 已明确 “Enter or blur commits，Escape cancels”；本修改恢复既有 contract，没有新增产品语义。
* 回归：完整 journey 同时验证 Enter 保存、Escape 取消和 click-away blur 保存。

## 测试基础设施结果

* `SHELL_DECK_E2E_SEED=none` 让 Playwright server 可以真正从空 deck 启动，不再默认注入 fake terminal。
* `scripts/runPlaywright.ts` 补齐 Nix Chromium 所需 system library paths，并允许 `findLibraryDir()` 识别 `.so` symlink；否则 Chromium 会因 ATK/Xcomposite 等动态库缺失而无法启动。
* journey 使用稳定 node/lane/action identity，避免 Playwright 动态 `.last()` locator 在后续插入后悄悄改指向其他节点。
* 单 action timeout 为 `10s`，顶层 journey timeout 为 `600s`；没有固定长 sleep，全部等待可观察 UI state。

## Gate

* `steam-run just check`：通过，`svelte-check` 0 errors / 0 warnings；`tsc --noEmit` 通过。
* `steam-run just build`：通过，198 modules；保留既有单 bundle `602.99 kB > 500 kB` warning。
* `just test-031`：通过，4 unit + 14 Chromium E2E。
* `just test-031b`：通过，1 inventory unit + 1 完整 Chromium journey；最后一次 journey `44.0s`，组合入口 `50.7s`。
* `git diff --check`：通过。

当前受限 shell 直接运行 `just check` / `just build` 时，Node Vite 与 esbuild service 会进入零 CPU 的 IPC wait；同一 recipe 在项目 Playwright 已使用的完整 `steam-run` runtime 中稳定通过。该现象属于本机 Nix runtime 差异，不是产品断言失败。

## 后续演进边界

* `.031B` 冻结 `.031A` revision `1236af61` 的行为，不提前采用 `.032+` contract。
* 后续 task 只有在自己的 spec 明确改变产品语义时，才可带 `changedBy`、old/new behavior 和 spec attribution 更新 inventory/journey。
* selector、component nesting 或实现重构本身不能成为降低覆盖的理由。
* Codex / `agent-event` exclusion 不得扩大；未来若纳入离线可测 contract，应显式移出 exclusion。
