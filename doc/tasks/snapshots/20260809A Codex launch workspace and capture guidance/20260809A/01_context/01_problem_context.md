# Problem context

## 当前问题

用户在`~/dev/pyo3-quant`内运行`just -f ~/dev/shell-deck/justfile codex`，Codex banner却显示workspace是`~/dev/shell-deck`。原因不是新的Codex/Serena wrapper硬编码了目录：Just执行外部justfile recipe时先进入justfile所在目录，当前recipe和TypeScript wrapper又直接继承了这个cwd。这违背既有contract：Codex应在用户发起Just的项目目录工作。

AgentEvent Capture只能捕获通过shell-deck hook-enabled入口启动的Codex。现有编辑器只显示hook字段范围，没有告诉用户应运行什么命令；用户必须记住并手写较长的`just -f ... codex`。

## 方案取舍

cwd修复重用历史上已验证的边界：Just用`invocation_directory()`捕获发起目录，通过专用环境变量交给shell-deck wrapper；wrapper只设置Codex child的cwd/PWD。不把项目目录传给hook，不修改全局Codex wrapper，也不把用户参数吃掉。

UI提示放在AgentEvent Capture内部，而不放在Macro顶栏或全局toast。这样只在功能确实需要时出现，也不需要扫描整棵definition维护第二份derived state。命令使用Shell已注入的`$SHELL_DECK_JUSTFILE`，比固定`~/dev/shell-deck`更能跨checkout、跨用户工作。
