# Execution Plan

## Phase 1: Contract freeze

目标：先冻结 Flow V2 名称、schema 和 legacy mapping。

工作项：

* 明确 Actions Palette 与 Flow Palette 的边界。
* 冻结 Flow V2 节点：`if/elif/else/for/break/continue/return`。
* 冻结 `sleep` 两种 mode：`duration` 与 `until-resume`。
* 明确 `pause/stop` 只属于 runner control buttons。
* 明确 `complete/branch/goto/pause/stop/fail` 在新 GUI 中的 legacy 处理。

停止线：

* 如果仍需要在新 GUI 主路径暴露 `goto`，不能进入实现。
* 如果条件表达式退回字符串 DSL，不能进入实现。

## Phase 2: Schema and validation prototype

目标：实现 Flow V2 schema 的最小验证，但不影响 v1 模板执行。

建议文件边界：

* `src/lib/macro/flowV2Types.ts`
* `src/lib/macro/flowV2Schema.ts`
* `tests/unit/flowV2Schema.test.ts`

验证重点：

* `if/elif/else` group 结构合法。
* `for` body 合法。
* `break/continue` 只能出现在 loop 内。
* `return` 可以出现在任意 block。
* `sleep until-resume` 不需要 duration。
* `sleep duration` 必须有正数 `durationMs`。
* `pause/stop/goto/branch/complete/fail` 不允许作为 v2 primary node。
* condition 类型校验仍复用 parser profile signal contract。

## Phase 3: Compiler or interpreter spike

目标：验证 Flow V2 能被执行而不重写全部 action runtime。

推荐策略：

* 先做 `flowV2 -> execution plan` compiler。
* action nodes 复用现有 `send_line/wait/capture/parse/parallel_all` runtime。
* `for` 编译为 bounded loop，不允许无限循环。
* `if/elif/else` 编译为 structured branch，不生成用户可见 `goto`。
* `break/continue/return` 作为 structured control result，而不是任意 step jump。

必须记录：

* block path。
* iteration index。
* selected branch。
* return reason。
* sleep until-resume entry/resume。

## Phase 4: GUI redesign

目标：让用户不再直接面对 legacy flat control nodes。

工作项：

* Macro editor 分为 Actions Palette 与 Flow Palette。
* 中间用 block tree 展示缩进线。
* 右侧 inspector 编辑节点参数。
* `if/elif/else` 作为一个 group 编辑。
* `for` body 可折叠。
* `sleep` inspector 支持：
  * `duration` + ms/s/min/h 输入。
  * `until-resume` + reason。
* 顶部保留 Start/Pause/Resume/Stop。
* v1 legacy template 打开时显示 legacy badge。

## Phase 5: Migration and compatibility

目标：不破坏已有用户模板。

工作项：

* v1 模板继续运行。
* v2 模板默认新建。
* 提供 v1 -> v2 preview migration。
* `complete` -> `return`。
* `pause` -> `sleep until-resume`。
* 简单 `branch` -> `if/else`。
* 简单 `goto + loopGuard` -> `for`。
* 复杂任意 `goto` 保持 legacy，不自动迁移。

停止线：

* 任何自动迁移如果无法证明语义等价，只能提示用户手动处理。

## Phase 6: Tests

自动化测试建议：

* schema unit tests。
* compiler/interpreter unit tests。
* runner integration：
  * `for` count loop。
  * `if/elif/else` routing。
  * `break` exits nearest loop。
  * `continue` enters next iteration。
  * `return` completes run。
  * `sleep until-resume` waits for Resume。
* GUI e2e：
  * Actions / Flow palettes 分栏。
  * block tree 缩进显示。
  * 添加 nested `for -> if -> return/continue`。
  * legacy v1 template 显示 legacy badge。
* run log e2e：
  * block path。
  * loop iteration。
  * selected branch。
  * sleep until-resume entry/resume。

## Close Gate

本任务已经落地一个受限实现切片：

* Flow V2 block-tree type contract。
* Flow V2 schema validator prototype。
* Macro GUI Actions / Flow palette 分栏。
* v1 legacy flow node badge 与折叠 Legacy 区。
* `just test-011` targeted gate。

当前 close gate：

```bash
just check
just test-011
just test-unit
just test-e2e
git diff --check
```

仍未进入本任务实现范围：

* Flow V2 compiler/interpreter。
* v2 模板默认创建与持久化。
* v1 -> v2 自动迁移。
* Flow V2 run log block path / iteration metadata。
