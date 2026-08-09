# Capture Ingest Contract

Live ingest 的唯一入口为 `POST /api/rooms/:roomId/agent-events`。server 每次启动生成 memory-only ingest token，并只向自己创建的 Shell 注入 ingest URL/token、server/Room generation、terminalId 与 launchId。

request body 不能覆盖 path roomId。server 验证 token、当前 Room generation 以及 terminalId/launchId membership，再补 generated eventId、serverInstanceId 与 receivedAt，并追加到 User Data Root 的 Room-scoped evidence。不同 Room、generation、terminal 或 launch 的事件不能被消费。

`just codex` 只允许在具有完整注入 context 的 shell-deck Shell 内启动。跨checkout的canonical入口是`just -f "$SHELL_DECK_JUSTFILE" codex`：recipe用Just的`invocation_directory()`冻结调用目录，wrapper把该目录同时设为Codex child的cwd与`PWD`，并原样透传Codex CLI参数；显式`-C/--cd`仍由Codex按原生语义处理。普通外部 terminal 在启动 Codex 前以 `shell_deck_room_context_required` fail loudly；不存在 manual id、global ingest、disk spool/import、unbound evidence 或旧 config fallback。

root和Parallel的Codex AgentEvent Capture editor都显示32px单行command bar：`Codex` badge、可横向滚动并手工选择的上述exact command，以及`Copy`按钮。命令与按钮使用daisyUI tooltip分别解释selected Shell/workspace语义与copy action；clipboard成功显示`Copied`，失败时才在下一行显示manual-copy提示。UI不读取server absolute checkout path、不自动启动Codex，也不修改Send或terminal内容。

Macro `capture-source`只能消费与frozen run snapshot的serverInstanceId、roomId、roomGeneration、terminalId和launchId全部匹配的live evidence。Start先为每个capture step记录matching baseline，后续只消费baseline之后且尚未被同一run消费的event；`prompt_and_result`还要求相同agent session/turn配对。等待过程服从同一live Pause/Stop状态。

AgentEvent Capture必须显式保存`waitLimit`。`{kind:"unbounded"}`无限等待匹配结果，直到成功、用户Stop、Room/launch失效、server restart或matching `agent.error`；不存在隐藏server timeout。`{kind:"timeout",timeoutMs}`只计算active waiting time，Pause期间冻结，超时以`agent_event_capture_timeout:<terminalId>` fail loudly。matching hook error以`agent_event_hook_error:<terminalId>`立即失败。迟到event只保留为evidence，不复活终态run；下一次Start的baseline必须忽略它。

每份current Room/generation使用`agent-events/<server>/<room>/<generation>/`下编号JSONL segment；最多一个`.open.jsonl`，默认8 MiB target，line不拆分。每条line都让统一GC lock覆盖quota admission、必要rotation与durable append；既有open segment不能绕过quota继续增长。current非空segment无法容纳下一line时在同一admission内关闭旧segment并建立下一open segment。Room Destroy与normal server stop在open filename仍受保护时先把mtime更新为close time，再atomic rename为closed segment；GC按close mtime只删除closed segment，crash遗留open保持受保护。旧`<generation>.jsonl` flat layout以`legacy_agent_event_log_unsupported`失败，不迁移或dual-read。

同一stream在本进程第一次访问时按segment number完整读取、解析并严格验证一次，随后由同一store维护eventId、terminal/launch、agent/event kind与adapter索引。append以Set做duplicate ID检查，按complete line append → file fsync → 首次创建时parent fsync → publish in-memory index/version的顺序提交；durability失败不能让waiter观察到event。Capture等待store version notification，新append立即唤醒；100ms heartbeat只检查Pause/abort/active timeout，version未变化时不重扫index或日志。

成功capture写入run artifact与`artifact_created` evidence，但AgentEvent、artifact和Trace永不用于恢复Room或runner。server restart、Room generation或launch变化后，旧event不能满足新run capture。

## Structured JSON submission

structured结果使用同一memory-only ingest token与terminal runtime identity，但走专用`POST /api/rooms/:roomId/structured-results`。Shell同时注入`SHELL_DECK_SUBMIT_JSON_URL`与当前checkout canonical absolute `SHELL_DECK_JUSTFILE`；terminal内程序以`just -f "$SHELL_DECK_JUSTFILE" submit-json`从stdin读取一个JSON value。recipe不接受Room、terminal、step或token参数，缺完整runtime context以`structured_json_room_context_required`失败，非法stdin以`structured_json_invalid_json`失败。

body exact包含`protocolVersion:1`、roomGeneration、terminalId、launchId与value。server依次验证token、exact body、path Room active、terminal launch membership、matching active waiter和Capture冻结的JSON Schema。token错误返回`structured_json_ingest_token_invalid`，malformed/non-exact body返回`structured_json_submission_invalid`；body通过后，malformed path、inactive Room或runtime identity不匹配统一返回`structured_json_runtime_membership_mismatch`，其余等待/校验错误返回`structured_json_capture_not_waiting`或带确定性issues的`structured_json_schema_mismatch`；失败提交不消费waiter。

structured Capture只允许root Flow，并只产生typed `captured_json`。schema采用JSON Schema 2020-12、每次validation独立编译；真正subschema object的`$ref`/`$dynamicRef`只解析以`#`开头的local fragment且不联网，property/map key与instance data中的同名字段不当作keyword。第一份合法提交原子消费当前terminal唯一waiter；Pause可接受并保留结果但Resume后才推进，Stop/Destroy/restart清除，timeout只计算active time。不同Room/generation/terminal/launch的提交不能交叉消费。
