# Contract

## Scope

范围内：

* `just codex` recipe 保持 Codex child process 在用户调用目录运行。
* wrapper 必须把 shell-deck data root 显式传给 hook，避免 hook spool 写到目标项目目录。
* wrapper 注入 `SessionStart`、`UserPromptSubmit`、`Stop` 三类 Codex hooks。
* AgentEvent protocol 新增 `agent.prompt_submitted`，由 `UserPromptSubmit.prompt` 归一化而来。
* `agent.output` 仍由 `Stop.last_assistant_message` 归一化而来。
* `capture-source(agent-event)` 只支持 `captureMode`：
  * `result_only`
  * `prompt_only`
  * `prompt_and_result`
* `captureMode` 必填；旧 `eventKind` / `field` macro 字段非法。
* `prompt_and_result` 必须配对同一 `agentSessionId` 与同一 `agentTurnId` 的 prompt/output。
* run-start baseline 仍然生效：capture 不消费当前 run 开始前的历史事件。

范围外：

* 不读 `transcript_path` 指向的 Codex transcript。
* 不抓 TUI 屏幕文本来推断 Codex 语义。
* 不消费 `codex exec --json` event stream。
* 不捕获 hidden reasoning、tool calls、command execution details、file changes、MCP calls、web searches 或 plan updates。
* 不保留旧 `eventKind` / `field` macro template compatibility。

## JSON Schema

`result_only`：

```json
{
  "type": "capture-source",
  "capture": {
    "kind": "agent-event",
    "agent": { "kind": "codex" },
    "terminal": { "kind": "alias", "value": "reviewer" },
    "captureMode": "result_only"
  }
}
```

`prompt_only`：

```json
{
  "type": "capture-source",
  "capture": {
    "kind": "agent-event",
    "agent": { "kind": "codex" },
    "terminal": { "kind": "alias", "value": "reviewer" },
    "captureMode": "prompt_only"
  }
}
```

`prompt_and_result` 输出固定 sectioned text：

```text
===== user prompt =====
<PromptSubmit.prompt>

===== assistant result =====
<Stop.last_assistant_message>
```

非法旧写法：

```json
{
  "kind": "agent-event",
  "agent": { "kind": "codex" },
  "terminal": { "kind": "alias", "value": "reviewer" },
  "eventKind": "stop",
  "field": "last_assistant_message"
}
```

必须报 `invalid_macro_template`，不迁移、不静默忽略。

## Event Model

Supported normalized event kinds:

* `agent.session_started`
* `agent.prompt_submitted`
* `agent.output`
* `agent.error`

Adapters:

* `codex-session-start-hook`
* `codex-user-prompt-submit-hook`
* `codex-stop-hook`
* `codex-hook-error`

`agent.prompt_submitted` and `agent.output` must have `agentTurnId` and `capturedText`.

## Gate

Required automated gate:

* `just check`
* `just test-unit`
* `just test-e2e`
* `just test-019`
* `git diff --check`
