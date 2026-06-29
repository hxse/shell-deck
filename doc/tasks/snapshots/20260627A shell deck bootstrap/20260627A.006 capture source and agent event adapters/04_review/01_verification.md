# Verification

## 结论

`.006 capture source and agent event adapters` offline Gate 通过。

本轮实现了：

* `terminal-buffer` capture：从 resolved terminal replay 截取 raw text，生成 raw / normalized artifacts，并记录 `capture_artifact_created`。
* `agent-event` capture：从 config-scoped `AgentEventStore` 读取匹配 Codex output，生成 raw event artifact 和 captured text artifact。
* local-only `POST /api/agent-events` ingest：校验 `127.0.0.1` bind、`SHELL_DECK_INGEST_TOKEN`、schema、config/terminal scope。
* real terminal env 注入：浏览器创建的 shell 会获得 `SHELL_DECK_CONFIG_ID`、`SHELL_DECK_TERMINAL_ID`、`SHELL_DECK_LAUNCH_ID`、`SHELL_DECK_DATA_ROOT`、`SHELL_DECK_INGEST_URL`。
* JSONL spool 恢复：hook 先写 `.writing-*` 临时文件，fsync/close 后 rename 成最终 `spool-*.jsonl`；runner capture 前会导入 spool；server 也提供 `POST /api/configs/<config-id>/agent-events/import-spool`。
* agent-event next matching：wait 会记录 baseline，capture 只消费 baseline 之后的下一条匹配 AgentEvent，避免循环复用旧 Codex Stop event。
* Run Log artifact preview：节点日志中的 artifact ref 可点击查看内容。
* Codex Stop hook adapter：读取 hook stdin/env，归一化 `session_id` 到 `agentSessionId` 和 `adapterMetadata.codexSessionId`，返回 `{ "continue": true }`。
* JSONL spool：server 不在线或未配置 ingest 时，hook 写入 `.shell-deck/configs/<config-id>/agent-events/spool-*.jsonl`，store 可导入为 append-only events。

## Automated Gate

已通过：

```bash
just check
just test-006-offline
just test-unit
just test-e2e
git diff --check
```

本轮新增/覆盖：

* unit：terminal-buffer raw/normalized capture。
* unit：AgentEvent ingest token/local-bind/terminal scope validation。
* unit：JSONL spool import，且 importer 忽略 `.writing-*` 半成品文件。
* unit：Codex Stop hook normalization 和 codexSessionId mirror。
* unit：不同 config 下同名 terminal id 的 AgentEvent 不串。
* unit：backend options 注入当前 terminal/config/launch env。
* integration：mock AgentEvent 驱动 agent-event capture artifact。
* integration：runner capture 前导入 JSONL spool。
* integration：HTTP spool import endpoint。
* integration：HTTP AgentEvent ingest 进入 server-owned runner capture。
* e2e：terminal-buffer capture flow 记录 source kind、terminal id 和 artifact refs。
* e2e：Run Log artifact preview 可展开 artifact 内容。

## Online / Manual

`just test-006-online` 未执行。

原因：该 recipe 需要真实 Codex CLI、auth/network/model quota；本阶段只关闭 offline Gate。`test:006:online` 已改为 `scripts/probe-006-online.ts`，会按当前 hook/spool/store 路径验证 `.006`，并显式清空 inherited `SHELL_DECK_INGEST_URL` / `SHELL_DECK_INGEST_TOKEN`，不再复用 `.001` 的旧 `events.jsonl` 假设。最近 `.001` offline probe 仍在 `just test-unit` 中通过，说明 hook 参数注入 baseline 没有被本轮破坏。

人工 smoke 未执行。

原因：当前阶段按用户要求先集中跑自动化测试；manual smoke 延后到 V0 整体验收时统一执行。未执行不阻塞 `.006` offline Close Gate。
