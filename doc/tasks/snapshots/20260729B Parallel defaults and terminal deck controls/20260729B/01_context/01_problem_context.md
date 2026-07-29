# Problem context

## 当前问题

V6 Parallel的新建factory仍写入`onLaneFail:"pause"`。这会让普通pane错误默认把run停在需要人工恢复的状态，而用户期望默认fail loudly；已有saved Macro已经保存显式值，不应被后台改写。

递归Flow body已经通过depth轮换的daisyUI semantic color rail表达嵌套，但Parallel pane直接渲染Action card，没有进入同一视觉层级，因此pane内容与外层node粘连。

Macro run dock的`Prepare terminals`标签偏长，且缺少一次清空当前Room全部Shell/Text的显式动作。逐个点击tab关闭既慢，也会让批量意图散落成多个独立browser mutation。

## 目标

新建Parallel自然选择fail；pane在任何嵌套depth下延续Flow rail；run dock使用短`Prepare`标签，并提供一个明确的destructive `Close all`按钮。Close all必须先由用户确认，再通过一个server-side受控批量命令执行，取消确认或没有mutation authority时不得产生任何close。
