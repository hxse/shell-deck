# Contract

## 任务边界

### Added Semantics

* AgentEvent Capture新增exact `waitLimit`分支。
* 默认创建为unbounded；visual editor可显式启用duration timeout。
* 新的hook error与timeout runtime错误明确区分。

### Frozen Semantics

* Room/server generation、terminalId/launchId、agent kind、adapter、session/turn、baseline与consumed event匹配冻结。
* `result_only`、`prompt_only`与`prompt_and_result`产物格式冻结。
* Pause/Stop/Destroy、run terminalization、artifact/evidence和For fail-fast冻结。
* Macro/Library saved-record、controller/content lease、Prepare与Start contract冻结。
* 除新增控件和V5文本外，Macro/Library UI不得漂移。

## 任务规范

### MacroDefinitionV5

```ts
type AgentEventWaitLimit =
  | { kind: "unbounded" }
  | { kind: "timeout"; timeoutMs: number }

type AgentEventCapture = {
  kind: "agent-event"
  terminal: MacroTerminalReference
  agent: { kind: "codex" }
  captureMode: "result_only" | "prompt_only" | "prompt_and_result"
  waitLimit: AgentEventWaitLimit
}
```

`timeoutMs`必须是positive finite integer。两个branch使用exact keys；`unbounded`不接受payload。字段只属于agent-event capture；terminal-buffer/text-box携带该字段必须失败。

唯一current root为`MacroDefinitionV5`和`schemaVersion:5`。V4、缺失`waitLimit`、`timeoutMs`裸字段、boolean开关及`null`均fail loudly；不读取、不转换、不自动补值。

### Visual editor

root Capture与Parallel lane Capture的Agent行增加`Enable timeout`checkbox：

* 新建或从其他capture kind切到agent-event：`{kind:"unbounded"}`。
* 未勾选：隐藏duration input，显示`Wait until result or Stop`。
* 勾选：原子切为`{kind:"timeout",timeoutMs:600000}`并显示duration输入。
* 取消勾选：原子切回exact unbounded branch，不保留隐藏timeout值。
* duration使用既有数字控件视觉语言，写入毫秒，拒绝非positive integer。
* root与Parallel lane使用同一专用wait-limit行：checkbox固定为14×14、零padding，与`Enable timeout`文字按中心线对齐；unbounded hint或`Timeout ms`数值控件占第二列。不得让checkbox继承普通text input的full-width、min-height或padding，也不得把该行交给通用`.macro-row`产生不同排版。

JSON editor、Library Macro JSON Validate/Save/Load只使用V5唯一gateway，不补`waitLimit`。

V5 hard cut后的saved-content isolation保持Macro与Library一致：Macro list忽略invalid MacroRecord/definition并返回diagnostic；Library `macro-template` list也必须忽略invalid LibraryItem envelope或无法通过唯一V5 text gateway的content，并返回stable `itemId/error` diagnostic供UI显示。被隔离项不得进入selector；直接read同一invalid Macro Library item必须fail loudly。Prompt/Note的任意text语义不受Macro validator影响。该规则不是旧schema reader或migration；一次性用户数据升级属于显式运维操作，production request path不得自动补字段。

### Runtime

unbounded Capture循环等待匹配event，不按elapsed time失败。它只被以下条件结束：

* 所需prompt/output到达并成功capture。
* 用户Stop或Room Destroy：现有`run_stopped`/Room终态。
* frozen terminal launch丢失：现有launch错误。
* baseline之后出现同一Room/terminal/launch的`agent.error`：`agent_event_hook_error:<terminalId>`。
* server restart：live run自然消失，不从evidence恢复。

timeout Capture只计算active waiting time。Run处于Paused时计时冻结；Resume后继续剩余时长。到期产生`agent_event_capture_timeout:<terminalId>`，随后按现有Action/For fail-fast形成唯一run_failed。迟到event仍保存在AgentEvent evidence，但不得复活run；新run baseline必须忽略它。

删除`SHELL_DECK_AGENT_EVENT_CAPTURE_TIMEOUT_MS`及`positiveTimeout` fallback。不得存在其他hidden maximum。

### 等待实现

V0允许保留现有abortable bounded-delay检查，但必须避免busy loop并保持Stop响应。若抽取进程内append waiter，不得改变persistent baseline或跨process/Room匹配；该优化不是本任务通过Gate的前提。

## 示例

### 默认无限等待

```json
{
  "kind": "agent-event",
  "terminal": { "kind": "terminal_index", "index": 1 },
  "agent": { "kind": "codex" },
  "captureMode": "result_only",
  "waitLimit": { "kind": "unbounded" }
}
```

### 显式30分钟

```json
"waitLimit": { "kind": "timeout", "timeoutMs": 1800000 }
```

### 非法

```json
"waitLimit": { "kind": "unbounded", "timeoutMs": 600000 }
```

## 测试

### Unit

* V5 exact waitLimit两branch通过；V4、missing、extra、boolean、zero/fraction/infinite拒绝。
* default root/lane AgentEvent Capture生成unbounded。
* JSON text gateway与runnable validation保持单一pipeline。

### Integration

* 使用短测试延迟证明unbounded越过旧10分钟逻辑的可注入等价边界，不依赖真实等待10分钟。
* 显式timeout产生stable error、零artifact并唯一run_failed。
* Pause期间timeout不推进，Resume后继续。
* Stop立即取消unbounded/timeout wait并释放structure lock。
* matching `agent.error`立即失败；旧baseline、其他Room/terminal/launch error不影响capture。
* late output不复活failed run，新run baseline不消费旧event。

### Browser E2E

* root与lane新增AgentEvent默认checkbox关闭、helper可见、JSON为unbounded。
* 勾选显示duration并写timeout branch；编辑值、取消后删除duration payload。
* root与lane timeout toggle的computed checkbox尺寸、padding和文字中心线一致，窄层级内不发生表单错位。
* Visual/JSON/Library V5 round-trip；V4 fail loudly。
* Macro与Library Macro JSON list都隔离invalid saved item、显示identity diagnostic，selector只含valid item；direct read/load继续fail loudly。
* 其他Capture kinds和现有Macro UI无漂移。

### Gate

运行`just check`、`just build`、Macro validation/editor unit、runner/AgentEvent integration、Macro/Library E2E、current comprehensive UI、`test-031b`和`git diff --check`。不得运行真实Codex或外部服务。
