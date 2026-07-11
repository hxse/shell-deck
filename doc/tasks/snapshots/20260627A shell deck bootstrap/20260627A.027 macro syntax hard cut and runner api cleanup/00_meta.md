# 20260627A.027 Macro Syntax Hard Cut And Runner API Cleanup

## 任务概括

把 Macro Flow V2 从“新 UI 写 canonical、底层仍读取旧形态”收口为唯一 current schema。Count loop 必须显式写 `kind: "count"`，TerminalRef 必须只有 `kind` / `value`，runner control API 也不再接受已经失效或被忽略的参数。

## 正式 task 级别及定级原因

三星任务。

本任务同时破坏性修改公开 Macro JSON、template validator/store/import、runner execution、Macro editor、runner HTTP request contract 和相关测试。旧写法若在任一入口继续静默通过，会形成 quietly wrong：文件看似有效、UI 能打开、runner 也能执行，但系统实际上仍维护两套 contract。因此必须用完整 Spec、Execution、Legacy Kill、AI pre/post-review 和 Close Gate 收口。

## 范围内

* `for.range` 的 count mode 唯一合法形态为 `{ kind: "count", count: positiveInt }`。
* 所有 Macro TerminalRef 严格只允许 `kind`、`value` 两个 own field。
* Template validator 只表达 current allowlist，删除旧 type/field/mode 的 production 专用识别分支。
* Store read/save/import、HTTP PUT/import 和 runner start 对退出的写法统一 fail loudly，不迁移、不重写。
* Runner 和 editor 删除 missing-kind、default-count、ignored resume 参数与 mock request 字段 fallback。
* Runner action HTTP body 按 action exact-key 校验，并区分 request syntax failure 与 runtime state conflict。
* 更新 unit/integration、focused just 入口、active spec、guide、task index 和最终 review evidence。

* `{ "count": 3 }` 不再合法；不得自动补成 `{ "kind": "count", "count": 3 }`。
* TerminalRef 的额外字段即使 runner 不使用也必须 validation fail，不得静默保存。
* `resume.nextStepId`、`start.mockCaptureText`、`start.mockCaptureReady` 和 runner action unknown fields 必须在 service dispatch 前失败。
* 不提供 migration、compatibility reader、alias、warning-only period、quarantine 或 Convert UI。
* 旧 local template 由用户自行删除或按 current schema 重写；本任务不扫描后自动改写用户数据。

## 范围外

* 不重命名 Macro JSON 的 `terminal` 字段；Target/Source/Lane tab 仍是 UI 语境，JSON 只有当前唯一的 `terminal` 字段。
* 不删除旧 run-event replay；run-log 是独立 append-only persistence contract，不是 Macro authoring syntax。
* 不修改 MacroExecutionCursor snapshot schema、terminal manager 内部 scalar-ref normalizer、parser profile compatibility check 或历史 task snapshot。
* 不改变 count/forever/text-list 的运行语义、pause/resume cursor、template token、message flow、tab capability 或 notification 行为。
