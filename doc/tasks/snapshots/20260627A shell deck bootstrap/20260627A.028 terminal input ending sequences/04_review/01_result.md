# Result

## 当前状态

`.028` 的 terminal input ending breaking contract、schema/store/HTTP hard cut、runner 精确字节写入、普通与 parallel editor、run-event evidence、Current Docs 同步与自动化验证均已完成。本 task 范围内无未解决 P1/P2/P3；既有 Vite bundle advisory 作为范围外 P3 保留，正式 Close Gate 通过。

当前设计真值已同步到 `doc/tasks/active_specs/macro_template_contract.md`、`doc/tasks/active_specs/run_log_contract.md` 与 `doc/guides/001_quickstart.md`；本 task `02_spec` 保留本次 breaking contract、失败矩阵和 Legacy Kill 边界。

当前 jj change 为 `xynrurrr`，description 是 `task 20260627A.028 terminal input ending sequences`。

## 实际修改

### Macro current schema

* 新增唯一 `TerminalEnding` union：`none | lf | cr | crlf`；`send`、runtime `input` 与 parallel lane `send` 均要求 own-enumerable `ending`。
* 破坏性删除公开 Macro JSON 的 `enter:boolean`。旧 `enter`、缺失 `ending`、非法大小写/别名/控制字符、boolean、inherited 或 non-enumerable `ending` 全部 fail loudly。
* Store、import、read/list/duplicate、HTTP PUT/import/export 与 runner start 都复用 current validator；失败输入不创建、不覆盖、不 rewrite、不启动 run。
* 不增加 migration、alias、dual reader、schema default 或 `schemaVersion` bump。

### Runner 与 run-event evidence

* 新增 exhaustive ending mapping：`none -> ""`、`lf -> "\\n"`、`cr -> "\\r"`、`crlf -> "\\r\\n"`。
* 普通 `send`、runtime `input` 与 parallel lane `send` 复用同一 terminal-write 链路；删除固定 LF submit 与 boolean branch。
* Current `terminal_text_sent` producer 只写 `ending`，并继续通过 content/write artifacts 保存追加前文本和精确最终 payload；不再产生 `enter` 或 `enterSequence`。
* append-only 历史 events 仍由通用 replay 展示，不新增 ending compatibility branch，也不重写历史数据。

### Editor

* 普通 send/input 与 parallel lane send 的 `Submit with Enter` checkbox 统一替换为共享 `TerminalEndingField` select。
* UI 仅提供 None、Enter / CR、LF、CRLF 四个互斥选项；三个新建 surface 都显式写入默认 `ending: "cr"`。
* Preview、save、reload 后 editor、reload 后 JSON 与 export 同时覆盖四个值，证明默认 CR 和用户选择都按唯一字段持久化。

### Current Docs、fixtures 与本地数据

* Macro active spec、run-log active spec与 Quickstart 已切换到 current ending contract。
* 全部正向 fixtures 使用 `ending`；旧 `enter` 只保留为 single-fault negative evidence，`enterSequence` 只保留为 current event 不应存在的断言。
* 新增 `test:028` 与 `just test-028` focused 入口。
* `local` 下两个旧 schema 临时 Macro 已按用户先前的删除要求，recoverably 移至 `.shell-deck/trash/20260712-ending-hard-cut/`；未增加任何兼容或自动迁移代码。

## Post-review 修复

* **P3/L1（AI 直接修）**：初版三个 editor surface 重复维护相同 ending options，存在文案、顺序和值漂移风险。现抽成唯一 `TerminalEndingField.svelte` 并由三处复用。
* **P3/L1（AI 直接修）**：初版 E2E 只证明新节点显示默认 CR，保存前却把保留节点改成其他值。现增加一个保持默认 CR 的 send，并在 preview/save/reload/export 中同时断言 none/LF/CR/CRLF。

上述 findings 均已修复，没有需要用户拍板的项目；contract 与 Legacy Kill post-review 未发现其他 P1/P2/P3。

## 验证结果

| 命令 | 结果 |
| --- | --- |
| `just check` | 通过：svelte-check 0 errors、0 warnings |
| `just test-028` | 通过：63 个 Bun tests、0 fail、419 assertions；6 个 Chromium E2E 通过 |
| `just test-unit` | 通过：248 pass、0 fail、1254 expect calls |
| `git diff --check` | 通过 |
| Legacy/current residue 扫描 | Production、Current Docs 和正向 fixtures 无旧链路残留 |
| `.orig/.rej/.tmp` 扫描 | 无残留文件 |

本机默认 Chromium 动态库搜索路径不完整；最终 E2E 使用当前 Nix system libraries 运行并通过。Vite build 仍输出 `>500 kB` chunk-size advisory，它是既有 bundle/code-splitting P3，不影响本 task correctness。

## Legacy Kill List 结果

* Production/current docs 已无 Macro `enter` field、`enterSequence` producer、固定 LF submit、boolean runtime branch、旧 checkbox/test id 或 `Submit with Enter` 文案。
* 正向 source/fixture 全部使用 required `ending`；旧写法只保留为明确 fail-loudly negative evidence，未发现 migration、normalizer、fallback、alias 或 dual schema。
* Historical task snapshots 不回写；append-only run-event files中的旧 evidence 不迁移，通用 replay 未增加兼容分支。
* 本机 active `local` template 目录中的旧 schema 文件已移出，当前 UI/smoke 不再被这些用户数据阻断。

## 残余风险与范围外

* 未执行真实 Codex TUI 的在线 smoke；该行为依赖外部程序与认证，且本 task 明确不建立 Codex-specific 分支。Recording backend 已逐值验证精确 raw bytes，real PTY/E2E 已验证默认 CR 可提交 shell command，因此不阻断本任务。
* 不增加 keyboard-event/special-key DSL，也不修改浏览器 xterm 物理键盘、PTY helper framing或 terminal manager 转发。
* 不修改 `.025/.026` 的 occurrence-aware pause/resume cursor，不重写历史 append-only events。
* Vite chunk-size advisory 作为非阻断、范围外 P3 保留。

## Close Gate 结论

Document Gate、Schema/Store/HTTP Gate、Runner/Raw-byte Gate、Editor/Current Docs Gate、AI pre/post-review、Legacy Kill List 与正式自动化验证均已完成。本 task 范围内无未解决 P1/P2/P3；在上述明确范围外与既有 bundle advisory 下，`20260627A.028` Close Gate 通过。
