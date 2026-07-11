# Execution Plan

## 当前状态

Implementation completed；automated Close Gate passed。实现遵循 02_spec，未引入兼容方案。

## Phase 1: Schema And Template Core

* 新增 TextListItem object type，破坏性替换 string[]。
* Strict validator 检查 item object exact keys、key 单行、value string，并拒绝 string/mixed/alias/entry-list。
* 将 token 常量和 syntax validator 改为 {{index}}、{{key}}、{{value}} 三 token。
* Renderer 使用一次 union callback replacement，补 non-recursive tests。
* 更新 editor helper 的默认 item 判定和 template scope naming。

Gate：

* 旧 string[] 与 {{text}} 有明确 negative tests。
* 生产代码不存在旧 token 常量、alias 或 conversion branch。

## Phase 2: Runner, Cursor And Events

* text-list iteration 从当前位置和 item object 构造 immutable { index, key, value, forStepId } binding。
* Cursor/context snapshot 保存并恢复完整 binding；executionPath 继续只用 zero-based iterationIndex。
* 所有 scalar/message renderer 使用完整 binding。
* loop_iteration event 保持 rangeKind=text-list，并证明 iteration 等于 {{index}}；不新增独立 index/key/value binding snapshot 字段，既有 rendered action trace 保持当前 run-log contract。
* 覆盖 nested shadow/restore、count inheritance、parallel、artifact、wait/input/capture pause/resume。

Gate：

* 同一动态 invocation 的 key/value/index 在暂停前后不漂移。
* 一次渲染不扫描 replacement text。
* .025 no-duplicate resume suites 继续通过。

## Phase 3: Editor And Adaptive Textarea

* text-list card 改为纯数字 index、单行 Key、adaptive multiline Value。
* Add/Remove/Up/Down 使用完整 object，collapsed summary 显示三 token。
* Use loop template 为 S1-S6 提供三个 Insert button；S5/S6 改为 multiline，S3 继续单行。
* 共享 adaptive textarea 测量实际 scrollHeight + one line，支持 per-surface autoMaxRows、overflow 和 60vh hard cap。
* 用 temporary manual override 区分程序性 autosize 与用户 native resize；输入不清除 manual height。
* Macro description 和 runtime input 接入同一组件，移除冲突的全局 min-height。

Gate：

* A1-A6 与 S1-S6 精确矩阵全部覆盖。
* 窄 panel、soft wrap、manual resize、reload/remount 不产生 layout regression。

## Phase 4: Focused Tests And Legacy Kill

* 更新 .025 新增的 unit/integration/E2E fixtures 到唯一新 schema。
* 新增 destructive rejection、三 token、index/event、key/value、autosize/manual resize assertions。
* package.json 和 justfile 新增 test-026；不保留 test 中“旧语法仍可执行”的口径。
* 搜索生产代码和 current docs 中的 items:string[]、{{text}}、entry-list、Convert/migration/alias。

Gate：

* just test-026。
* just check。
* just test-unit。
* git diff --check。
* 无 .orig/.rej 或临时 patch artifact。

## Phase 5: Review And Current Docs

* AI pre/post review 按 P1/P2/P3 分级；可直接修的问题在本 change 收口。
* 只在实现与自动 Gate 通过后同步 macro_template_contract、run_log_contract 相关段落和 quickstart。
* 更新 task index 状态与 04_review 最终证据；.025 snapshot 永不回写。
* 未解决 P1/P2 时不得 Close Gate。

## 实现限制

* 不新增 schemaVersion 或兼容 parser。
* 不新增 entry-list；唯一 list mode 仍是 text-list。
* 不把 key/value 写进 executionPath、step identity 或 run JSONL。
* 不以 sequential replace 实现 renderer。
* 不用 localStorage/JSON 保存 textarea manual height。
* 不把 adaptive behavior 泛化到矩阵外的 Prompt Body、TextBoxSlot 或单行配置输入。
