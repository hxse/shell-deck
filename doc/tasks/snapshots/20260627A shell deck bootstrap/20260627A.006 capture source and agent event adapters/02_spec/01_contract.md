# Contract

## 任务边界

本任务实现真实 capture source。完成后，macro runner 可以按模板选择 `terminal-buffer` 或 `agent-event`，生成 capture artifact 并写入 run event log。parser 仍可用 mock/stub，真实 parser 在 `.007` 实现。

Capture source 是用户显式选择的输入来源。runner 不根据 terminal 内是否运行 Codex 自动选择 source，也不替用户判断 terminal-buffer 或 agent-event 哪个更正确。

范围内：

* `terminal-buffer` source。
* `agent-event` source。
* Codex Stop hook adapter。
* local-only AgentEvent ingest。
* capture artifact 写入。
* config/terminal/session metadata 校验。

范围外：

* 不实现 parser 模型调用。
* 不实现 parser replicas。
* 不把 hook 当后台 loop。

## 任务规范

### terminal-buffer source

`terminal-buffer` 是 UI 默认 source。它从 resolved terminal 的 replay、scrollback 或 screen buffer 截取原始 TUI 文本，至少支持：

* `mode=scrollback-tail`
* `maxChars`
* raw artifact ref
* normalized text artifact ref

它最灵活，可以用于任何 shell、TUI 或 agent，但可能包含 ANSI、局部重绘、折行、进度态和截断。event log 必须记录 source kind、capture mode、terminal id 和 artifact refs。

### AgentEvent ingest

agent callback 必须归一化成统一 `AgentEvent`：

```json
{
  "protocolVersion": 1,
  "agentKind": "codex",
  "eventKind": "agent.output",
  "configId": "local",
  "terminalId": "term_7k3p9d",
  "launchId": "launch_...",
  "agentSessionId": "codex-session-id",
  "agentTurnId": "codex-turn-id",
  "adapterMetadata": {
    "adapter": "codex-stop-hook",
    "codexSessionId": "codex-session-id"
  },
  "capturedText": "latest assistant message",
  "raw": {
    "source": "codex.stop",
    "payloadRef": "artifacts/raw-hook-0001.json"
  }
}
```

V0 主传输是 local-only HTTP：`POST $SHELL_DECK_INGEST_URL`，地址必须绑定 `127.0.0.1`，并通过 `SHELL_DECK_INGEST_TOKEN` 鉴权。server 不在线时，adapter 可以 append 到 `.shell-deck/configs/<config-id>/agent-events/*.jsonl`，server 恢复后导入。

### Codex adapter

Codex hook 原生通信不是 HTTP。Codex 启动本地 command，把 hook payload JSON 写入 `stdin`；hook 通过 `stdout` JSON 和 exit code 返回给 Codex。shell-deck 的 Codex adapter 只做：

1. 读取 hook stdin。
2. 读取 `SHELL_DECK_CONFIG_ID`、`SHELL_DECK_TERMINAL_ID`、`SHELL_DECK_LAUNCH_ID`、`SHELL_DECK_INGEST_URL`、`SHELL_DECK_INGEST_TOKEN`。
3. 把 `session_id` 写入 `agentSessionId` 和 `adapterMetadata.codexSessionId`。
4. 把 `last_assistant_message` 写为 capture artifact。
5. 向 Codex 返回最小合法 JSON，例如 `{ "continue": true }`。

adapter 不能返回 `decision: block` 来续跑 Codex，不能承担 loop 控制权。

## 示例

```text
1. runner 选择 source=reviewAgent kind=agent-event。
2. Codex Stop hook 触发。
3. adapter 收到 session_id=s1, last_assistant_message="..."。
4. adapter POST AgentEvent 到 local ingest endpoint。
5. server 写 raw event artifact 和 capture artifact。
6. runner 捕获 capture_artifact_created，后续 parse step 可以读取该 artifact。
```

## 测试

本任务验证真实 capture source 能按用户选择产出 artifact。online Codex smoke 必须单独运行。

自动化测试至少覆盖：

* unit：terminal-buffer capture writes raw and normalized capture artifacts。
* unit：AgentEvent ingest token validation。
* unit：JSONL spool import。
* unit：Codex Stop hook payload normalization to AgentEvent。
* unit：Codex `session_id` 被写入 `agentSessionId` 和 `adapterMetadata.codexSessionId`。
* unit：不同 config 下同名 terminal index 不会匹配同一 AgentEvent。
* integration：mock AgentEvent 驱动 capture artifact。
* e2e：terminal-buffer source 生成 capture artifact，event log 记录 source kind、terminal id 和 artifact refs。
* e2e：可选 AgentEvent/Codex hook capture flow，确认 `codexSessionId` 可追溯。

人工 smoke 建议覆盖；V0 可以延后到整体验收时统一执行，不阻塞 offline Close Gate：

* 人工选择 `terminal-buffer` source，确认 UI 明确显示当前 source，并能看到 raw/normalized artifact。
* 人工选择 `agent-event` source；具备 Codex auth/network 时通过 shell-deck `justfile` 的 `codex` recipe 启动 Codex，确认 Stop hook capture。
* 人工确认系统没有因为 terminal 里像 Codex 就自动切换 source。
* online 不可用时记录 blocked reason，不阻塞 offline Close Gate。

Gate 规则：

* `just check`、`just test-unit`、`just test-e2e`、`just test-006-offline` 必须通过。
* `just test-006-online` 在具备 Codex auth/network 时通过；若外部不可用，必须记录 blocked reason 和最近一次 `.001` 兼容结论。
* 人工 smoke 若执行，结果写入 review/verification；未执行时记录 skipped reason，不阻塞 offline Close Gate。
