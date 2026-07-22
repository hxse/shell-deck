# Problem Context

## Authoring friction

text-list item只有全局`Add item`，在长列表中插入中间项需要先追加再多次移动。loop template虽已有三个insert action，却被`Available: ... · from ...`提示和过大的按钮占据大量空间。Parallel已经用exact`source:none`表达明确无输出，但UI仍始终强调“required final node”和merge字段，让用户误以为每条lane必须收集text。

## Runtime ambiguity

当前Run dock把status、run id、draft readiness和current node压在同一行小字中；visual node没有运行高亮。更严重的是`MacroPanel.editorLocked`没有包含runner状态，fieldset也未真正disabled，因此active run期间控件可能继续修改browser-local draft，UI与Start冻结saved revision的事实不一致。

## Notification miss

Notify由server只广播一次是正确的single-execution边界，但App toast/sound在每个在线browser也只呈现一次，短音容易漏听。重复呈现应是App channel自身的明确配置，由收到同一notification的browser本地调度；不能让server重复执行Notify或让Telegram/System产生额外side effect。
