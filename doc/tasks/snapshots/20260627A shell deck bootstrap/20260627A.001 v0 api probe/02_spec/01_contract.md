# Contract

## 任务边界

本任务做 V0 API 风险探测，不交付完整 UI。探测分两条线：一是 `just codex` recipe + Codex hook + `AgentEvent Ingest`；二是参考 `orch-web` 已验证的 terminal API 行为，冻结 shell-deck 后续子任务要继承的 terminal deck API 蓝图。完成后，项目必须知道 hook、AgentEvent、terminal identity、multi-tab sync、PTY input/resize/replay、config isolation 和 terminal-buffer capture 这些底层 API 是否可行。

范围内：

* `codex` just recipe probe。
* 临时 hook 注入方式 probe。
* Codex hook payload 到统一 `AgentEvent` 的 normalization probe。
* local `AgentEvent Ingest` transport probe。
* terminal env metadata probe，重点是 stable `terminalId`，不是动态序号。
* terminal deck API baseline probe：config、terminal、WebSocket subscribe、snapshot、`pty_output`、input、resize、reset、terminal-buffer capture。
* multi-client sync probe：同一 config/terminal 多 tab fan-out、late replay、默认无锁输入。
* config isolation probe：不同 config 的 terminal id、index map、event、replay 不能串用。
* PTY input latency probe：参考 `orch-web` `.012`，默认采用 helper stdin pipe 控制通道，不把 command-file polling 当主输入路径。
* required Codex `session_id` 上报 probe：归一化为 `agentSessionId`，并保留 `adapterMetadata.codexSessionId`。
* 形成明确 go/no-go 结论和后续 contract 更新建议。

范围外：

* 不安装全局 `sdcodex` 或其它全局 CLI。
* 不实现 parser prompt/profile。
* 不实现 macro UI。
* 不做 Codex session 自动恢复。
* 不测试 terminal 位置变化是否改变环境变量；hook 主 contract 只依赖 stable terminal id。
* 不迁移 `orch-web` 的 role、role_call、validator-call、caller proof、safeToSend 或后台 role orchestration。

## 任务规范

### just codex recipe

V0 不安装全局 `sdcodex`，也不要求用户直接运行普通 `codex` 来参与 hook capture。所有 shell-deck 项目命令入口都必须走 `justfile`。用户在目标项目目录中调用 shell-deck 的 justfile：

```bash
cd /path/to/target-project
just -f <shell-deck-root>/justfile -- codex [codex args...]
just -f <shell-deck-root>/justfile -- codex resume --last
just -f <shell-deck-root>/justfile -- codex --model gpt-5.3-codex-spark
```

`--` 必须放在 recipe 名 `codex` 之前，用来结束 `just` 自己的参数解析，避免 `--model`、`--config`、`--sandbox` 等 Codex 参数被 `just` 当成自己的选项。

`codex` recipe 是 V0 的 Codex 启动入口。recipe 必须透传所有 recipe 参数给真实 `codex`，不能改变 Codex 默认 prompt、model、sandbox、approval 等语义。recipe 只负责注入 shell-deck hook 和必要 env metadata。

recipe 必须注入 shell-deck hook，但不能修改用户全局 `~/.codex/config.toml`，不能安装全局可执行文件，不能要求目标项目复制脚本。优先验证 recipe 内部调用：

```bash
codex -c "features.hooks=true" -c "<hooks config>=..." "$@"
```

如果复杂 hook 数组无法稳定通过 `-c` 表达，则允许使用 shell-deck 管理的临时 profile 文件，但 profile 必须可清理、namespaced，且不能改变普通 `codex` 调用行为。

### Hook events

本任务至少验证两个 Codex hook，并把它们归一化为统一 `AgentEvent`：

* `SessionStart`：读取 `session_id`、`source`、`cwd`、`model`，并结合 `configId`、`terminalId`、`launchId` 上报 `eventKind=agent.session_started`。`session_id` 必须归一化为 `agentSessionId`，并在 adapter metadata 中保留 `codexSessionId`。
* `Stop`：读取 `session_id`、`turn_id`、`last_assistant_message`、`transcript_path`、`cwd`、`model`，并结合 `configId`、`terminalId`、`launchId` 上报 `eventKind=agent.output`。`session_id` 必须归一化为 `agentSessionId`，并在 adapter metadata 中保留 `codexSessionId`。

Stop hook 只采集输出，不返回 `decision: block`，不要求 Codex 继续，不承担 loop 控制权。

### AgentEvent Ingest protocol

Codex hook 原生通信不是 HTTP。Codex 在 hook event 触发时启动本地 command，把 hook payload JSON 写入 hook 进程 `stdin`；hook 通过 `stdout` JSON 和 exit code 把控制结果返回给 Codex。`just codex` recipe 注入的 hook command 只做 adapter：读取 `stdin`、读取 shell-deck env、归一化为 `AgentEvent`，再上报给 shell-deck server。

V0 主传输是 local-only HTTP：`POST $SHELL_DECK_INGEST_URL`，地址必须绑定 `127.0.0.1`，并通过 `SHELL_DECK_INGEST_TOKEN` 鉴权。server 不在线时允许 append 到 `.shell-deck/configs/<config-id>/agent-events/*.jsonl` 作为 spool，server 恢复后导入。JSONL spool 是恢复通道，不是主链路。

统一 `AgentEvent` 最小形态：

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
  },
  "receivedAt": "2026-06-27T00:00:00.000Z"
}
```

`eventKind` 必须使用 shell-deck 语义，例如 `agent.session_started`、`agent.output`、`agent.error`。Codex 的 `Stop`、`SessionStart` 等原始事件名只能放在 `raw.source` 或 adapter metadata 里，不能泄漏成 macro runner 的分支条件。hook command 成功上报后，应向 Codex 返回最小合法 JSON，例如 `{ "continue": true }`，不能用 `decision: block` 续跑 Codex。

### Terminal metadata

shell-deck 启动 PTY 或 `codex` recipe 前，需要注入环境变量：

```bash
SHELL_DECK_CONFIG_ID=local
SHELL_DECK_TERMINAL_ID=term_7k3p9d
SHELL_DECK_LAUNCH_ID=launch_...
SHELL_DECK_INGEST_URL=http://127.0.0.1:PORT/api/agent-events
SHELL_DECK_INGEST_TOKEN=...
```

`SHELL_DECK_TERMINAL_INDEX` 可以为了调试附带，但 hook 主 contract 不依赖它。terminal 移动位置或重排序时，`terminalId` 不变；server 负责实时维护当前 config 下的 `terminalIndex -> terminalId` 映射。

hook command 必须把这些 env 和 Codex hook stdin payload 合并成上一节定义的 `AgentEvent`。`SHELL_DECK_TERMINAL_ID` 由 server 用 `short-uuid` 生成，形如 `term_<shortUuid>`。`SessionStart` 归一化为 `eventKind=agent.session_started`，`Stop` 归一化为 `eventKind=agent.output`，Codex 原始 `hook_event_name`、`session_id`、`turn_id`、`transcript_path` 等字段保存到 `raw` 或 adapter metadata，其中 `session_id` 同时必须进入通用 `agentSessionId` 和 Codex 专用 `adapterMetadata.codexSessionId`。长文本可以随 HTTP payload 以内联 `capturedText` 上报，server 收到后再写 artifact 并在 run event 中保存 artifact ref。

### Mapping rule

本任务的 mapping 要求被简化为：hook adapter 只上报 stable `terminalId`，不需要知道当前 terminal 序号。server 在同一 `configId` 内实时维护：

```json
{
  "configId": "local",
  "terminalIndexMap": {
    "1": "term_a1b2c3",
    "2": "term_7k3p9d"
  }
}
```

macro run 如果指定 index `2`，runner 在开始 step 或等待 `AgentEvent` 前解析为当前 `terminalId=term_7k3p9d`。adapter 上报的 `AgentEvent` 只要包含同一个 `terminalId`，就能匹配。terminal 位置怎么移动都不会改变 hook env 中的 stable id。

### Orch-web API reference

`.001` 必须把 `orch-web` 已经测通过的底层 API 经验转成 shell-deck 的 probe case，但不能复制 `orch-web` 的 role 方向。

可参考并重新验证的结论：

* `orch-web/src/lib/protocol.ts` 已验证过 WebSocket 消息边界：client 发送 `terminal_input` / `terminal_resize`，server 广播 `role_snapshot` / `pty_output` / state。shell-deck 要把 role 维度替换为 `configId + terminalId`。
* `orch-web/tests/unit/terminalManager.test.ts` 已覆盖同一 session 多客户端 fan-out、默认无锁输入、late replay、input owner 可选互斥、reset 失败不破坏旧 session、reset 成功发送 fresh snapshot。shell-deck `.001` 需要用 terminalId 版本重测这些行为。
* `orch-web/tests/e2e/app.spec.ts` 已覆盖两个浏览器页面同步 fake PTY / real shell PTY 输出，以及 late replay。shell-deck `.001` 需要冻结同等 e2e smoke 的 API 预期，具体 UI 可留给 `.002`。
* `orch-web` task `20260616A.012 terminal input latency stabilization` 已验证 real PTY 控制通道应使用 helper stdin pipe，并保留 command-file 仅作兼容路径。shell-deck 从第一版 terminal API 起就采用这个方向。
* `orch-web` hook lifecycle 证明 Codex Stop hook 可以作为 completion evidence，但 shell-deck 只吸收 hook event capture 和 append-only evidence 思路，不吸收 role wait/collect policy。

明确不复用：

* 不复用 role、role catalog、role_call、validator-call、caller proof、`canSendNext` / `safeToSend` 作为 shell-deck 核心对象。
* 不复用 sealed instruction workflow 作为 V0 macro runner 的必要前提。
* 不让 terminal API 承担后台 orchestration 判断；macro runner 后续只消费 terminal truth、AgentEvent 和 parser soft signals。

### Terminal deck API baseline

`.001` 需要冻结后续 `.002` 必须实现的 API 形状。字段可以在实现时微调，但语义不能反复摇摆。

HTTP baseline：

```text
GET  /api/configs
POST /api/configs
GET  /api/configs/<configId>/terminals
POST /api/configs/<configId>/terminals
POST /api/configs/<configId>/terminals/<terminalId>/reset
POST /api/configs/<configId>/terminals/<terminalId>/capture-buffer
POST /api/agent-events
```

WebSocket baseline：

```text
/ws/configs/<configId>
```

Client messages：

```json
{ "type": "subscribe_terminal", "terminalId": "term_7k3p9d" }
{ "type": "terminal_input", "terminalId": "term_7k3p9d", "data": "echo hi\r" }
{ "type": "terminal_resize", "terminalId": "term_7k3p9d", "cols": 120, "rows": 30 }
{ "type": "capture_terminal_buffer", "terminalId": "term_7k3p9d", "requestId": "cap_1" }
```

Server messages：

```json
{ "type": "terminal_snapshot", "configId": "local", "terminalId": "term_7k3p9d", "terminalIndex": 2, "replay": [], "status": "running" }
{ "type": "pty_output", "configId": "local", "terminalId": "term_7k3p9d", "data": "...", "source": "pty" }
{ "type": "terminal_state", "configId": "local", "terminalId": "term_7k3p9d", "status": "closed", "exitCode": 0, "signal": null }
{ "type": "terminal_index_map", "configId": "local", "items": [{ "index": 2, "terminalId": "term_7k3p9d" }] }
{ "type": "capture_terminal_buffer_result", "requestId": "cap_1", "artifactRef": "artifacts/capture/cap_1.txt" }
```

API 硬要求：

* 后端拥有 PTY 真值。前端 xterm 只显示 `pty_output` / replay，不做默认 local echo。
* `terminal_input`、macro send、future command adapter 都必须写入后端 PTY，不允许前端直接 `terminal.write()` 伪造输出。
* 同一 `configId + terminalId` 的所有 tab 共享 replay 和实时 output；不同 `configId` 必须隔离。
* `terminalIndex` 只是当前 config 内的动态选择器，所有 API 主键都使用 stable `terminalId`。
* reset 必须是事务边界：新 PTY 启动失败时保留旧 terminal，不清空旧 replay，不断开已有订阅。
* real PTY 控制命令默认走 helper stdin pipe；command-file polling 不能成为 V0 主输入路径。
* 大段 paste 必须分块或使用 framing，不能被 helper 单行 buffer 截断。
* `capture_terminal_buffer` 只返回原始 terminal-buffer artifact，不解释内容；解释交给 `.007` parser。

### API Probe Matrix

`.001` Close Gate 必须给出每个 probe 的 pass/fail、证据路径和对后续任务的影响。

| 编号 | Probe | 目的 | 后续依赖 |
| --- | --- | --- | --- |
| A01 | `just -f ... -- codex --help` 参数透传 | 证明 just recipe 不破坏 Codex CLI | `.006` Codex adapter |
| A02 | 临时 `-c/--config` 注入 hooks | 证明不污染 `~/.codex/config.toml` | `.006` Codex adapter |
| A03 | SessionStart hook payload | 读取 `session_id` / `cwd` / `model` / env metadata | `.006` AgentEvent |
| A04 | Stop hook payload | 读取 `last_assistant_message` / `turn_id` / `session_id` | `.006` AgentEvent, `.007` parser |
| A05 | hook command -> local HTTP ingest | 验证 token、127.0.0.1、raw payload artifact | `.004` log, `.006` ingest |
| A06 | server offline JSONL spool | 验证 ingest 不在线时可恢复导入 | `.006` adapter |
| A07 | `agentSessionId` / `codexSessionId` 双写 | 现在可调试，未来可 session mapping | later session binding |
| T01 | create config + create terminal | 验证 `configId`、`terminalId`、`terminalIndex` 初始 map | `.002` terminal foundation |
| T02 | two WS clients subscribe same terminal | 验证 snapshot、fan-out、默认无锁输入 | `.002` multi-tab sync |
| T03 | late client replay | 验证 replay buffer 是后端真值 | `.002`, `.006` terminal-buffer capture |
| T04 | different config isolation | 验证 config A 的 index/id/event 不进入 config B | `.002`, `.004`, `.006` |
| T05 | `terminal_input` ordinary keys | 验证 Enter、Esc、Ctrl-C、paste 都走 PTY | `.002` terminal UX |
| T06 | long paste chunking | 验证不会超过 helper command buffer 被截断 | `.002` latency baseline |
| T07 | `terminal_resize` | 验证 resize 到达 PTY/helper 并广播 state | `.002` xterm fit |
| T08 | no local echo | 验证浏览器只显示 `pty_output`，避免双回显 | `.002` frontend |
| T09 | reset success/failure transaction | 验证失败保留旧 session，成功发 fresh snapshot | `.002` lifecycle |
| T10 | terminal-buffer capture artifact | 验证可从 replay/screen buffer 生成 raw artifact | `.006` capture source |
| T11 | index -> id remap | 验证移动 terminal 后 API 主键仍是原 id | `.002`, `.005` runner |
| T12 | `just codex` inside terminal inherits env | 验证 hook AgentEvent 能按 `terminalId` 归属 | `.006` adapter |


### Probe artifacts

本任务需要保留最小探测产物：

* `codex` just recipe 草案。
* terminal deck API baseline 草案。
* `AgentEvent Ingest` endpoint 草案。
* hook config 注入样例。
* hook stdin payload 样例。
* shell-deck `AgentEvent Ingest` 样例。
* terminal WebSocket message 样例。
* terminal-buffer capture artifact 样例。
* env 传递测试记录。
* API Probe Matrix 执行结果，标明 pass/fail/blocked 和后续 contract 影响。
* `orch-web` reference mapping：哪些 API 行为复用，哪些 role 相关行为明确不复用。

## 示例

```text
1. shell-deck terminal 2 当前映射到 term_7k3p9d。
2. terminal 环境注入 SHELL_DECK_CONFIG_ID=local 和 SHELL_DECK_TERMINAL_ID=term_7k3p9d。
3. 用户在目标项目目录运行 `just -f <shell-deck-root>/justfile -- codex resume --last`。
4. `codex` recipe 临时注入 SessionStart/Stop hook，并透传 `resume --last`。
5. SessionStart hook adapter 上报 `agent.session_started` AgentEvent，包含 config=local, terminalId=term_7k3p9d, agentSessionId=s1, codexSessionId=s1。
6. Codex 一轮停止后，Stop hook adapter 上报 `agent.output` AgentEvent，包含 last_assistant_message 和 terminalId=term_7k3p9d。
7. server 记录 term_7k3p9d -> agentSessionId s1 -> latest capture artifact。
8. 用户移动 terminal 位置后，adapter 仍上报 term_7k3p9d，server 只更新 index map。
```

## 测试

本任务是后续阶段的 API 基石。所有执行入口必须走 `justfile`，offline 与 online 必须分开：

```bash
just test-001-offline  # deterministic, no network, no real model
just test-001-online   # real Codex CLI, may use network/auth/model quota
just test-001          # alias for offline only
```

`codex exec` 的带空格 prompt 在 just variadic 中不保真，online probe 使用 `codex exec -` 从 stdin 传 prompt。后续用户文档也应建议复杂 prompt 使用 stdin 或单独 argfile/json 通道。

自动化测试至少覆盖：

* probe A01-A07：Codex just recipe、临时 hook 注入、SessionStart/Stop payload、`AgentEvent Ingest`、JSONL spool、`agentSessionId` 和 `codexSessionId` 上报。
* probe T01-T12：terminal deck API baseline，包括 create config/terminal、WebSocket subscribe、snapshot、`pty_output` fan-out、late replay、默认无锁输入、config isolation、input/resize、long paste、reset transaction、terminal-buffer capture、index->id remap 和 `just codex` env 继承。
* security：WebSocket 和 ingest 默认只绑定 `127.0.0.1`；需要 token 的入口必须拒绝缺失或错误 token。
* regression reference：把 `orch-web` 已验证 terminal API 行为映射到 shell-deck probe 结果，证明 role 相关 API 没有迁入 V0 核心。

人工 smoke / review 至少覆盖：

* 人工查看 offline probe 输出和 generated artifacts，确认 API Matrix 语义可读。
* 具备 Codex auth/network 时人工触发 `just test-001-online`，确认真实 Codex CLI 仍能返回 hook payload；不具备时记录 blocked reason。
* 人工确认 go/no-go 结论，明确 `.002/.006/.007` 后续任务必须采用的 protocol shape。

Gate 规则：

* `just test-001-offline` 必须通过，否则不能进入 `.002`。
* online probe 不进入默认测试；如果跳过，必须记录 blocked reason 和最近一次通过时间。
* 人工 review 记录未写入 `04_review` 时，不允许 Close Gate。
