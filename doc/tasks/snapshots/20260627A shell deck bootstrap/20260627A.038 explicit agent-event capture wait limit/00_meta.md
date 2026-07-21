# 20260627A.038 Explicit Agent-Event Capture Wait Limit

## 任务概括

修复AgentEvent `result_only` Capture对真实长任务不可靠的问题。当前runner在Macro JSON和UI不可见的位置固定等待10分钟，Codex仍在工作时run会先失败，迟到的Stop hook无法继续原For。

本任务破坏性切换到MacroDefinitionV5。每个agent-event Capture必须显式保存`waitLimit`：新建默认`unbounded`；用户勾选Timeout后保存duration。删除server环境变量中的隐藏默认值。

## 正式 task 级别及定级原因

三星任务。

任务同时修改current Macro schema、visual/JSON editor、Library gateway、runner等待/cancellation、AgentEvent error处理和全部current fixtures。必须证明无限等待不busy-loop、不跨run消费旧event，显式timeout服从Pause/Stop并保持稳定错误。

## 范围内

* MacroDefinitionV5与AgentEvent exact wait-limit union。
* root与Parallel lane AgentEvent Capture UI。
* unbounded/timeout runtime等待、Pause/Stop与hook error。
* current Macro/Library/runner docs、tests和fixtures切换V5。

## 范围外

* 不给其他Capture kind或Wait Action增加该字段。
* 不增加timeout continue/skip；Capture artifact缺失时不能继续伪运行。
* 不恢复V4 reader、migration、alias、optional fallback或环境变量override。
* 不改变AgentEvent Room/terminal/launch/session/turn匹配和baseline/consumed规则。
* 不修改20260627A.031B冻结的`.031A`历史常量与历史snapshot；只按后继任务规则更新current inventory归属。
