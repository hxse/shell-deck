# Problem Context

`.014 macro prompt workbench UI cleanup` 已经把 Macro / Prompt / Run Log 的顶层布局收敛成 workbench 结构，并明确了 Macro header、Template drawer/bar、Run status dock、Editor/JSON/Trace tabs、Trace tab 和 tool rail 的位置。

后续旧 `.015 macro action message flow redesign` 尝试实现 Flow V2 action/message-flow 时，实际改穿了 `.014` 的 workbench chrome：功能语义改造和布局外壳耦合在同一个 `MacroPanel.svelte` 大组件里，导致 Actions/Flow rail、Template、Run 状态和 tabs 出现布局漂移。

这个问题不应该通过继续在功能任务里修 CSS 解决。正确切法是先建立组件边界：把 workbench chrome、template selector、runner dock、editor shell、action palette、node editor、trace view 拆成独立组件，并用 `.014` layout invariant 测试证明拆分后行为和布局不变。

本任务是后续 `.016 macro action message flow redesign` 的前置任务。完成本任务后，`.016` 只能改 action/flow/node editor 内部，不能再顺手改 Macro workbench 顶层布局。

当前超过 400 行的大文件审计显示，真正适合纳入本任务的是 UI/workbench 边界文件：`src/lib/components/MacroPanel.svelte`、`src/App.svelte` 和 `src/styles.css`。它们直接承载 `.014` 的页面结构、side panel、terminal tab chrome、Macro/Prompt layout 和全局样式耦合。`server/macroRunnerService.ts`、`src/lib/macro/templateSchema.ts`、`src/lib/macro/flowV2Schema.ts`、`server/httpServer.ts` 和 `server/terminalDeckManager.ts` 也超过 400 行，但属于 runner/schema/API/terminal domain，拆分会引入执行语义和协议风险，不应塞进本任务。
