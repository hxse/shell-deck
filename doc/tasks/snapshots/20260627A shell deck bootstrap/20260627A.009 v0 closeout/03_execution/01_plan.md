# Execution Plan

## 模块边界

本任务只做 V0 收口，不新增核心功能。建议产物边界：

```text
doc/guides/001_quickstart.md
doc/tasks/active_specs/shell_deck_architecture.md
doc/tasks/active_specs/terminal_deck_contract.md
doc/tasks/active_specs/macro_template_contract.md
doc/tasks/active_specs/run_log_contract.md
doc/tasks/active_specs/capture_agent_event_contract.md
doc/tasks/active_specs/parser_profile_contract.md
doc/tasks/snapshots/20260627A shell deck bootstrap/20260627A.009 v0 closeout/04_review/01_result.md
doc/tasks/snapshots/20260627A shell deck bootstrap/20260627A.009 v0 closeout/04_review/02_verification.md
```

active spec 只同步已实现并验证的行为，不能把 V1 TODO 或 blocked online probe 写成事实。

## V0 E2E Matrix

Closeout 必须逐项记录 pass/fail/blocked/skip reason：

| 编号 | 场景 | 预期 |
| --- | --- | --- |
| E01 | local server start/stop | `just start` / `just stop` 可用，默认绑定 `127.0.0.1` |
| E02 | two browser tabs same config | terminal output fan-out，late replay 可用 |
| E03 | two configs isolation | terminal index/id map、runs、AgentEvent 不串 config |
| E04 | real PTY shell | echo、Ctrl-C、resize、exit、long paste 通过 |
| E05 | terminal reorder | `terminalId` 不变，`terminalIndex` map 同步 |
| E06 | macro template CRUD | 创建、编辑、复制、导入、导出、刷新恢复 |
| E07 | structured branch condition | 不保存字符串表达式，非法 signal/op/goto/value type 被拒绝，branch compare 不做字符串宽松比较 |
| E08 | run log recovery | eventSeq replay、artifact refs、节点日志刷新后一致 |
| E09 | macro runner mock flow | send_line -> sleep -> structured wait -> capture-source -> parse stub -> branch -> input_line/pause/resume；带 `loopGuard.maxIterations` 的简单回跳循环可恢复；同 config 第二个 live run 被拒绝 |
| E10 | terminal-buffer capture | raw/normalized artifact 写入，parser 可读取 |
| E11 | AgentEvent/Codex hook capture | SessionStart/Stop -> AgentEvent -> capture artifact |
| E12 | parser offline | regex parser + mock ai-json parser + fixtures + summary compat 通过 |
| E13 | parser online optional | `codex exec`/online `ai-json` probe pass 或记录 blocked reason |
| E14 | bounded parallel lanes | `parallel_all` 两个以上 lane 并发审阅，all_success join、失败 pause、刷新恢复和 no duplicate send 通过 |
| E15 | V0 known limitations visible | quickstart 和 closeout review 明确说明未交付能力 |

## 阶段

1. 跑完整 V0 e2e matrix，生成逐项结果表。
2. 运行全部稳定 just recipe：`just check`、`just build`、`just test-unit`、`just test-e2e`、`just test`、`just test-009-offline`，以及各子任务 offline recipe。
3. 单独运行 online probes：Codex hook capture、parser one-shot；外部不可用时记录 blocked reason，不混入默认测试。
4. 修正 quickstart，确保用户能按文档启动、验证、停机，并理解 online/offline 区别。
5. 同步 active specs，按 architecture/terminal/macro/run-log/capture/parser 拆分。
6. 汇总测试、fixture、probe artifact 路径和版本信息。
7. 输出 P1/P2/P3 review，区分 AI 可直接修、用户配置的暂停/输入/人工确认点和 V1 TODO。
8. 记录 V0 known limitations 和 V1 TODO。

## Known Limitations 格式

Closeout 必须用固定格式记录限制，避免把未完成能力写成事实：

```text
- id: KL-001
  status: known-limitation | blocked-external | deferred-v1
  area: terminal | macro | capture | parser | security | docs
  summary: short user-facing summary
  impact: what user cannot rely on
  workaround: current workaround or none
  followUpTask: optional task id
```

## Close Gate

* V0 quickstart 可执行。
* E01-E15 均有 pass/fail/blocked/skip reason，核心路径没有未解释 skip。
* active specs 不夸大未实现行为，且能追溯到通过 Gate 的 task。
* known limitations 使用固定格式，并和 README/quickstart 保持一致。
* review/verification 文档写入 `04_review/**`。
* 人工按 quickstart 从零走完 V0 关键路径，人工 smoke 和 P1/P2/P3 review 写入 `04_review/**`。
* `git diff --check` 通过。
