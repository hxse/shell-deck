# Execution Plan

## 阶段 1：冻结 `.031A` 基线与 interactive inventory

* 读取 `.031A` task、active specs、Svelte components 与现有 `.031` tests。
* 生成非 Codex interactive-control source inventory。
* 为缺少稳定 identity 的 control 增加无视觉影响的 `data-testid` / accessible name。
* 明确 Codex / agent-event exclusion，禁止泛化 exclusion。

## 阶段 2：测试 harness

* 新增独立 `.031B` Playwright recipe，使用 isolated data root、free loopback port、AI disabled。
* 不传 seed terminal；唯一 config 从零开始。
* 拦截非 loopback network 并监听 console/page errors。
* 实现 runtime control evidence collector 与 inventory comparison。

## 阶段 3：workspace 与 terminal journey

* 覆盖 topbar、Settings、panel toggle/resize/reset。
* 通过 UI 创建 fake/real/text terminal。
* 覆盖 tab select/keyboard/rename/drag/close。
* 覆盖 fake output、real shell fixed command、Text edit/line numbers/copy。

## 阶段 4：Visual Macro 从零创建

* 只通过 UI New 与 insertion palette 搭建复杂 Macro。
* 逐一操作 action/flow types、node/branch/item/part/lane controls。
* 冻结 If 无 earlier artifact 时仍可插入的 editing-state contract。
* 构造最终可运行 Macro 时只使用 terminal-buffer/text-box capture，不使用 agent-event。

## 阶段 5：Macro chrome、JSON、Prompt 与 Trace

* 覆盖 Macro CRUD/search/select/export/import/duplicate/delete。
* 覆盖 JSON read/edit/invalid/cancel/valid save/lock。
* 覆盖 Prompt project/global CRUD/search/copy/scope move/delete。
* 覆盖 Trace/Run Log/AI Trace/artifact/debug controls。

## 阶段 6：Runner dogfood

* 运行 waiting Input + Pause/Resume。
* 运行 Stop。
* 运行多 terminal capture 的完整 Macro 并从 UI 验证输出、artifact 与 status。
* 不通过 API读取 run state作为主要断言。

## 阶段 7：审计与 Gate

* 运行 source inventory，确认 required/excluded/removed 全闭合。
* 运行 `.031` 原 Gate，确保新增 testability identity 未改变旧行为。
* 运行 `just test-031b`，记录耗时、control coverage 与发现的真实缺陷。
* 更新 `04_review`，区分产品 finding、测试基础设施 finding 与环境限制。

## 预计文件影响

* `doc/tasks/index/001_20260627A.md`
* `doc/tasks/snapshots/**/20260627A.031B **`
* `tests/e2e/comprehensiveUiBehavior031B.spec.ts`
* `tests/ui-baseline/031B/**`
* `tests/unit/uiBehaviorInventory031B.test.ts`
* `scripts/**` 中必要的离线 Playwright harness
* `package.json`
* `justfile`
* 少量 Svelte component 的 test identity；不得改可见产品行为

## 停止线

以下任一项阻断交付：

* 仍用 API/fixture 预置 Macro 或 terminal；
* 任一非 Codex button 未登记、未操作且无合法 exclusion；
* complex Macro 不是从 UI 创建；
* 没有真实运行或没有多 terminal capture evidence；
* 通过删除断言、扩大 exclusion 或整条 expected-fail 掩盖问题；
* `.031` 原 Gate 回归；
* 访问外部网络、运行 Codex 或发送 Telegram；
* 为测试方便改变产品 contract。
