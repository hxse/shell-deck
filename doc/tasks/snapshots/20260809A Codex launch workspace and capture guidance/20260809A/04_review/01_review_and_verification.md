# Review and verification

## 总体判断

20260809A可以关闭。实现恢复了真实Just调用目录到Codex child cwd/PWD的完整传递，并在root与Parallel Codex AgentEvent Capture中加入同一份32px单行theme-native command bar、可手工选择的启动命令、解释性tooltip与clipboard action。AgentEvent protocol、MacroDefinitionV6、runner、hook identity和runtime context均未变化。

## Gate结论

* Formal Document Gate：通过。task spec冻结了caller-workspace、exact command、clipboard failure和非目标。
* Execution Gate：通过。只修改既有Just/wrapper边界与共享Capture editor，没有增加server API、runtime state或generic abstraction。
* Code Gate：通过。`just check`的file-size/style/TypeScript/Svelte全部通过；Svelte为0 error、0 warning，372个project-authored code文件无超过400行或例外。
* Build Gate：通过。production Vite build完成414 modules。
* Focused Test Gate：通过。29个unit/oracle case与1个Chromium场景通过。
* Unit Gate：通过。`just test-unit`共367项通过，包含284项core unit、专项quota/auth测试与60项integration。
* Integration Gate：通过。独立入口60项通过。
* E2E Gate：通过。75项Chromium E2E以single worker串行通过。
* Diff Gate：通过。`just diff-check`无whitespace错误。

## Findings and Solutions

审查确认原回归发生在shell-deck入口：Just执行外部justfile时切换到justfile目录，而recipe未保留`invocation_directory()`；`scripts/shell-deck-codex.ts`又把该目录直接作为child cwd。修复在recipe冻结caller directory，并在唯一spawn边界同时覆盖cwd与`PWD`，避免仍读取`$PWD`的下游wrapper继续选错项目。

UI只在`agent-event + codex`分支渲染，root与Parallel复用同一markup和command constant。正常状态以32px单行command bar呈现，命令区横向滚动且保持可选中，命令区与Copy按钮使用daisyUI tooltip，只有clipboard失败才展开第二行。命令使用Shell已经注入的`SHELL_DECK_JUSTFILE`，因此不向browser传递server absolute path。新增presentation与唯一interactive control已精确登记到现有theme/control inventory oracle。

初次sandbox内build无进展，sandbox内access-control测试也因端口/getifaddrs限制失败；对应进程已停止，随后同一正式命令在sandbox外顺序重跑并全部通过。这些不是产品或测试失败。

## 需要人工拍板

无。

## AI可直接修

无遗留P1/P2/P3。

## 未覆盖与残余风险

自动化不启动真实交互式Codex TUI；真实Just recipe改用fake executable观测child cwd、`PWD`和target环境，避免把外部Codex版本或网络引入Gate。Codex原生`-C/--cd`仍按既有argument passthrough交给下游处理。

## 审阅范围

审阅了当前20260809A change的task文档、Just recipe、Codex wrapper、Capture UI、clipboard反馈、UI structure/control oracle、focused/full tests、active specs、Quickstart与README。未修改`~/nixos-config` wrapper，未增加CSS、protocol、schema或runtime behavior。
