# Quickstart

`shell-deck` V0 还没有完整交付，但当前已经可以运行浏览器 terminal deck 和 `.003 macro template workbench`。宏模板可以创建、编辑、复制、删除、导入、导出，并保存 terminal refs、`capture-source` steps、parser config 和结构化 branch；宏 runner、run log、真实 capture artifact 和 parser invocation 还在后续子任务。

## 启动本地工作台

```bash
just start
```

默认监听 `127.0.0.1:5177`。打开浏览器访问：

```text
http://127.0.0.1:5177
```

当前可用能力：

- terminal tabs：多 terminal、fake/real backend、多浏览器 tab 同步、tab 重命名、可选拖拽排序。
- macro panel：template CRUD、duplicate、import/export、terminal tab alias/index/id 引用；capture 配置放在 `capture-source` step 内，支持 `terminal-buffer` 和 `agent-event`。
- parser config：内置 `ai-json` profile summary 选择，以及 template-local `regex` rules。
- branch config：结构化 `signal/op/value/goto`，不保存字符串表达式，不做 `"true" == true` 宽松转换。
- flow config：可保存 `send_line`、`sleep`、`input_line`、`wait`、`capture-source`、`parse`、`branch`、`goto`、`pause/complete/fail/stop`。

当前不可用能力：

- 不能真正运行 macro。
- 不会生成 run event log 或 artifact。
- 不会调用真实 parser / Spark / Codex exec。
- 不绑定或恢复 Codex session。

## 测试入口

所有项目命令入口走 `justfile`：

```bash
just check
just test-unit
just test-e2e
just test-003
```

`.001` API probe 仍可单独运行：

```bash
just test-001-offline
just test-001-online
```

`test-001-offline` 不访问网络、不调用真实模型；`test-001-online` 会调用真实 Codex CLI，可能使用网络、认证和模型额度。Playwright 测试会通过 `SHELL_DECK_DATA_ROOT` 使用临时数据目录，避免污染项目本地 `.shell-deck/` 缓存。

## 文档入口

```text
doc/tasks/index/001_20260627A.md
doc/tasks/snapshots/20260627A shell deck bootstrap/20260627A/02_spec/01_contract.md
doc/tasks/snapshots/20260627A shell deck bootstrap/20260627A.003 macro template workbench/02_spec/01_contract.md
```
