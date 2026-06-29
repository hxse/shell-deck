# Result

## 变更概括

`.001` 已落地为可运行 API probe，而不只是文档蓝图。新增 `justfile` 入口、Bun test 配置、offline fake terminal / fake hook harness，以及 online Codex hook probe。

## 测试入口

* `just test-001-offline`：离线测试，不访问网络，不调用真实 Codex 模型。覆盖 fake terminal deck API、multi-client sync、config isolation、reset transaction、terminal-buffer capture、fake Codex hook normalization 和 JSONL spool 语义。
* `just test-001-online`：在线测试，调用真实 Codex CLI。覆盖 shell-deck `codex` just recipe、临时 hook 注入、真实 SessionStart / Stop hook payload、`last_assistant_message`、`agentSessionId` 和 `adapterMetadata.codexSessionId`。
* `just test-001`：安全别名，只跑 offline。

## 已实现文件

* `justfile`
* `package.json`
* `src/probe001/agentEvent.ts`
* `src/probe001/terminalDeck.ts`
* `tests/001-offline.test.ts`
* `scripts/shell-deck-codex.ts`
* `scripts/shell-deck-hook.ts`
* `scripts/probe-001-online.ts`

## 设计结论

* offline API baseline 可用，可以作为 `.002 terminal deck foundation` 的输入。
* 真实 Codex hook 注入可用，Stop hook 能提供 `last_assistant_message`，可以作为 `.006 capture source and agent event adapters` 的输入。
* Codex `session_id` 已能同时进入通用 `agentSessionId` 和 Codex 专用 `adapterMetadata.codexSessionId`。
* `just` variadic 参数对“带空格的单个 prompt”不保真；online probe 改用 `codex exec -` 从 stdin 传 prompt。后续对外文档应建议带空格 prompt 使用 stdin 或后续 argfile/json 参数通道。

## 未收口

* offline terminal deck 仍是 probe harness，不是真实 PTY 实现；真实 PTY 留给 `.002`。
* online probe 当前只验证真实 Codex hook capture，不验证 HTTP ingest server；HTTP ingest 由 `.006` 实现。
