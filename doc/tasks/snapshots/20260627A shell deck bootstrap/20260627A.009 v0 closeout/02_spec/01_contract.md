# Contract

## 任务边界

本任务只做 V0 收口。完成后，文档、quickstart、active specs、测试和实际行为必须一致。若发现核心功能缺口，应回到对应子任务修复，而不是在 closeout 中新增大块实现。

范围内：

* quickstart。
* active specs sync。
* V0 e2e verification。
* review report。
* known limitations。

范围外：

* 不新增 terminal/capture/parser/runner 的核心设计。
* 不实现访问控制。
* 不实现 session binding。

## 任务规范

### V0 acceptance flow

V0 验收必须覆盖：

1. 启动 shell-deck local server。
2. 打开同一 config 的多个 browser tab。
3. 创建多个 terminal，验证 `terminalId=term_<shortUuid>` 和动态 index 映射。
4. 通过 `just -f <shell-deck-root>/justfile -- codex ...` 启动 hook-enabled Codex。
5. 创建或导入 macro template。
6. 默认 `terminal-buffer` capture + mock/real parser branch，parser 可选 `regex` 或 `ai-json`。
7. 可选 `agent-event`/Codex hook capture，并追溯 `codexSessionId`。
8. run pause/resume/recover，并覆盖 `input_line` 等待用户输入后发送到目标 terminal。
9. `parallel_all` 两个以上 lane 并发审阅，覆盖 terminal-buffer、AgentEvent、regex 和 mock ai-json parser。
10. 节点日志和 AI 追溯日志来自同一份 event log。

### Active spec sync

通过 V0 Close Gate 后，需要把稳定设计同步到 `doc/tasks/active_specs/**`。active spec 只同步已经实现并验证的行为，不能把未完成 TODO 写成事实。

### Review report

最终 review 必须按 P1/P2/P3 分级，并区分：

* AI 直接修。
* 用户配置的暂停点、输入点或人工确认点。
* V1 以后再做。

## 示例

```text
V0 closeout report:
- terminal deck: pass
- just codex hook adapter: pass
- terminal-buffer capture: pass
- AgentEvent capture: pass with known limitation ...
- parser: regex pass, ai-json mock pass, online model smoke skipped because ...
- run recovery: pass
```

## 测试

本任务不发明新核心测试，只汇总前八个任务已经稳定的测试矩阵，并从零走一遍用户路径。

自动化测试至少覆盖：

* e2e：local server + multi-tab terminal deck。
* e2e：macro template create/import/export。
* e2e：terminal reorder + index/id/alias mapping。
* e2e：`send_line -> sleep -> wait -> capture-source -> parser -> branch -> input_line/pause/resume`，并覆盖带 `loopGuard.maxIterations` 的简单回跳循环。
* e2e：terminal-buffer capture -> regex parser -> branch。
* e2e：terminal-buffer capture -> mock ai-json parser -> branch。
* e2e：AgentEvent/Codex hook capture -> parser -> branch，online 不可用时记录 blocked reason。
* e2e：server/page refresh 后 run log 恢复。
* e2e：`parallel_all` 两个以上 lane 并发审阅，覆盖 terminal-buffer+regex、terminal-buffer+mock ai-json 和 AgentEvent+mock parser。
* doc：quickstart 能按步骤跑通。
* doc：active specs 与实际行为一致。
* review：P1/P2/P3 报告完成。

人工 smoke 至少覆盖：

* 人工按 quickstart 从零启动、创建 terminal、创建/导入模板、运行宏、刷新恢复。
* 人工确认 macro 面板不是后台黑盒：每个节点默认折叠，展开后能看见动作、输入、输出、parser、branch、parallel lane 和 artifacts。
* 人工确认同 config 第二个 live run 会被拒绝，切换另一 config 可并行运行；手动操作 terminal 后再恢复宏的体验符合 V0 目标。
* 人工记录 known limitations，不能把未完成能力写成事实。

Gate 规则：

* `just check`、`just build`、`just test-unit`、`just test-e2e`、`just test`、`just test-009-offline` 和所有子任务 offline recipe 必须通过。
* online probes 单独运行；不可用时必须记录 blocked reason，不混入默认测试。
* 人工 smoke 和 P1/P2/P3 review 未完成时，不能 Close Gate。
* 自动化测试不过不能交付；人工发现 P2 UX/语义问题必须回到对应子任务修复；P3 可以进入 known limitations。
