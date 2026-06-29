# Execution Plan

## 模块边界

本任务实现真实 capture source 和 AgentEvent adapter，不实现 parser。建议模块边界：

```text
src/lib/capture/captureSourceTypes.ts
src/lib/capture/terminalBufferCapture.ts
src/lib/capture/agentEventCapture.ts
src/lib/agentEvents/agentEventTypes.ts
src/lib/agentEvents/agentEventStore.ts
src/lib/agentEvents/agentEventIngestClient.ts
server/agentEventIngest.ts
server/codexHookAdapter.ts
server/captureArtifactStore.ts
scripts/shell-deck-hook.ts
scripts/shell-deck-codex.ts
tests/unit/terminalBufferCapture.test.ts
tests/unit/agentEventIngest.test.ts
tests/unit/codexHookAdapter.test.ts
tests/integration/agentEventCapture.test.ts
tests/e2e/captureSourceFlow.spec.ts
```

`.001` 的 hook scripts 可以作为 probe 参考，但 `.006` 需要把它们收束成正式 adapter，字段兼容 `.001` 已通过的 AgentEvent shape。

## 阶段

1. 定义正式 `AgentEvent`、`CaptureSource`、`CaptureArtifact` 类型和 JSON Schema。
2. 实现 terminal-buffer capture：从 resolved terminal replay/screen/scrollback 获取 raw text，写 raw/normalized artifacts，记录 truncation/ANSI metadata。
3. 实现 local-only `POST /api/agent-events`，绑定 `127.0.0.1`，校验 `SHELL_DECK_INGEST_TOKEN`，拒绝跨 config/terminal mismatch。
4. 实现 AgentEvent store：append-only JSONL、latest cache、config isolation、import spool。
5. 实现 Codex hook adapter：读取 hook stdin，读取 `SHELL_DECK_*` env，归一化 SessionStart/Stop，写 `agentSessionId` 和 `adapterMetadata.codexSessionId`，返回 `{ "continue": true }`。
6. 实现 `agent-event` capture source：按 configId/terminalId/agentKind/eventKind/adapter 等待或读取下一条匹配事件，写 capture artifact。
7. 接入 `.005` runner 的 capture-source step，但 parser 仍使用 mock/stub。
8. 补 unit/integration/e2e，并重跑 `.001` online probe 或同等 Codex hook smoke，确认真实 CLI 仍兼容。

## 验证命令

```bash
just check
just test-unit
just test-e2e
just test-006-offline
just test-006-online
```

`test-006-online` 必须单独 recipe，允许调用真实 Codex CLI；默认 `just test` 不应隐式消耗模型额度。

## Legacy Kill List

本任务不得引入：

* hook-driven background loop。
* Codex-specific branch condition。
* Codex session binding 到 macro template。
* 把 parser 判断混进 capture adapter。
* 把 terminal-buffer 解析成业务结论；它只能产出 artifact。

## 阶段停止线

进入 `.007` 前必须满足：

* terminal-buffer 和 agent-event 都能生成 capture artifact，且 artifact ref 写入同一份 run event log。
* Codex Stop hook 能提供 `last_assistant_message`，并归一化为 `eventKind=agent.output`。
* `agentSessionId` 与 `adapterMetadata.codexSessionId` 同时存在。
* ingest 缺 token / 错 token / 跨 config / 未知 terminal 全部 fail closed。
* server 不在线时 JSONL spool 可导入，不成为第二份真值。

## Close Gate

* `just check`、`just test-unit`、`just test-e2e`、`just test-006-offline` 通过。
* `just test-006-online` 在具备 Codex auth/network 时通过；若外部不可用，必须记录 blocked reason 和最近一次 `.001` 兼容结论。
* 默认 terminal-buffer source 可用。
* Codex hook adapter 能上报 terminalId、agentSessionId、codexSessionId。
* 所有 capture 都写 artifact 并进入同一份 event log。
* 人工 smoke 覆盖用户显式选择 `terminal-buffer` / `agent-event`，确认系统不自动切 source；若本阶段未执行，写入 skipped reason，不阻塞 offline Close Gate。
* `git diff --check` 通过。
